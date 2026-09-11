import type { LLMProvider } from "@write-now/shared/types/llm";
import type { DirectorCompletionProfile } from "@write-now/shared/types/directorCompletion";
import { resolveDirectorMaxChapterCount } from "@write-now/shared/types/directorCompletion";
import type { VolumeBeat, VolumeBeatSheet, VolumePlanDocument } from "@write-now/shared/types/novel";
import { prisma } from "../../../db/prisma";
import { NovelVolumeService } from "../volume/NovelVolumeService";
import {
  getBeatExpectedChapterCount,
  resolveVolumeChapterBeatKey,
} from "../volume/volumeGenerationHelpers";

export interface ChapterRouteWindowOptions {
  min?: number;
  target?: number;
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  completionProfile?: DirectorCompletionProfile;
  /** Keeps JIT planning owned by the same auto-director task as chapter execution. */
  taskId?: string;
}

export interface ChapterRouteWindowResult {
  availableRouteCount: number;
  extended: boolean;
}

const routeWindowLocks = new Map<string, Promise<ChapterRouteWindowResult>>();

function resolveMaxChapterCount(options: ChapterRouteWindowOptions): number | null {
  return resolveDirectorMaxChapterCount(options.completionProfile);
}

function plannedChapterEnd(workspace: VolumePlanDocument): number {
  return Math.max(
    0,
    ...workspace.volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.chapterOrder)),
  );
}

function countPlannedChapters(workspace: VolumePlanDocument): number {
  return workspace.volumes.reduce((sum, volume) => sum + volume.chapters.length, 0);
}

function buildClosingGuidance(params: {
  remaining: number | null;
  compact: boolean;
}): string | undefined {
  if (params.remaining == null) {
    return undefined;
  }
  if (params.remaining <= 3) {
    return params.compact
      ? `紧凑全书终章倒计时：剩余约 ${params.remaining} 章。只生成结局合同所需的收束路线，不要创建新的主线或下一阶段钩子。`
      : `目标跨度收束倒计时：剩余约 ${params.remaining} 章。只补齐可见小结局所需路线，不要创建必须续写的新主线或下一卷入口。`;
  }
  if (params.remaining <= 8) {
    return params.compact
      ? `紧凑全书收束规划：剩余约 ${params.remaining} 章。优先完成主冲突、关系变化和未兑现回报，不扩展远期世界或新主线。`
      : `目标跨度收束规划：剩余约 ${params.remaining} 章。优先完成本阶段高潮和兑现，可以留余味，不要扩展必须续写的新主线。`;
  }
  return undefined;
}

export class ChapterRouteWindowService {
  constructor(private readonly volumeService = new NovelVolumeService()) {}

  async ensureRouteWindow(
    novelId: string,
    fromChapterOrder: number,
    options: ChapterRouteWindowOptions = {},
  ): Promise<ChapterRouteWindowResult> {
    const active = routeWindowLocks.get(novelId);
    if (active) {
      return active;
    }
    const task = this.ensureRouteWindowUnlocked(novelId, fromChapterOrder, options)
      .finally(() => routeWindowLocks.delete(novelId));
    routeWindowLocks.set(novelId, task);
    return task;
  }

