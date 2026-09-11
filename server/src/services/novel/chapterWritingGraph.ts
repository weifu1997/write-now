import type { BaseMessageChunk } from "@langchain/core/messages";
import type {
  ChapterRuntimePackage,
  GenerationContextPackage,
} from "@write-now/shared/types/chapterRuntime";
import type { LengthBudgetContract } from "@write-now/shared/types/chapterLengthControl";
import { resolveLengthBudgetFromSnapshot } from "@write-now/shared/types/chapterLengthControl";
import type { LLMProvider } from "@write-now/shared/types/llm";
import type { TaskType } from "../../llm/modelRouter";
import { createContextBlock } from "../../prompting/core/contextBudget";
import { runTextPrompt, streamTextPrompt } from "../../prompting/core/promptRunner";
import { resolvePromptContextBlocksForAsset } from "../../prompting/context/promptContextResolution";
import {
  buildChapterWriterContextBlocks,
  sanitizeWriterContextBlocks,
} from "../../prompting/prompts/novel/chapterLayeredContext";
import { chapterWriterPrompt } from "../../prompting/prompts/novel/chapterWriter.prompts";
import { NOVEL_PROMPT_BUDGETS } from "../../prompting/prompts/novel/promptBudgetProfiles";
import { NovelContinuationService } from "./NovelContinuationService";
import { assertChapterContentNotEmpty } from "./runtime/chapterEmptyContentError";
import { prisma } from "../../db/prisma";
import {
  compactOpeningExplainContext,
  formatOpeningPlatformConstraintText,
  formatWritingPlatformDraftingText,
  parseWritingPlatformSnapshotJson,
  resolveChapterTargetWordCount,
  type WritingPlatformSnapshot,
} from "@write-now/shared/types/writingPlatform";

interface LoadedPlatformContext {
  snapshot: WritingPlatformSnapshot | null;
  defaultChapterLength: number | null;
}

const platformContextCache = new Map<string, Promise<LoadedPlatformContext>>();

function loadPlatformContext(novelId: string): Promise<LoadedPlatformContext> {
  const cached = platformContextCache.get(novelId);
  if (cached) {
    return cached;
  }
  const pending = prisma.novel.findUnique({
    where: { id: novelId },
    select: {
      writingPlatformSnapshotJson: true,
      defaultChapterLength: true,
    },
  }).then((novel) => ({
    snapshot: parseWritingPlatformSnapshotJson(novel?.writingPlatformSnapshotJson),
    defaultChapterLength: novel?.defaultChapterLength ?? null,
  })).finally(() => {
    platformContextCache.delete(novelId);
  });
  platformContextCache.set(novelId, pending);
  return pending;
}

function compactOpeningRagContext(
  ragContext: string,
  chapterOrder: number,
  snapshot: WritingPlatformSnapshot | null,
): string {
  return compactOpeningExplainContext(ragContext, chapterOrder, snapshot);
}

async function loadWritingPlatformBlocks(novelId: string, chapterOrder: number) {
  const { snapshot } = await loadPlatformContext(novelId);
  const drafting = formatWritingPlatformDraftingText(snapshot);
  const opening = formatOpeningPlatformConstraintText({ snapshot, chapterOrder });
  return [
    createContextBlock({
      id: "writing_platform",
      group: "writing_platform",
      priority: 105,
      required: true,
      content: drafting,
    }),
    opening
      ? createContextBlock({
        id: "opening_platform_contract",
        group: "opening_constraints",
        priority: 103,
        required: true,
        content: opening,
      })
      : null,
  ].filter((block): block is ReturnType<typeof createContextBlock> => Boolean(block));
}

export interface ChapterGraphLLMOptions {
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  taskType?: TaskType;
}

export interface ChapterGraphGenerateOptions extends ChapterGraphLLMOptions {
  previousChaptersSummary?: string[];
  deferArtifactBackgroundSync?: boolean;
}

interface ChapterRef {
  id: string;
  title: string;
  order: number;
  content?: string | null;
  expectation?: string | null;
  targetWordCount?: number | null;
}

type ContinuationPack = Awaited<ReturnType<NovelContinuationService["buildChapterContextPack"]>>;

