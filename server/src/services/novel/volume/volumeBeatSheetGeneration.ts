import type { VolumePlanDocument } from "@write-now/shared/types/novel";
import { runStructuredPrompt } from "../../../prompting/core/promptRunner";
import { volumeBeatSheetPrompt } from "../../../prompting/prompts/novel/volume/beatSheet.prompts";
import { buildVolumeBeatSheetContextBlocks } from "../../../prompting/prompts/novel/volume/contextBlocks";
import type { StoryMacroPlanService } from "../storyMacro/StoryMacroPlanService";
import {
  allocateChapterBudgets,
  deriveChapterBudget,
  resolveVolumePlannedChapterBudget,
} from "./volumeChapterBudgetAllocation";
import {
  getTargetVolume,
  mergeBeatSheet,
} from "./volumeGenerationHelpers";
import { isClosingVolume } from "./volumeChapterListGeneration";
import type {
  VolumeGenerateOptions,
  VolumeGenerationPhase,
  VolumeGenerationNovel,
  VolumeWorkspace,
} from "./volumeModels";

type StoryMacroPlanResult = Awaited<ReturnType<StoryMacroPlanService["getPlan"]>> | null;

export function resolveBeatSheetTargetChapterCount(input: {
  targetVolumeChapterCount: number;
  targetVolumeIndex: number;
  volumeCount: number;
  chapterBudget: number;
  chapterBudgets: number[];
}): number {
  // 与拆章校验共用"规划尺度"口径，滚动生产期重生成节奏板不会把在产卷压缩到当前进度。
  const fallbackTargetChapterCount = resolveVolumePlannedChapterBudget({
    chapterBudget: input.chapterBudget,
    chapterBudgets: input.chapterBudgets,
    targetVolumeIndex: input.targetVolumeIndex,
    volumeCount: input.volumeCount,
  });
  return Math.max(input.targetVolumeChapterCount, fallbackTargetChapterCount);
}

export async function generateBeatSheet(params: {
  document: VolumePlanDocument;
  novel: VolumeGenerationNovel;
  workspace: VolumeWorkspace;
  storyMacroPlan: StoryMacroPlanResult;
  options: VolumeGenerateOptions;
  notifyVolumeGenerationPhase: (input: {
    novelId: string;
    scope: "beat_sheet";
    phase: VolumeGenerationPhase;
    label: string;
    options: VolumeGenerateOptions;
  }) => Promise<void>;
}): Promise<VolumePlanDocument> {
  const { document, novel, workspace, storyMacroPlan, options } = params;
  const targetVolume = getTargetVolume(document, options.targetVolumeId);
  const chapterBudget = deriveChapterBudget({ novel, workspace, options });
  const chapterBudgets = allocateChapterBudgets({
    volumeCount: Math.max(document.volumes.length, 1),
    chapterBudget,
    existingVolumes: document.volumes,
  });
  const targetIndex = document.volumes.findIndex((volume) => volume.id === targetVolume.id);
  const targetChapterCount = resolveBeatSheetTargetChapterCount({
    targetVolumeChapterCount: targetVolume.chapters.length,
    targetVolumeIndex: targetIndex,
    volumeCount: document.volumes.length,
    chapterBudget,
    chapterBudgets,
  });
  await params.notifyVolumeGenerationPhase({
    novelId: document.novelId,
    scope: "beat_sheet",
    phase: "prompt",
    label: `正在生成第 ${targetVolume.sortOrder} 卷节奏板`,
    options,
  });
  const promptInput = {
    novel,
    workspace,
    storyMacroPlan,
    strategyPlan: document.strategyPlan,
    targetVolume,
    targetChapterCount,
    guidance: options.guidance,
    isClosingVolume: isClosingVolume({
      completionProfile: novel.completionProfile,
      targetVolumeIndex: targetIndex,
      volumeCount: document.volumes.length,
      chapterBudgets,
    }),
  };
  const generated = await runStructuredPrompt({
    asset: volumeBeatSheetPrompt,
    promptInput,
    contextBlocks: buildVolumeBeatSheetContextBlocks(promptInput),
    options: {
      provider: options.provider,
      model: options.model,
      temperature: options.temperature ?? 0.35,
      maxTokens: 2_800,
      novelId: document.novelId,
      volumeId: targetVolume.id,
      taskId: options.taskId,
      stage: "structured_outline",
      itemKey: "beat_sheet",
      scope: "beat_sheet",
      entrypoint: options.entrypoint,
      signal: options.signal,
    },
  });
  return mergeBeatSheet(document, targetVolume, generated.output.beats);
}