  private async ensureRouteWindowUnlocked(
    novelId: string,
    fromChapterOrder: number,
    options: ChapterRouteWindowOptions,
  ): Promise<ChapterRouteWindowResult> {
    const maxChapterCount = resolveMaxChapterCount(options);
    const remainingToCap = maxChapterCount == null
      ? null
      : Math.max(0, maxChapterCount - fromChapterOrder + 1);
    const requestedMinimum = Math.max(1, options.min ?? 3);
    const requestedTarget = Math.max(requestedMinimum, options.target ?? 5);
    const minimum = remainingToCap == null ? requestedMinimum : Math.min(requestedMinimum, remainingToCap);
    const target = remainingToCap == null ? requestedTarget : Math.min(requestedTarget, remainingToCap);
    const compact = options.completionProfile?.mode === "compact_book";
    const closingGuidance = buildClosingGuidance({
      remaining: remainingToCap,
      compact,
    });
    let availableRouteCount = await this.countAvailableRoute(novelId, fromChapterOrder, maxChapterCount);
    if (!options.completionProfile) {
      return { availableRouteCount, extended: false };
    }
    if (remainingToCap != null && remainingToCap <= 0) {
      return { availableRouteCount, extended: false };
    }
    if (minimum <= 0 || availableRouteCount >= minimum) {
      return { availableRouteCount, extended: false };
    }

    let workspace = await this.volumeService.getVolumes(novelId);
    let extended = false;
    while (availableRouteCount < target) {
      if (maxChapterCount != null && countPlannedChapters(workspace) >= maxChapterCount) {
        break;
      }
      const next = this.findNextRouteTarget(workspace, maxChapterCount);
      if (!next) {
        const remainingForClose = maxChapterCount == null
          ? null
          : maxChapterCount - countPlannedChapters(workspace);
        const shouldExtendClosingBeat = remainingForClose != null
          && remainingForClose > 0
          && remainingForClose <= 8;
        const extendedByClosingBeat = shouldExtendClosingBeat
          ? await this.extendClosingVolumeLastBeat(
            novelId,
            workspace,
            options,
            closingGuidance,
            maxChapterCount,
          )
          : null;
        if (extendedByClosingBeat) {
          workspace = extendedByClosingBeat;
          extended = true;
          availableRouteCount = await this.countAvailableRoute(novelId, fromChapterOrder, maxChapterCount);
          continue;
        }
        const expandedWorkspace = await this.extendFutureVolumeSkeleton(
          novelId,
          workspace,
          options,
        );
        if (!expandedWorkspace) {
          break;
        }
        workspace = expandedWorkspace;
        extended = true;
        continue;
      }
      if (!next.beatKey) {
        workspace = await this.volumeService.generateVolumes(novelId, {
          scope: "beat_sheet",
          targetVolumeId: next.volumeId,
          draftWorkspace: workspace,
          provider: options.provider,
          model: options.model,
          temperature: options.temperature,
          taskId: options.taskId,
          guidance: closingGuidance,
          entrypoint: "jit_route_window",
        });
        workspace = await this.volumeService.updateVolumesWithOptions(novelId, workspace, {
          emitEvent: false,
          syncPayoffLedger: false,
          volumeUpdateReason: "chapter_execution_contract_refined",
        });
        continue;
      }

      workspace = await this.volumeService.generateVolumes(novelId, {
        scope: "chapter_list",
        targetVolumeId: next.volumeId,
        generationMode: "single_beat",
        targetBeatKey: next.beatKey,
        draftWorkspace: workspace,
        provider: options.provider,
        model: options.model,
        temperature: options.temperature,
        taskId: options.taskId,
        guidance: closingGuidance,
        entrypoint: "jit_route_window",
      });
      await this.volumeService.syncVolumeChaptersWithOptions(novelId, {
        volumes: workspace.volumes,
        preserveContent: true,
        applyDeletes: false,
        allowIncompleteExecutionContracts: true,
      }, {
        emitEvent: false,
        syncPayoffLedger: false,
      });
      extended = true;
      availableRouteCount = await this.countAvailableRoute(novelId, fromChapterOrder, maxChapterCount);
    }
    return { availableRouteCount, extended };
  }

