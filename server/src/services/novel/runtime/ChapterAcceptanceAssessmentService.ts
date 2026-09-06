import type { AuditReport, AuditType, QualityScore, ReviewIssue } from "@write-now/shared/types/novel";
import type {
  ChapterExecutionMissingObligation,
  GenerationContextPackage,
} from "@write-now/shared/types/chapterRuntime";
import type { LLMProvider } from "@write-now/shared/types/llm";
import { prisma } from "../../../db/prisma";
import { runStructuredPrompt } from "../../../prompting/core/promptRunner";
import { resolvePromptContextBlocksForAsset } from "../../../prompting/context/promptContextResolution";
import { buildChapterReviewContextBlocks } from "../../../prompting/prompts/novel/chapterLayeredContext";
import { resolveLengthBudgetContract } from "@write-now/shared/types/chapterLengthControl";
import { resolveTargetWordRange } from "../../../prompting/prompts/novel/chapterLayeredContextShared";
import {
  chapterAcceptanceAssessmentPrompt,
  type ChapterAcceptanceAssessmentOutput,
} from "../../../prompting/prompts/novel/chapterAcceptance.prompts";
import { openConflictService } from "../../state/OpenConflictService";
import { normalizeScore, ruleScore } from "../novelP0Utils";
import { detectProseQuality } from "./proseQuality/ProseQualityDetector";

export interface ChapterAcceptanceAssessmentInput {
  novelId: string;
  chapterId: string;
  novelTitle: string;
  chapterTitle: string;
  chapterOrder: number;
  targetWordCount?: number | null;
  content: string;
  contextPackage: GenerationContextPackage;
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
}

export interface ChapterAcceptanceAssessmentResult {
  assessment: ChapterAcceptanceAssessmentOutput;
  score: QualityScore;
  issues: ReviewIssue[];
  auditReports: AuditReport[];
}

type AcceptanceIssue = ChapterAcceptanceAssessmentOutput["blockingIssues"][number];
type AcceptanceRepairDirective = ChapterAcceptanceAssessmentOutput["repairDirectives"][number];

const UNDER_LENGTH_CODES = [
  "length_insufficient",
  "length_under",
  "under_soft",
  "length_under_soft_min",
  "length_under_hard_min",
];

const OVER_LENGTH_CODES = [
  "length_over",
  "over_soft",
  "over_hard",
  "length_over_soft_max",
  "length_over_hard_max",
];

function normalizeIssueCode(code: string | null | undefined): string {
  return (code ?? "").trim().toLowerCase();
}

function categoryToAuditType(category: AcceptanceIssue["category"]): AuditType {
  if (category === "continuity") return "continuity";
  if (category === "character") return "character";
  if (category === "plot") return "plot";
  return "mode_fit";
}

function categoryToReviewIssueCategory(category: AcceptanceIssue["category"]): ReviewIssue["category"] {
  if (category === "character") return "logic";
  if (category === "plot") return "pacing";
  if (category === "voice") return "voice";
  if (category === "mode_fit") return "coherence";
  return "coherence";
}

function missingObligationToReviewIssue(obligation: ChapterExecutionMissingObligation): ReviewIssue {
  const category: ReviewIssue["category"] = obligation.kind === "character_appearance"
    || obligation.kind === "goal_change"
    ? "logic"
    : obligation.kind === "forbidden_crossing"
      ? "coherence"
      : "pacing";
  return {
    severity: obligation.kind === "forbidden_crossing" ? "high" : "medium",
    category,
    evidence: obligation.evidence?.trim() || obligation.summary,
    fixSuggestion: obligation.summary,
  };
}

function countChapterCharacters(content: string): number {
  return content.replace(/\s+/g, "").trim().length;
}

function isUnderLengthIssue(issue: AcceptanceIssue): boolean {
  const code = normalizeIssueCode(issue.code);
  return UNDER_LENGTH_CODES.includes(code);
}

function isOverLengthIssue(issue: AcceptanceIssue): boolean {
  const code = normalizeIssueCode(issue.code);
  return OVER_LENGTH_CODES.includes(code) || code === "length_over_hard_max";
}