interface ChapterGraphDeps {
  enforceOpeningDiversity: (
    novelId: string,
    chapterOrder: number,
    chapterTitle: string,
    content: string,
    options: ChapterGraphLLMOptions,
  ) => Promise<{ content: string; rewritten: boolean; maxSimilarity: number }>;
  saveDraftAndArtifacts: (
    novelId: string,
    chapterId: string,
    content: string,
    generationState: "drafted" | "repaired",
    options?: { scheduleBackgroundSync?: boolean; syncArtifacts?: boolean },
  ) => Promise<void>;
  logInfo: (message: string, meta?: Record<string, unknown>) => void;
  logWarn: (message: string, meta?: Record<string, unknown>) => void;
}

export interface ChapterStreamInput {
  novelId: string;
  novelTitle: string;
  chapter: ChapterRef;
  contextPackage?: GenerationContextPackage;
  options: ChapterGraphGenerateOptions;
}

const continuationService = new NovelContinuationService();

function countChapterCharacters(content: string): number {
  return content.replace(/\s+/g, "").trim().length;
}

function resolveChapterLengthBudget(input: {
  writeContext?: GenerationContextPackage["chapterWriteContext"];
  contextPackage: GenerationContextPackage;
  chapter: ChapterRef;
  snapshot: WritingPlatformSnapshot | null;
  defaultChapterLength: number | null;
}): LengthBudgetContract | null {
  const targetWordCount = resolveChapterTargetWordCount({
    chapterTargetWordCount: input.writeContext?.chapterMission.targetWordCount
      ?? input.contextPackage.chapter.targetWordCount
      ?? input.chapter.targetWordCount
      ?? null,
    defaultChapterLength: input.defaultChapterLength,
    snapshot: input.snapshot,
    narrativeForm: "long_novel",
  });
  return resolveLengthBudgetFromSnapshot(targetWordCount, input.snapshot);
}

function buildDraftContinuationBlock(content: string, targetWordCount: number, minWordCount: number): string {
  const trimmed = content.trim();
  const excerpt = trimmed.length > 1400 ? trimmed.slice(-1400) : trimmed;
  return [
    `Current saved draft length: ${countChapterCharacters(trimmed)} Chinese characters.`,
    `Target length: about ${targetWordCount} Chinese characters. Minimum acceptable length: ${minWordCount}.`,
    "Continue from the existing ending. Do not restart the chapter. Do not repeat already written events.",
    "Current draft tail (continue after this):",
    excerpt || "none",
  ].join("\n");
}

function buildDraftCondenseBlock(content: string, budget: LengthBudgetContract): string {
  return [
    `Current draft length: ${countChapterCharacters(content)} Chinese characters.`,
    `Target length: about ${budget.targetWordCount} Chinese characters. Hard maximum: ${budget.hardMaxWordCount}.`,
    "Condense the full chapter draft below into a complete chapter within the acceptable range.",
    "Full draft (condense this):",
    content.trim(),
  ].join("\n");
}

export class ChapterWritingGraph {
  constructor(private readonly deps: ChapterGraphDeps) {}

  private async continuityNode(
    novelId: string,
    chapter: ChapterRef,
    content: string,
    options: ChapterGraphLLMOptions,
    continuationPack: ContinuationPack,
  ): Promise<string> {
    const openingGuard = await this.deps.enforceOpeningDiversity(
      novelId,
      chapter.order,
      chapter.title,
      content,
      options,
    );
    if (openingGuard.rewritten) {
      this.deps.logInfo("Opening diversity rewrite applied", {
        chapterOrder: chapter.order,
        maxSimilarity: Number(openingGuard.maxSimilarity.toFixed(4)),
      });
    }

    const continuationGuard = await continuationService.rewriteIfTooSimilar({
      chapterTitle: chapter.title,
      content: openingGuard.content,
      continuationPack,
      provider: options.provider,
      model: options.model,
      temperature: options.temperature,
    });
    if (continuationGuard.rewritten) {
      this.deps.logInfo("Continuation anti-copy rewrite applied", {
        chapterOrder: chapter.order,
        maxSimilarity: Number(continuationGuard.maxSimilarity.toFixed(4)),
      });
    }
    return continuationGuard.content;
  }