  private async extendClosingVolumeLastBeat(
    novelId: string,
    workspace: VolumePlanDocument,
    options: ChapterRouteWindowOptions,
    closingGuidance: string | undefined,
    maxChapterCount: number | null,
  ): Promise<VolumePlanDocument | null> {
    if (maxChapterCount == null || countPlannedChapters(workspace) >= maxChapterCount) {
      return null;
    }
    const volumes = workspace.volumes.slice().sort((left, right) => left.sortOrder - right.sortOrder);
    const lastVolume = volumes[volumes.length - 1];
    if (!lastVolume) {
      return null;
    }
    const beatSheet = workspace.beatSheets.find((sheet) => sheet.volumeId === lastVolume.id);
    if (!beatSheet || beatSheet.beats.length === 0) {
      return null;
    }
    const lastBeat = beatSheet.beats[beatSheet.beats.length - 1];
    if (!lastBeat) {
      return null;
    }
    const remaining = maxChapterCount - countPlannedChapters(workspace);
    if (remaining <= 0) {
      return null;
    }
    const nextBeatSheet: VolumeBeatSheet = {
      ...beatSheet,
      beats: beatSheet.beats.map((beat, index) => (
        index === beatSheet.beats.length - 1
          ? this.extendBeatSpan(beat, remaining)
          : beat
      )),
    };
    const draftWorkspace: VolumePlanDocument = {
      ...workspace,
      beatSheets: workspace.beatSheets.map((sheet) => (
        sheet.volumeId === lastVolume.id ? nextBeatSheet : sheet
      )),
    };
    const generated = await this.volumeService.generateVolumes(novelId, {
      scope: "chapter_list",
      targetVolumeId: lastVolume.id,
      generationMode: "single_beat",
      targetBeatKey: lastBeat.key,
      draftWorkspace,
      provider: options.provider,
      model: options.model,
      temperature: options.temperature,
      taskId: options.taskId,
      guidance: closingGuidance,
      entrypoint: "jit_route_window",
    });
    const preserved = this.preserveExistingClosingBeatChapters(lastVolume, generated, lastBeat.key);
    await this.volumeService.syncVolumeChaptersWithOptions(novelId, {
      volumes: preserved.volumes,
      preserveContent: true,
      applyDeletes: false,
      allowIncompleteExecutionContracts: true,
    }, {
      emitEvent: false,
      syncPayoffLedger: false,
    });
    return preserved;
  }

  private preserveExistingClosingBeatChapters(
    originalVolume: VolumePlanDocument["volumes"][number],
    generated: VolumePlanDocument,
    lastBeatKey: string,
  ): VolumePlanDocument {
    const originalBeatChapters = originalVolume.chapters
      .filter((chapter) => chapter.beatKey === lastBeatKey)
      .sort((left, right) => left.chapterOrder - right.chapterOrder);
    return {
      ...generated,
      volumes: generated.volumes.map((volume) => {
        if (volume.id !== originalVolume.id) {
          return volume;
        }
        let beatIndex = 0;
        return {
          ...volume,
          chapters: volume.chapters.map((chapter) => {
            if (chapter.beatKey !== lastBeatKey) {
              return chapter;
            }
            const original = originalBeatChapters[beatIndex];
            beatIndex += 1;
            if (!original) {
              return chapter;
            }
            return {
              ...chapter,
              id: original.id,
              chapterId: original.chapterId,
              title: original.title,
              summary: original.summary,
              beatKey: original.beatKey,
            };
          }),
        };
      }),
    };
  }

  private extendBeatSpan(beat: VolumeBeat, extraChapterCount: number): VolumeBeat {
    const matches = Array.from(beat.chapterSpanHint.matchAll(/\d+/g), (match) => Number(match[0]));
    const start = matches.length > 0 && Number.isFinite(matches[0]) ? Math.max(1, matches[0]) : 1;
    const currentEnd = matches.length > 1 && Number.isFinite(matches[matches.length - 1])
      ? Math.max(start, matches[matches.length - 1])
      : start;
    return {
      ...beat,
      chapterSpanHint: `${start}-${currentEnd + Math.max(1, extraChapterCount)}章`,
    };
  }