function isLengthDirective(directive: AcceptanceRepairDirective): boolean {
  const instruction = directive.instruction.toLowerCase();
  return instruction.includes("目标长度")
    || instruction.includes("硬性字数上限")
    || instruction.includes("扩写正文到目标长度")
    || instruction.includes("整章压缩");
}

function isLengthRiskTag(tag: string): boolean {
  const normalized = tag.trim().toLowerCase();
  return UNDER_LENGTH_CODES.includes(normalized)
    || OVER_LENGTH_CODES.includes(normalized)
    || normalized === "length_over_hard_max";
}

function shouldDropLengthIssue(input: {
  issue: AcceptanceIssue;
  actualWordCount: number;
  minWordCount: number | null;
  maxWordCount: number | null;
}): boolean {
  if (input.minWordCount != null && input.actualWordCount >= input.minWordCount && isUnderLengthIssue(input.issue)) {
    return true;
  }
  if (input.maxWordCount != null && input.actualWordCount <= input.maxWordCount && isOverLengthIssue(input.issue)) {
    return true;
  }
  return false;
}

function reconcileLengthAssessment(
  output: ChapterAcceptanceAssessmentOutput,
  content: string,
  targetWordCount?: number | null,
): ChapterAcceptanceAssessmentOutput {
  const range = resolveTargetWordRange(targetWordCount);
  if (range.minWordCount == null && range.maxWordCount == null) {
    return output;
  }
  const actualWordCount = countChapterCharacters(content);
  const blockingIssues = output.blockingIssues.filter((issue) => !shouldDropLengthIssue({
    issue,
    actualWordCount,
    minWordCount: range.minWordCount,
    maxWordCount: range.maxWordCount,
  }));
  if (blockingIssues.length === output.blockingIssues.length) {
    return output;
  }
  return {
    ...output,
    blockingIssues,
    repairDirectives: output.repairDirectives.filter((directive) => !isLengthDirective(directive)),
    riskTags: output.riskTags.filter((tag) => !isLengthRiskTag(tag)),
  };
}

/**
 * 确定性超长护栏：正文实际字数超过硬性上限（目标×1.25）时，无论模型验收结论如何，
 * 都注入一条 LENGTH_OVER_HARD_MAX blockingIssue 和整章压缩 repairDirective，
 * 让修复环的 compress_chapter_for_length 提示真正被触发。
 */
function ensureOverHardMaxFinding(
  output: ChapterAcceptanceAssessmentOutput,
  content: string,
  targetWordCount?: number | null,
): ChapterAcceptanceAssessmentOutput {
  const budget = resolveLengthBudgetContract(targetWordCount);
  if (!budget) {
    return output;
  }
  const actualWordCount = countChapterCharacters(content);
  if (actualWordCount <= budget.hardMaxWordCount) {
    return output;
  }
  if (output.blockingIssues.some((issue) => issue.code === "LENGTH_OVER_HARD_MAX")) {
    return output;
  }
  const overHardMaxIssue: AcceptanceIssue = {
    severity: "medium",
    category: "mode_fit",
    code: "LENGTH_OVER_HARD_MAX",
    evidence: `正文实际 ${actualWordCount} 字，超出硬性上限 ${budget.hardMaxWordCount} 字（目标 ${budget.targetWordCount} 字）。`,
    fixSuggestion: "整章压缩重复表达、碎片化对话与冗余解释，保留核心推进、义务兑现与结尾钩子，压回可接受区间。",
  };
  const compressDirective: AcceptanceRepairDirective = {
    mode: "patch",
    target: "plot",
    instruction: `正文超出硬性字数上限（${actualWordCount}/${budget.hardMaxWordCount}）：整章压缩重复表达、碎片化对话与冗余解释，保留核心推进、义务兑现与结尾钩子，压回 ${budget.softMinWordCount}-${budget.softMaxWordCount} 字区间。`,
  };
  return {
    ...output,
    blockingIssues: [overHardMaxIssue, ...output.blockingIssues],
    repairDirectives: [compressDirective, ...output.repairDirectives],
    riskTags: Array.from(new Set([...output.riskTags, "LENGTH_OVER_HARD_MAX"])),
  };
}