  private async condenseOverLength(input: {
    novelId: string;
    novelTitle: string;
    chapter: ChapterRef;
    content: string;
    contextPackage: GenerationContextPackage;
    options: ChapterGraphLLMOptions;
    snapshot: WritingPlatformSnapshot | null;
    defaultChapterLength: number | null;
  }): Promise<string> {
    const writeContext = input.contextPackage.chapterWriteContext;
    const budget = resolveChapterLengthBudget({
      writeContext,
      contextPackage: input.contextPackage,
      chapter: input.chapter,
      snapshot: input.snapshot,
      defaultChapterLength: input.defaultChapterLength,
    });
    if (!writeContext || !budget) {
      return input.content;
    }

    const currentLength = countChapterCharacters(input.content);
    if (currentLength <= budget.hardMaxWordCount) {
      return input.content;
    }

    const builtBlocks = [
      ...await loadWritingPlatformBlocks(input.novelId, input.chapter.order),
      ...buildChapterWriterContextBlocks(writeContext),
    ];
    const sanitized = sanitizeWriterContextBlocks([
      createContextBlock({
        id: "current_draft_full",
        group: "current_draft_full",
        priority: 106,
        required: true,
        allowSummary: false,
        content: buildDraftCondenseBlock(input.content, budget),
      }),
      ...builtBlocks,
    ]);
    if (sanitized.removedBlockIds.length > 0) {
      this.deps.logWarn("Writer condense blocks removed by guard", {
        chapterOrder: input.chapter.order,
        removedBlockIds: sanitized.removedBlockIds,
      });
    }
    const condenseAsset = {
      ...chapterWriterPrompt,
      contextPolicy: {
        ...chapterWriterPrompt.contextPolicy,
        maxTokensBudget: NOVEL_PROMPT_BUDGETS.chapterWriterCondense,
        requiredGroups: [
          "current_draft_full",
          ...(chapterWriterPrompt.contextPolicy.requiredGroups ?? []),
        ],
      },
    };
    const resolvedContext = await resolvePromptContextBlocksForAsset({
      asset: condenseAsset,
      executionContext: {
        entrypoint: "chapter_pipeline",
        novelId: input.novelId,
        chapterId: input.chapter.id,
        metadata: {
          chapterWriteContext: writeContext,
          chapterBlockMode: "full",
          ragContext: compactOpeningRagContext(input.contextPackage.ragContext, input.chapter.order, input.snapshot),
          extraContextBlocks: sanitized.allowedBlocks.filter((block) => block.group === "current_draft_full"),
        },
      },
      fallbackBlocks: sanitized.allowedBlocks,
    });

    const completion = await runTextPrompt({
      asset: condenseAsset,
      promptInput: {
        novelTitle: input.novelTitle,
        chapterOrder: input.chapter.order,
        chapterTitle: input.chapter.title,
        mode: "condense",
        targetWordCount: budget.targetWordCount,
        minWordCount: budget.softMinWordCount,
        maxWordCount: budget.softMaxWordCount,
      },
      contextBlocks: resolvedContext.blocks,
      options: {
        provider: input.options.provider,
        model: input.options.model,
        temperature: input.options.temperature ?? 0.8,
        reasoningEnabled: false,
        maxTokens: 6000,
        novelId: input.novelId,
        chapterId: input.chapter.id,
        stage: "writer_condense",
        triggerReason: "length_condense",
      },
    });
    const condensed = completion.output.trim();
    if (!condensed) {
      return input.content;
    }
    const condensedLength = countChapterCharacters(condensed);
    if (condensedLength >= currentLength) {
      return input.content;
    }
    const stillOverHardMax = condensedLength > budget.hardMaxWordCount;
    this.deps.logInfo("Chapter draft auto-condensed for hard max length", {
      chapterOrder: input.chapter.order,
      beforeLength: currentLength,
      afterLength: condensedLength,
      targetWordCount: budget.targetWordCount,
      hardMaxWordCount: budget.hardMaxWordCount,
      stillOverHardMax,
    });
    if (stillOverHardMax) {
      this.deps.logWarn("Writer condense still exceeds hard max; acceptance repair will continue from the shorter draft", {
        chapterOrder: input.chapter.order,
        afterLength: condensedLength,
        hardMaxWordCount: budget.hardMaxWordCount,
      });
    }
    return condensed;
  }