  private async extendFutureVolumeSkeleton(
    novelId: string,
    workspace: VolumePlanDocument,
    options: ChapterRouteWindowOptions,
  ): Promise<VolumePlanDocument | null> {
    const maxChapterCount = resolveMaxChapterCount(options);
    const targetChapterCount = options.completionProfile?.targetChapterCount ?? maxChapterCount ?? 0;
    const currentPlannedEnd = plannedChapterEnd(workspace);
    if (!workspace.strategyPlan || targetChapterCount <= currentPlannedEnd) {
      return null;
    }
    if (maxChapterCount != null && countPlannedChapters(workspace) >= maxChapterCount) {
      return null;
    }

    const skeletonVolumeCount = Math.max(
      workspace.volumes.length + 1,
      workspace.strategyPlan.recommendedVolumeCount,
    );
    const generatedSkeleton = await this.volumeService.generateVolumes(novelId, {
      scope: "skeleton",
      skeletonVolumeCount,
      draftWorkspace: workspace,
      provider: options.provider,
      model: options.model,
      temperature: options.temperature,
      taskId: options.taskId,
      entrypoint: "jit_route_window",
      guidance: [
        "滚动生产需要补齐后续卷骨架。",
        "已有卷及其章节已经进入生产，必须视为固定事实；只为尚未创建的后续卷安排承接、升级和兑现。",
        `全书目标约 ${targetChapterCount} 章；当前只补卷级骨架，不拆远期章节。`,
      ].join("\n"),
    });
    const futureVolumes = generatedSkeleton.volumes.slice(workspace.volumes.length);
    if (futureVolumes.length === 0) {
      return null;
    }
    return this.volumeService.updateVolumesWithOptions(novelId, {
      volumes: [...workspace.volumes, ...futureVolumes],
      beatSheets: workspace.beatSheets,
      rebalanceDecisions: workspace.rebalanceDecisions,
    }, {
      emitEvent: false,
      syncPayoffLedger: false,
      volumeUpdateReason: "chapter_execution_contract_refined",
    });
  }

  private async countAvailableRoute(
    novelId: string,
    fromChapterOrder: number,
    maxChapterCount: number | null,
  ): Promise<number> {
    return prisma.chapter.count({
      where: {
        novelId,
        order: {
          gte: fromChapterOrder,
          ...(maxChapterCount != null ? { lte: maxChapterCount } : {}),
        },
      },
    });
  }

  private findNextRouteTarget(
    workspace: VolumePlanDocument,
    maxChapterCount: number | null,
  ): { volumeId: string; beatKey: string | null } | null {
    const volumes = workspace.volumes.slice().sort((left, right) => left.sortOrder - right.sortOrder);
    let chaptersBefore = 0;
    for (const volume of volumes) {
      const remaining = maxChapterCount == null
        ? null
        : Math.max(0, maxChapterCount - chaptersBefore);
      const beatSheet = workspace.beatSheets.find((sheet) => sheet.volumeId === volume.id);
      if (!beatSheet || beatSheet.beats.length === 0) {
        if (remaining != null && remaining <= 0) {
          chaptersBefore += volume.chapters.length;
          continue;
        }
        return { volumeId: volume.id, beatKey: null };
      }
      let generatedInPreviousBeats = 0;
      for (const beat of beatSheet.beats) {
        const originalExpected = Math.max(1, getBeatExpectedChapterCount(beat));
        const expected = remaining == null
          ? originalExpected
          : Math.min(originalExpected, Math.max(0, remaining - generatedInPreviousBeats));
        const generatedCount = volume.chapters.filter((chapter) => (
          resolveVolumeChapterBeatKey({ chapter, volume, beatSheet }) === beat.key
        )).length;
        if (expected > 0 && generatedCount < expected) {
          return { volumeId: volume.id, beatKey: beat.key };
        }
        generatedInPreviousBeats += Math.max(generatedCount, expected);
      }
      chaptersBefore += volume.chapters.length;
    }
    return null;
  }
}