export function normalizeAssessment(
  output: ChapterAcceptanceAssessmentOutput,
  content: string,
  targetWordCount?: number | null,
): ChapterAcceptanceAssessmentOutput {
  const reconciledBase = reconcileLengthAssessment(output, content, targetWordCount);
  const reconciled = ensureOverHardMaxFinding(reconciledBase, content, targetWordCount);
  const reconcileDroppedIssues = reconciledBase !== output;
  const score = normalizeScore(reconciled.score ?? ruleScore(content));
  const missingObligations = reconciled.missingObligations ?? [];
  const hasHighRisk = reconciled.blockingIssues.some((issue) => issue.severity === "high" || issue.severity === "critical");
  const hasRepairWork = reconciled.blockingIssues.length > 0
    || reconciled.repairDirectives.length > 0
    || missingObligations.length > 0
    || reconciled.repairability === "patchable_obligation_gap"
    || reconciled.repairability === "rewrite_needed";
  let status: ChapterAcceptanceAssessmentOutput["status"] = reconciled.status;
  if (status === "accepted" && (hasHighRisk || hasRepairWork)) {
    status = "repairable";
  }
  if (status === "needs_manual_review" && reconcileDroppedIssues && !hasHighRisk && hasRepairWork) {
    status = "repairable";
  }
  if (status === "repairable" && !hasRepairWork) {
    status = "continue_with_risk";
  }
  if (reconciled.repairability === "plan_misalignment") {
    status = "needs_manual_review";
  }
  const continuePolicy = status === "needs_manual_review"
    ? "pause"
    : status === "repairable"
      ? "repair_once"
      : status === "continue_with_risk" && reconciled.continuePolicy === "pause"
        ? "continue"
        : reconciled.continuePolicy;
  return {
    ...reconciled,
    status,
    score,
    continuePolicy,
    riskTags: Array.from(new Set(reconciled.riskTags.map((item) => item.trim()).filter(Boolean))),
    blockingIssues: reconciled.blockingIssues.slice(0, 5),
    repairDirectives: reconciled.repairDirectives.slice(0, 4),
    missingObligations: missingObligations.slice(0, 8),
  };
}

function buildFallbackAssessment(content: string): ChapterAcceptanceAssessmentOutput {
  const score = ruleScore(content);
  return {
    status: "continue_with_risk",
    score,
    summary: "正文已生成，接收闸门未完成结构化判断，系统将保留正文并标记后续复查风险。",
    blockingIssues: [{
      severity: "medium",
      category: "mode_fit",
      code: "acceptance_gate_unavailable",
      evidence: "章节接收闸门未返回可用结构化结果。",
      fixSuggestion: "保留正文，后续可重新执行章节审校或局部修文。",
    }],
    repairDirectives: [],
    missingObligations: [],
    repairability: "none",
    decisionReason: "接收闸门不可用，系统保留正文并继续推进后续复查。",
    riskTags: ["acceptance_gate_unavailable"],
    assetSyncRecommendation: {
      priority: "normal",
      reason: "正文已保存，但建议后续补跑章节审校或资产同步。",
      requiresFullPayoffReconcile: false,
    },
    continuePolicy: "continue",
  };
}

export class ChapterAcceptanceAssessmentService {
  async assess(input: ChapterAcceptanceAssessmentInput): Promise<ChapterAcceptanceAssessmentResult> {
    const assessment = await this.invokeAssessment(input).catch(() => buildFallbackAssessment(input.content));
    const proseQuality = detectProseQuality(input.content);
    const proseIssues = proseQuality.findings.slice(0, 5).map((finding) => ({
      severity: finding.severity,
      category: "voice" as const,
      code: finding.code,
      evidence: `第 ${finding.line} 行：${finding.excerpt}`,
      fixSuggestion: finding.fixSuggestion,
    }));
    const normalized = normalizeAssessment({
      ...assessment,
      blockingIssues: [...assessment.blockingIssues, ...proseIssues],
      riskTags: [...assessment.riskTags, ...proseQuality.findings.map((finding) => finding.code)],
    }, input.content, input.targetWordCount);
    const score = normalizeScore(normalized.score);
    const issues = normalized.blockingIssues.map((issue) => ({
      severity: issue.severity,
      category: categoryToReviewIssueCategory(issue.category),
      evidence: issue.evidence,
      fixSuggestion: issue.fixSuggestion,
    })).concat(normalized.missingObligations.map((obligation) => missingObligationToReviewIssue(obligation)));
    const auditReports = await this.persistAcceptanceReports(input, normalized, score);
    await openConflictService.syncFromAuditReports({
      novelId: input.novelId,
      chapterId: input.chapterId,
      chapterOrder: input.chapterOrder,
      sourceSnapshotId: null,
      auditReports,
    }).catch(() => null);
    return {
      assessment: normalized,
      score,
      issues,
      auditReports,
    };
  }

