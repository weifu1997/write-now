import type { Prisma } from "@prisma/client";
import type {
  VolumePlanDocument,
  VolumePlan,
  VolumeSyncPreview,
  VolumeSyncExecutionContractWarning,
} from "@write-now/shared/types/novel";
import {
  assessChapterExecutionContractShape,
} from "@write-now/shared/types/chapterTaskSheetQuality";
import { prisma } from "../../../db/prisma";
import type { VolumeUpdateReason } from "../../../events";
import {
  buildVolumeSyncPlan,
  hasPayoffLedgerRelevantPlanChanges,
  type ExistingChapterRecord,
} from "./volumePlanUtils";
import type { VolumeSyncInput } from "./volumeModels";
import {
  mergeVolumeWorkspaceInput,
  serializeVolumeWorkspaceDocument,
} from "./volumeWorkspaceDocument";
import {
  persistActiveVolumeWorkspace,
  runVolumeWorkspaceTransaction,
} from "./volumeWorkspacePersistence";

export interface VolumeChapterSyncServiceDeps {
  ensureVolumeWorkspace: (novelId: string) => Promise<VolumePlanDocument>;
  ensureActiveVersionRecord: (
    tx: Prisma.TransactionClient,
    novelId: string,
    document: VolumePlanDocument,
    diffSummary?: string,
  ) => Promise<{ versionId: string; version: number }>;
  emitVolumeUpdated: (novelId: string, reason: VolumeUpdateReason) => void;
  syncPayoffLedger: (novelId: string) => void;
}

export interface VolumeChapterSyncOptions {
  emitEvent?: boolean;
  syncPayoffLedger?: boolean;
  volumeUpdateReason?: VolumeUpdateReason;
}

export class VolumeChapterSyncService {
  constructor(private readonly deps: VolumeChapterSyncServiceDeps) {}

  private applyChapterLinks(
    volumes: VolumePlan[],
    links: Array<{ volumeChapterId: string; chapterId: string }>,
  ): VolumePlan[] {
    if (links.length === 0) {
      return volumes;
    }
    const chapterIdByVolumeChapterId = new Map(links.map((link) => [link.volumeChapterId, link.chapterId]));
    return volumes.map((volume) => ({
      ...volume,
      chapters: volume.chapters.map((chapter) => {
        const chapterId = chapterIdByVolumeChapterId.get(chapter.id);
        return chapterId && chapter.chapterId !== chapterId
          ? { ...chapter, chapterId }
          : chapter;
      }),
    }));
  }

  async syncVolumeChaptersWithOptions(
    novelId: string,
    input: VolumeSyncInput,
    options: VolumeChapterSyncOptions = {},
  ): Promise<VolumeSyncPreview> {
    const workspace = await this.deps.ensureVolumeWorkspace(novelId);
    const mergedDocument = mergeVolumeWorkspaceInput(novelId, workspace, { volumes: input.volumes });
    // allowIncompleteExecutionContracts=true → silent skip of warning scan.
    // false/undefined → warn-only quality debt; never hard-blocks this sync.
    let incompleteExecutionContractWarnings: VolumeSyncExecutionContractWarning[] = [];
    if (!input.allowIncompleteExecutionContracts) {
      const chapterRows = await prisma.chapter.findMany({
        where: { novelId },
        select: {
          id: true,
          order: true,
          content: true,
          generationState: true,
          chapterStatus: true,
        },
      });
      incompleteExecutionContractWarnings = collectChapterExecutionContractSyncWarnings({
        document: mergedDocument,
        chapterRows,
        chapterRange: input.executionContractChapterRange,
      });
      if (incompleteExecutionContractWarnings.length > 0) {
        const orders = incompleteExecutionContractWarnings.map((warning) => warning.chapterOrder).join("、");
        console.warn(
          `[volume-chapter-sync] 第 ${orders} 章执行合同不完整，已记录为章节级质量债务，不阻断本次同步；正文执行前由 JIT 规划或章节合同服务自动修复。`,
        );
      }
    }
    const shouldSyncPayoffLedger = hasPayoffLedgerRelevantPlanChanges(workspace.volumes, mergedDocument.volumes);
    const existingChapters = await prisma.chapter.findMany({
      where: { novelId },
      orderBy: { order: "asc" },
      select: {
        id: true,
        order: true,
        title: true,
        content: true,
        generationState: true,
        chapterStatus: true,
        expectation: true,
        targetWordCount: true,
        conflictLevel: true,
        revealLevel: true,
        mustAvoid: true,
        taskSheet: true,
        sceneCards: true,
      },
    });
    const plan = buildVolumeSyncPlan(
      mergedDocument.volumes,
      existingChapters as ExistingChapterRecord[],
      {
        preserveContent: input.preserveContent !== false,
        applyDeletes: input.applyDeletes === true,
      },
    );

    await runVolumeWorkspaceTransaction(async (tx) => {
      const { versionId } = await this.deps.ensureActiveVersionRecord(tx, novelId, mergedDocument);
      const linkUpdates: Array<{ volumeChapterId: string; chapterId: string }> = [...plan.links];
      for (const item of plan.creates) {
        const created = await tx.chapter.create({
          data: {
            novelId,
            title: item.chapter.title,
            order: item.chapter.chapterOrder,
            content: "",
            expectation: item.chapter.purpose?.trim() || item.chapter.summary,
            targetWordCount: item.chapter.targetWordCount ?? null,
            conflictLevel: item.chapter.conflictLevel ?? null,
            revealLevel: item.chapter.revealLevel ?? null,
            mustAvoid: item.chapter.mustAvoid ?? null,
            taskSheet: item.chapter.taskSheet?.trim() || null,
            sceneCards: item.chapter.sceneCards ?? null,
          },
        });
        item.chapter.chapterId = created.id;
        linkUpdates.push({ volumeChapterId: item.chapter.id, chapterId: created.id });
      }
      for (const item of plan.updates) {
        item.chapter.chapterId = item.chapterId;
        await tx.chapter.updateMany({
          where: { id: item.chapterId, novelId },
          data: {
            title: item.chapter.title,
            order: item.chapter.chapterOrder,
            expectation: item.chapter.purpose?.trim() || item.chapter.summary,
            targetWordCount: item.chapter.targetWordCount ?? null,
            conflictLevel: item.chapter.conflictLevel ?? null,
            revealLevel: item.chapter.revealLevel ?? null,
            mustAvoid: item.chapter.mustAvoid ?? null,
            taskSheet: item.chapter.taskSheet?.trim() || null,
            sceneCards: item.chapter.sceneCards ?? null,
            ...(!item.preserveWorkflowState
              ? {
                generationState: "planned",
                chapterStatus: "unplanned",
              }
              : {}),
            ...(item.clearContent ? { content: "" } : {}),
          },
        });
      }
      if (plan.updates.length > 0) {
        await tx.storyPlan.updateMany({
          where: { novelId, level: "chapter", chapterId: { in: plan.updates.map((item) => item.chapterId) } },
          data: { status: "stale" },
        });
      }
      for (const item of plan.deletes) {
        await tx.chapter.deleteMany({
          where: { id: item.chapterId, novelId },
        });
      }
      const linkedDocument = {
        ...mergedDocument,
        volumes: this.applyChapterLinks(mergedDocument.volumes, linkUpdates),
        activeVersionId: versionId,
        source: "volume" as const,
      };
      await tx.volumePlanVersion.update({
        where: { id: versionId },
        data: {
          contentJson: serializeVolumeWorkspaceDocument(linkedDocument),
        },
      });
      await persistActiveVolumeWorkspace(tx, novelId, linkedDocument, versionId);
    });

    if (options.emitEvent !== false) {
      this.deps.emitVolumeUpdated(novelId, options.volumeUpdateReason ?? "chapter_sync");
    }
    if (options.syncPayoffLedger ?? shouldSyncPayoffLedger) {
      this.deps.syncPayoffLedger(novelId);
    }
    return incompleteExecutionContractWarnings.length > 0
      ? { ...plan.preview, incompleteExecutionContractWarnings }
      : plan.preview;
  }
}