  private async enforceTargetLengthRange(input: {
    novelId: string;
    novelTitle: string;
    chapter: ChapterRef;
    content: string;
    contextPackage: GenerationContextPackage;
    options: ChapterGraphLLMOptions;
  }): Promise<string> {
    const platform = await loadPlatformContext(input.novelId);
    const condensed = await this.condenseOverLength({
      ...input,
      snapshot: platform.snapshot,
      defaultChapterLength: platform.defaultChapterLength,
    });
    const extended = await this.enforceTargetLength({
      ...input,
      content: condensed,
      snapshot: platform.snapshot,
      defaultChapterLength: platform.defaultChapterLength,
    });
    if (extended === condensed) {
      return extended;
    }
    return this.condenseOverLength({
      ...input,
      content: extended,
      snapshot: platform.snapshot,
      defaultChapterLength: platform.defaultChapterLength,
    });
  }

  private async enforceTargetLength(input: {
    novelId: string;
    novelTitle: string;
    chapter: ChapterRef;
    content: string;
    contextPackage: GenerationContextPackage;
    options: ChapterGraphLLMOptions;
    snapshot: WritingPlatformSnapshot | null;
    defaultChapterLength: number | null;
  }): Promise<string> {
    const writeContext = input.contextPackage.chapterWriteContext;
    const budget = resolveChapterLengthBudget({
      writeContext,
      contextPackage: input.contextPackage,
      chapter: input.chapter,
      snapshot: input.snapshot,
      defaultChapterLength: input.defaultChapterLength,
    });
    if (!writeContext || !budget) {
      return input.content;
    }

    const currentLength = countChapterCharacters(input.content);
    if (currentLength >= budget.softMinWordCount) {
      return input.content;
    }

    const missingWordGap = Math.max(
      budget.targetWordCount - currentLength,
      budget.softMinWordCount - currentLength,
    );
    const builtBlocks = [
      ...await loadWritingPlatformBlocks(input.novelId, input.chapter.order),
      ...buildChapterWriterContextBlocks(writeContext),
    ];
    const sanitized = sanitizeWriterContextBlocks([
      createContextBlock({
        id: "current_draft_excerpt",
        group: "current_draft_excerpt",
        priority: 99,
        required: true,
        content: buildDraftContinuationBlock(
          input.content,
          budget.targetWordCount,
          budget.softMinWordCount,
        ),
      }),
      ...builtBlocks,
    ]);
    if (sanitized.removedBlockIds.length > 0) {
      this.deps.logWarn("Writer continuation blocks removed by guard", {
        chapterOrder: input.chapter.order,
        removedBlockIds: sanitized.removedBlockIds,
      });
    }
    const resolvedContext = await resolvePromptContextBlocksForAsset({
      asset: chapterWriterPrompt,
      executionContext: {
        entrypoint: "chapter_pipeline",
        novelId: input.novelId,
        chapterId: input.chapter.id,
        metadata: {
          chapterWriteContext: writeContext,
          chapterBlockMode: "full",
          ragContext: compactOpeningRagContext(input.contextPackage.ragContext, input.chapter.order, input.snapshot),
          extraContextBlocks: sanitized.allowedBlocks.filter((block) => block.group === "current_draft_excerpt"),
        },
      },
      fallbackBlocks: sanitized.allowedBlocks,
    });

    const completion = await runTextPrompt({
      asset: chapterWriterPrompt,
      promptInput: {
        novelTitle: input.novelTitle,
        chapterOrder: input.chapter.order,
        chapterTitle: input.chapter.title,
        mode: "continue",
        targetWordCount: budget.targetWordCount,
        minWordCount: budget.softMinWordCount,
        maxWordCount: budget.softMaxWordCount,
        missingWordGap,
      },
      contextBlocks: resolvedContext.blocks,
      options: {
        provider: input.options.provider,
        model: input.options.model,
        temperature: input.options.temperature ?? 0.8,
        reasoningEnabled: false,
        maxTokens: 6000,
        novelId: input.novelId,
        chapterId: input.chapter.id,
        stage: "writer_extend",
        triggerReason: "length_recovery",
      },
    });
    const appended = completion.output.trim();
    if (!appended) {
      return input.content;
    }

    const merged = `${input.content.trim()}\n\n${appended}`.trim();
    this.deps.logInfo("Chapter draft auto-extended for target length", {
      chapterOrder: input.chapter.order,
      beforeLength: currentLength,
      afterLength: countChapterCharacters(merged),
      targetWordCount: budget.targetWordCount,
      minWordCount: budget.softMinWordCount,
    });
    return merged;
  }