  private async invokeAssessment(input: ChapterAcceptanceAssessmentInput): Promise<ChapterAcceptanceAssessmentOutput> {
    const fallbackBlocks = input.contextPackage.chapterReviewContext
      ? buildChapterReviewContextBlocks(input.contextPackage.chapterReviewContext)
      : [];
    const resolvedContext = await resolvePromptContextBlocksForAsset({
      asset: chapterAcceptanceAssessmentPrompt,
      executionContext: {
        entrypoint: "chapter_pipeline",
        novelId: input.novelId,
        chapterId: input.chapterId,
        metadata: {
          chapterReviewContext: input.contextPackage.chapterReviewContext,
        },
      },
      fallbackBlocks,
    });
    const result = await runStructuredPrompt({
      asset: chapterAcceptanceAssessmentPrompt,
      promptInput: {
        novelTitle: input.novelTitle,
        chapterOrder: input.chapterOrder,
        chapterTitle: input.chapterTitle,
        targetWordCount: input.targetWordCount ?? null,
        content: input.content,
      },
      contextBlocks: resolvedContext.blocks,
      options: {
        provider: input.provider,
        model: input.model,
        temperature: Math.min(input.temperature ?? 0.2, 0.35),
        maxTokens: 1600,
        novelId: input.novelId,
        chapterId: input.chapterId,
        stage: "chapter_acceptance",
        triggerReason: "chapter_acceptance_assessment",
      },
    });
    return result.output;
  }

  private async persistAcceptanceReports(
    input: ChapterAcceptanceAssessmentInput,
    assessment: ChapterAcceptanceAssessmentOutput,
    score: QualityScore,
  ): Promise<AuditReport[]> {
    const grouped = new Map<AuditType, AcceptanceIssue[]>();
    for (const issue of assessment.blockingIssues) {
      const auditType = categoryToAuditType(issue.category);
      grouped.set(auditType, [...(grouped.get(auditType) ?? []), issue]);
    }
    if (grouped.size === 0) {
      grouped.set("mode_fit", []);
    }
    const auditTypes = Array.from(grouped.keys());
    await prisma.$transaction(async (tx) => {
      await tx.auditReport.deleteMany({
        where: {
          novelId: input.novelId,
          chapterId: input.chapterId,
          auditType: { in: auditTypes },
        },
      });
      for (const auditType of auditTypes) {
        const issues = grouped.get(auditType) ?? [];
        await tx.auditReport.create({
          data: {
            novelId: input.novelId,
            chapterId: input.chapterId,
            auditType,
            overallScore: score.overall,
            summary: assessment.summary,
            legacyScoreJson: JSON.stringify({
              ...score,
              acceptanceStatus: assessment.status,
              continuePolicy: assessment.continuePolicy,
              riskTags: assessment.riskTags,
              assetSyncRecommendation: assessment.assetSyncRecommendation,
              repairDirectives: assessment.repairDirectives,
            }),
            issues: {
              create: issues.map((issue, index) => ({
                auditType,
                severity: issue.severity,
                code: issue.code || `acceptance_${index + 1}`,
                description: issue.evidence,
                evidence: issue.evidence,
                fixSuggestion: issue.fixSuggestion,
              })),
            },
          },
        });
      }
    });
    return prisma.auditReport.findMany({
      where: {
        novelId: input.novelId,
        chapterId: input.chapterId,
        auditType: { in: auditTypes },
      },
      include: {
        issues: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }) as unknown as Promise<AuditReport[]>;
  }
}