export interface VolumeSyncContractChapterRow {
  id: string;
  order: number;
  content: string | null;
  generationState: string | null;
  chapterStatus: string | null;
}

/**
 * 章节已有成稿正文且流程状态已定稿时，其执行合同不会再被正文链路重建，
 * 同步门禁必须放行，避免旧结构合同卡住全书接管。
 */
export function hasFinalizedChapterProse(row: {
  content: string | null;
  generationState: string | null;
  chapterStatus: string | null;
}): boolean {
  if (typeof row.content !== "string" || !row.content.trim()) {
    return false;
  }
  return row.chapterStatus === "completed" || row.generationState === "approved";
}

/**
 * 收集同步范围内待执行章节的执行合同缺口，作为章节级质量债务随同步结果返回。
 * 已有成稿正文的章节直接跳过；待执行章节的合同缺口不阻断同步，
 * 由执行链路的 JIT 规划 / 章节合同服务在进入正文生成前修复。
 */
export function collectChapterExecutionContractSyncWarnings(input: {
  document: VolumePlanDocument;
  chapterRows: VolumeSyncContractChapterRow[];
  chapterRange?: { startOrder: number; endOrder: number };
}): VolumeSyncExecutionContractWarning[] {
  const rowsById = new Map(input.chapterRows.map((row) => [row.id, row] as const));
  const rowsByOrder = new Map(input.chapterRows.map((row) => [row.order, row] as const));
  const warnings: VolumeSyncExecutionContractWarning[] = [];
  for (const volume of input.document.volumes) {
    for (const chapter of volume.chapters) {
      if (
        input.chapterRange
        && (chapter.chapterOrder < input.chapterRange.startOrder
          || chapter.chapterOrder > input.chapterRange.endOrder)
      ) {
        continue;
      }
      const hasExecutionArtifact = Boolean(chapter.taskSheet?.trim() || chapter.sceneCards?.trim());
      if (!hasExecutionArtifact) {
        continue;
      }
      const chapterRow = (chapter.chapterId ? rowsById.get(chapter.chapterId) : undefined)
        ?? rowsByOrder.get(chapter.chapterOrder);
      if (chapterRow && hasFinalizedChapterProse(chapterRow)) {
        continue;
      }
      const result = assessChapterExecutionContractShape({
        novelId: input.document.novelId,
        volumeId: volume.id,
        chapterId: chapter.id,
        chapterOrder: chapter.chapterOrder,
        title: chapter.title,
        summary: chapter.summary,
        purpose: chapter.purpose,
        exclusiveEvent: chapter.exclusiveEvent,
        endingState: chapter.endingState,
        nextChapterEntryState: chapter.nextChapterEntryState,
        conflictLevel: chapter.conflictLevel,
        revealLevel: chapter.revealLevel,
        targetWordCount: chapter.targetWordCount,
        mustAvoid: chapter.mustAvoid,
        payoffRefs: chapter.payoffRefs,
        taskSheet: chapter.taskSheet,
        sceneCards: chapter.sceneCards,
      });
      if (!result.canEnterExecution) {
        warnings.push({
          volumeId: volume.id,
          chapterId: chapter.id,
          chapterOrder: chapter.chapterOrder,
          title: chapter.title,
          issues: result.issues.map((issue) => issue.summary),
          repairGuidance: result.repairGuidance,
        });
      }
    }
  }
  return warnings;
}