  async createChapterStream(input: ChapterStreamInput): Promise<{
    stream: AsyncIterable<BaseMessageChunk>;
    onDone: (fullContent: string) => Promise<{
      finalContent: string;
      lengthControl?: ChapterRuntimePackage["lengthControl"];
      artifactsAlreadySynced?: boolean;
      backgroundSyncDeferred?: boolean;
    } | void>;
  }> {
    const continuationPack = (input.contextPackage?.continuation as ContinuationPack | undefined)
      ?? await continuationService.buildChapterContextPack(input.novelId);
    const chapterWriteContext = input.contextPackage?.chapterWriteContext;
    if (!input.contextPackage || !chapterWriteContext) {
      throw new Error("Chapter runtime context is required before chapter generation.");
    }
    const contextPackage = input.contextPackage;
    const platform = await loadPlatformContext(input.novelId);
    const budget = resolveChapterLengthBudget({
      writeContext: chapterWriteContext,
      contextPackage,
      chapter: input.chapter,
      snapshot: platform.snapshot,
      defaultChapterLength: platform.defaultChapterLength,
    });
    const builtBlocks = [
      ...await loadWritingPlatformBlocks(input.novelId, input.chapter.order),
      ...buildChapterWriterContextBlocks(chapterWriteContext),
    ];
    const sanitized = sanitizeWriterContextBlocks(builtBlocks);
    if (sanitized.removedBlockIds.length > 0) {
      this.deps.logWarn("Writer context blocks removed by guard", {
        chapterOrder: input.chapter.order,
        removedBlockIds: sanitized.removedBlockIds,
      });
    }
    const resolvedContext = await resolvePromptContextBlocksForAsset({
      asset: chapterWriterPrompt,
      executionContext: {
        entrypoint: "chapter_pipeline",
        novelId: input.novelId,
        chapterId: input.chapter.id,
        metadata: {
          chapterWriteContext,
          chapterBlockMode: "full",
          ragContext: compactOpeningRagContext(contextPackage.ragContext, input.chapter.order, platform.snapshot),
        },
      },
      fallbackBlocks: sanitized.allowedBlocks,
    });

    const streamed = await streamTextPrompt({
      asset: chapterWriterPrompt,
      promptInput: {
        novelTitle: input.novelTitle,
        chapterOrder: input.chapter.order,
        chapterTitle: input.chapter.title,
        mode: "draft",
        targetWordCount: budget?.targetWordCount ?? null,
        minWordCount: budget?.softMinWordCount ?? null,
        maxWordCount: budget?.softMaxWordCount ?? null,
      },
      contextBlocks: resolvedContext.blocks,
      options: {
        provider: input.options.provider,
        model: input.options.model,
        temperature: input.options.temperature ?? 0.8,
        reasoningEnabled: false,
        maxTokens: 6000,
        novelId: input.novelId,
        chapterId: input.chapter.id,
        stage: "writer_draft",
        triggerReason: "chapter_initial_draft",
      },
    });

    return {
      stream: streamed.stream as AsyncIterable<BaseMessageChunk>,
      onDone: async (fullContent: string) => {
        const completed = await streamed.complete.catch(() => null);
        const rawContent = completed?.output ?? fullContent;
        const normalized = await this.continuityNode(
          input.novelId,
          input.chapter,
          rawContent,
          input.options,
          continuationPack,
        );
        const lengthAdjusted = await this.enforceTargetLengthRange({
          novelId: input.novelId,
          novelTitle: input.novelTitle,
          chapter: input.chapter,
          content: normalized,
          contextPackage,
          options: input.options,
        });
        const safeContent = assertChapterContentNotEmpty(lengthAdjusted, {
          novelId: input.novelId,
          chapterId: input.chapter.id,
          chapterOrder: input.chapter.order,
          source: "chapter_writer",
        });
        await this.deps.saveDraftAndArtifacts(
          input.novelId,
          input.chapter.id,
          safeContent,
          "drafted",
          {
            scheduleBackgroundSync: !input.options.deferArtifactBackgroundSync,
            syncArtifacts: false,
          },
        );
        return {
          finalContent: safeContent,
          artifactsAlreadySynced: true,
          backgroundSyncDeferred: Boolean(input.options.deferArtifactBackgroundSync),
        };
      },
    };
  }
}
