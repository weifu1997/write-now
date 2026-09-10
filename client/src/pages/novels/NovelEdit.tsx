import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BOOK_ANALYSIS_SECTIONS } from "@write-now/shared/types/bookAnalysis";
import type { NovelExportFormat, NovelExportScope } from "@write-now/shared/types/novelExport";
import type {
  Chapter,
  PipelineRepairMode,
  PipelineRunMode,
  VolumeBeatSheet,
  VolumeCritiqueReport,
  VolumePlan,
  VolumeRebalanceDecision,
  VolumeStrategyPlan,
} from "@write-now/shared/types/novel";
import NovelEditView from "./components/NovelEditView";
import NovelProductionExperienceHandoff from "./components/NovelProductionExperienceHandoff";
import { getBaseCharacterList } from "@/api/character";
import { flattenGenreTreeOptions, getGenreTree } from "@/api/genre";
import { getDirectorBookAutomationProjection } from "@/api/novelDirector";
import { getActiveAutoDirectorTask } from "@/api/novelWorkflow";
import {
  auditNovelChapter,
  backfillNovelCharacterResources,
  confirmCharacterResourceProposal,
  extractChapterResources,
  rejectCharacterResourceProposal,
  getChapterTimeline,
  getChapterResourceContext,
  generateChapterPlan,
  getChapterAuditReports,
  getChapterPlan,
  getChapterStateSnapshot,
  getLatestStateSnapshot,
  getNovelCharacterResources,
  getNovelPayoffLedger,
  getNovelDetail,
  setNovelCreationExperience,
  downloadNovelExport,
  getNovelPipelineJob,
  getNovelVolumeWorkspace,
  getNovelQualityReport,
  replanNovel,
} from "@/api/novel";
import { flattenStoryModeTreeOptions, getStoryModeTree } from "@/api/storyMode";
import { getWorldList } from "@/api/world";
import { queryKeys } from "@/api/queryKeys";
import { toast } from "@/components/ui/toast";
import { useSSE } from "@/hooks/useSSE";
import { useLLMStore } from "@/store/llmStore";
import { buildWorldInjectionSummary } from "./novelEdit.utils";
import type { ChapterExecutionStrategy } from "./chapterExecution.utils";
import { useNovelCharacterMutations } from "./hooks/useNovelCharacterMutations";
import { useChapterExecutionActions } from "./hooks/useChapterExecutionActions";
import { useNovelContinuationSources } from "./hooks/useNovelContinuationSources";
import { useNovelEditChapterRuntime } from "./hooks/useNovelEditChapterRuntime";
import { useNovelEditMutations } from "./hooks/useNovelEditMutations";
import { useNovelEditInitialization } from "./hooks/useNovelEditInitialization";
import { useNovelWorldSlice } from "./hooks/useNovelWorldSlice";
import { useNovelStoryMacro } from "./hooks/useNovelStoryMacro";
import { useNovelVolumePlanning } from "./hooks/useNovelVolumePlanning";
import { useVolumeVersionControl } from "./hooks/useVolumeVersionControl";
import { useNovelEditWorkflow } from "./hooks/useNovelEditWorkflow";
import { useNovelEditDirectorWorkspace } from "./hooks/useNovelEditDirectorWorkspace";
import { buildNovelEditPlanningTabs } from "./novelEditPlanningTabs";
import { buildNovelEditExecutionTabs } from "./novelEditExecutionTabs";
import type { ChapterReviewResult } from "./chapterPlanning.shared";
import { isNovelWorkspaceFlowTab } from "./novelWorkspaceNavigation";
import { canCancelDirectorTask } from "@/lib/novelWorkflowTaskUi";
import { renderNovelEditTakeoverEntry, resolveActiveTakeoverStep } from "./novelEditTakeoverEntry";
import {
  createDownload,
  parsePipelineBackgroundActivities,
  resolveNovelExportFlags,
} from "./novelEditPageHelpers";
import {
  DEFAULT_ESTIMATED_CHAPTER_COUNT,
  createDefaultNovelBasicFormState,
  patchNovelBasicForm,
} from "./novelBasicInfo.shared";
import { useStructuredOutlineWorkspaceStore } from "./stores/useStructuredOutlineWorkspaceStore";
import {
  applyVolumeChapterBatch,
  buildVolumePlanningReadiness,
  buildOutlinePreviewFromVolumes,
  buildStructuredPreviewFromVolumes,
  buildVolumeSyncPreview,
  type ExistingOutlineChapter,
  type VolumeSyncOptions,
} from "./volumePlan.utils";

export default function NovelEdit() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const llm = useLLMStore();
  const queryClient = useQueryClient();
  const {
    activeTab,
    setActiveTab,
    directorTaskId,
    setDirectorTaskId,
    selectedChapterId,
    setSelectedChapterId,
    selectedVolumeId,
    setSelectedVolumeId,
    workflowTaskId,
    taskPanelOpen,
    clearTaskPanelOpen,
  } = useNovelEditWorkflow(id);
  const [isTaskDrawerOpen, setIsTaskDrawerOpen] = useState(false);
  const [basicForm, setBasicForm] = useState(() => createDefaultNovelBasicFormState());
  const [volumeDraft, setVolumeDraft] = useState<VolumePlan[]>([]);
  const [volumeStrategyPlan, setVolumeStrategyPlan] = useState<VolumeStrategyPlan | null>(null);
  const [volumeCritiqueReport, setVolumeCritiqueReport] = useState<VolumeCritiqueReport | null>(null);
  const [volumeBeatSheets, setVolumeBeatSheets] = useState<VolumeBeatSheet[]>([]);
  const [volumeRebalanceDecisions, setVolumeRebalanceDecisions] = useState<VolumeRebalanceDecision[]>([]);
  const [volumeGenerationMessage, setVolumeGenerationMessage] = useState("");
  const [outlineOptimizeInstruction, setOutlineOptimizeInstruction] = useState("");
  const [outlineOptimizePreview, setOutlineOptimizePreview] = useState("");
  const [outlineOptimizeMode, setOutlineOptimizeMode] = useState<"full" | "selection">("full");
  const [outlineOptimizeSourceText, setOutlineOptimizeSourceText] = useState("");
  const [structuredOptimizeInstruction, setStructuredOptimizeInstruction] = useState("");
  const [structuredOptimizePreview, setStructuredOptimizePreview] = useState("");
  const [structuredOptimizeMode, setStructuredOptimizeMode] = useState<"full" | "selection">("full");
  const [structuredOptimizeSourceText, setStructuredOptimizeSourceText] = useState("");
  const [volumeSyncOptions, setVolumeSyncOptions] = useState<VolumeSyncOptions>({
    preserveContent: true,
    applyDeletes: false,
  });
  const [currentJobId, setCurrentJobId] = useState("");
  const [pipelineForm, setPipelineForm] = useState({
    startOrder: 1,
    endOrder: DEFAULT_ESTIMATED_CHAPTER_COUNT,
    maxRetries: 1,
    runMode: "fast" as PipelineRunMode,
    autoReview: true,
    autoRepair: true,
    skipCompleted: true,
    qualityThreshold: 75,
    repairMode: "light_repair" as PipelineRepairMode,
  });
  const [reviewResult, setReviewResult] = useState<ChapterReviewResult | null>(null);
  const [pipelineMessage, setPipelineMessage] = useState("");
  const [structuredMessage, setStructuredMessage] = useState("");
  const [chapterOperationMessage, setChapterOperationMessage] = useState("");
  const [chapterStrategy, setChapterStrategy] = useState<ChapterExecutionStrategy>({ runMode: "fast", wordSize: "medium", conflictLevel: 60, pace: "balanced", aiFreedom: "medium" });
  const [activeChapterStream, setActiveChapterStream] = useState<{ chapterId: string; chapterLabel: string } | null>(null);
  const [activeRepairStream, setActiveRepairStream] = useState<{ chapterId: string; chapterLabel: string } | null>(null);
  const [characterMessage, setCharacterMessage] = useState("");
  const [repairBeforeContent, setRepairBeforeContent] = useState("");
  const [repairAfterContent, setRepairAfterContent] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [selectedBaseCharacterId, setSelectedBaseCharacterId] = useState("");
  const [quickCharacterForm, setQuickCharacterForm] = useState({
    name: "",
    role: "主角",
  });
  const [characterForm, setCharacterForm] = useState({
    name: "",
    role: "",
    gender: "unknown" as "male" | "female" | "other" | "unknown",
    personality: "",
    background: "",
    development: "",
    appearance: "",
    physique: "",
    attireStyle: "",
    signatureDetail: "",
    voiceTexture: "",
    presenceImpression: "",
    currentState: "",
    currentGoal: "",
  });
  const shouldLoadVolumeWorkspace = activeTab === "outline" || activeTab === "structured";
  const shouldLoadStoryMacro = activeTab === "story_macro";
  const shouldLoadWorldSlice = activeTab === "basic" || activeTab === "world";
  const shouldLoadQualityReport = activeTab === "pipeline";
  const shouldLoadLatestState = activeTab === "chapter" || activeTab === "pipeline";
  const shouldLoadPayoffLedger = activeTab === "structured" || activeTab === "chapter" || activeTab === "pipeline";
  const shouldLoadCharacterResources = activeTab === "character" || activeTab === "chapter" || activeTab === "pipeline";
  const shouldLoadChapterContext = activeTab === "chapter" && Boolean(selectedChapterId);
  const shouldLoadChapterTimeline = activeTab === "chapter" && Boolean(selectedChapterId);

  const novelDetailQuery = useQuery({
    queryKey: queryKeys.novels.detail(id),
    queryFn: () => getNovelDetail(id),
    enabled: Boolean(id),
  });
  const switchToSimpleMutation = useMutation({
    mutationFn: () => setNovelCreationExperience(id, "simple"),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.novels.detail(id) });
      navigate(`/novels/${id}/simple`, { replace: true });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "切换模式失败，请重试。"),
  });

  useEffect(() => {
    if (novelDetailQuery.data?.data?.creationExperience === "simple") {
      navigate(`/novels/${id}/simple`, { replace: true });
    }
  }, [id, navigate, novelDetailQuery.data?.data?.creationExperience]);
  const qualityReportQuery = useQuery({
    queryKey: queryKeys.novels.qualityReport(id),
    queryFn: () => getNovelQualityReport(id),
    enabled: Boolean(id && shouldLoadQualityReport),
  });
  const volumeWorkspaceQuery = useQuery({
    queryKey: queryKeys.novels.volumeWorkspace(id),
    queryFn: () => getNovelVolumeWorkspace(id),
    enabled: Boolean(id && shouldLoadVolumeWorkspace),
  });
  const latestStateSnapshotQuery = useQuery({
    queryKey: queryKeys.novels.latestStateSnapshot(id),
    queryFn: () => getLatestStateSnapshot(id),
    enabled: Boolean(id && shouldLoadLatestState),
  });
  const chapterStateSnapshotQuery = useQuery({
    queryKey: queryKeys.novels.chapterStateSnapshot(id, selectedChapterId || "none"),
    queryFn: () => getChapterStateSnapshot(id, selectedChapterId),
    enabled: Boolean(id && selectedChapterId),
  });
  const payoffLedgerChapterOrder = useMemo(() => {
    const orders = novelDetailQuery.data?.data?.chapters?.map((chapter) => chapter.order) ?? [];
    return orders.length > 0 ? Math.max(...orders) : undefined;
  }, [novelDetailQuery.data?.data?.chapters]);
  const payoffLedgerQuery = useQuery({
    queryKey: queryKeys.novels.payoffLedger(id, payoffLedgerChapterOrder),
    queryFn: () => getNovelPayoffLedger(id, payoffLedgerChapterOrder),
    enabled: Boolean(id && shouldLoadPayoffLedger),
  });
  const characterResourcesQuery = useQuery({
    queryKey: queryKeys.novels.characterResources(id),
    queryFn: () => getNovelCharacterResources(id),
    enabled: Boolean(id && shouldLoadCharacterResources),
  });
  const chapterResourceContextQuery = useQuery({
    queryKey: queryKeys.novels.characterResourceContext(id, selectedChapterId || "none"),
    queryFn: () => getChapterResourceContext(id, selectedChapterId),
    enabled: Boolean(id && shouldLoadChapterContext),
  });
  const chapterTimelineQuery = useQuery({
    queryKey: queryKeys.novels.chapterTimeline(id, selectedChapterId || "none"),
    queryFn: () => getChapterTimeline(id, selectedChapterId),
    enabled: Boolean(id && shouldLoadChapterTimeline),
  });
  const activeAutoDirectorTaskQuery = useQuery({
    queryKey: queryKeys.novels.autoDirectorTask(id),
    queryFn: () => getActiveAutoDirectorTask(id),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const task = query.state.data?.data;
      return task && (task.status === "queued" || task.status === "running" || task.status === "waiting_approval")
        ? 4000
        : false;
    },
  });
  const bookAutomationQuery = useQuery({
    queryKey: queryKeys.novels.directorBookAutomation(id),
    queryFn: () => getDirectorBookAutomationProjection(id),
    enabled: Boolean(id),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.projection.status;
      return status === "queued" || status === "running" || status === "waiting_approval" ? 4000 : false;
    },
  });
  const chapterPlanQuery = useQuery({
    queryKey: queryKeys.novels.chapterPlan(id, selectedChapterId || "none"),
    queryFn: () => getChapterPlan(id, selectedChapterId),
    enabled: Boolean(id && shouldLoadChapterContext),
  });
  const chapterAuditReportsQuery = useQuery({
    queryKey: queryKeys.novels.chapterAuditReports(id, selectedChapterId || "none"),
    queryFn: () => getChapterAuditReports(id, selectedChapterId),
    enabled: Boolean(id && shouldLoadChapterContext),
  });
  const baseCharacterListQuery = useQuery({
    queryKey: queryKeys.baseCharacters.all,
    queryFn: () => getBaseCharacterList(),
  });
  const worldListQuery = useQuery({
    queryKey: queryKeys.worlds.all,
    queryFn: getWorldList,
  });
  const genreTreeQuery = useQuery({
    queryKey: queryKeys.genres.all,
    queryFn: getGenreTree,
  });
  const storyModeTreeQuery = useQuery({
    queryKey: queryKeys.storyModes.all,
    queryFn: getStoryModeTree,
  });
  const genreOptions = useMemo(() => flattenGenreTreeOptions(genreTreeQuery.data?.data ?? []), [genreTreeQuery.data?.data]);
  const storyModeOptions = useMemo(
    () => flattenStoryModeTreeOptions(storyModeTreeQuery.data?.data ?? []),
    [storyModeTreeQuery.data?.data],
  );

  const {
    sourceBookAnalysesQuery,
    sourceNovelOptions,
    sourceKnowledgeOptions,
    sourceNovelBookAnalysisOptions,
  } = useNovelContinuationSources(id, {
    writingMode: basicForm.writingMode,
    continuationSourceType: basicForm.continuationSourceType,
    sourceNovelId: basicForm.sourceNovelId,
    sourceKnowledgeDocumentId: basicForm.sourceKnowledgeDocumentId,
  });

  const { tab: storyMacroTab } = useNovelStoryMacro({
    novelId: id,
    enabled: shouldLoadStoryMacro,
    llm,
  });
  const {
    worldSliceMessage,
    novelWorldView,
    novelWorldSyncDiff,
    worldSliceView,
    isLoadingNovelWorld,
    isImportingNovelWorld,
    isGeneratingNovelWorld,
    isCreatingManualNovelWorld,
    isSavingNovelWorldToLibrary,
    isLoadingNovelWorldSyncDiff,
    isSyncingNovelWorld,
    isRefreshingWorldSlice,
    isSavingWorldSliceOverrides,
    importNovelWorld,
    createManualNovelWorld,
    generateNovelWorld,
    saveNovelWorldToLibrary,
    syncNovelWorld,
    refreshWorldSlice,
    saveWorldSliceOverrides,
  } = useNovelWorldSlice({
    novelId: id,
    enabled: shouldLoadWorldSlice,
    llm,
    queryClient,
    onNovelWorldImported: (worldId) => setBasicForm((prev) => ({ ...prev, worldId })),
  });
  const pipelineJobQuery = useQuery({
    queryKey: queryKeys.novels.pipelineJob(id, currentJobId || "none"),
    queryFn: () => getNovelPipelineJob(id, currentJobId),
    enabled: Boolean(id && currentJobId),
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status;
      if (status === "queued" || status === "running") {
        return 1500;
      }
      return false;
    },
  });
  const exportNovelMutation = useMutation({
    mutationFn: async (input: {
      format: NovelExportFormat;
      scope: NovelExportScope;
      novelTitle: string;
    }) => {
      const exported = await downloadNovelExport(id, input.format, input.scope, input.novelTitle);
      return {
        ...exported,
        scope: input.scope,
        format: input.format,
      };
    },
    onSuccess: ({ blob, fileName, scope }) => {
      createDownload(blob, fileName);
      toast.success(scope === "full" ? "整本书导出已开始。" : "当前步骤导出已开始。");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "导出失败。");
    },
  });

  const chapters = useMemo(() => novelDetailQuery.data?.data?.chapters ?? [], [novelDetailQuery.data?.data?.chapters]);
  const outlineSyncChapters = useMemo<ExistingOutlineChapter[]>(
    () => chapters.map((chapter) => ({
      id: chapter.id,
      order: chapter.order,
      title: chapter.title,
      content: chapter.content ?? "",
      expectation: chapter.expectation ?? "",
      targetWordCount: chapter.targetWordCount ?? null,
      conflictLevel: chapter.conflictLevel ?? null,
      revealLevel: chapter.revealLevel ?? null,
      mustAvoid: chapter.mustAvoid ?? null,
      taskSheet: chapter.taskSheet ?? null,
    })),
    [chapters],
  );
  const selectedChapter = useMemo(
    () => chapters.find((item) => item.id === selectedChapterId),
    [chapters, selectedChapterId],
  );
  const characters = novelDetailQuery.data?.data?.characters ?? [];
  const baseCharacters = baseCharacterListQuery.data?.data ?? [];
  const selectedCharacter = useMemo(
    () => characters.find((item) => item.id === selectedCharacterId),
    [characters, selectedCharacterId],
  );
  const selectedBaseCharacter = useMemo(
    () => baseCharacters.find((item) => item.id === selectedBaseCharacterId),
    [baseCharacters, selectedBaseCharacterId],
  );
  const exportNovelTitle = useMemo(
    () => basicForm.title.trim() || novelDetailQuery.data?.data?.title?.trim() || id,
    [basicForm.title, novelDetailQuery.data?.data?.title, id],
  );
  const currentExportScope = isNovelWorkspaceFlowTab(activeTab) && activeTab !== "world" ? activeTab : null;
  const importedBaseCharacterIds = useMemo(
    () => new Set(
      characters
        .map((item) => item.baseCharacterId)
        .filter((item): item is string => Boolean(item)),
    ),
    [characters],
  );
  const hasCharacters = characters.length > 0;
  const savedVolumeWorkspace = volumeWorkspaceQuery.data?.data ?? null;
  const {
    normalizedVolumeDraft,
    hasUnsavedVolumeDraft,
    generationNotice,
    readiness,
    volumeCountGuidance,
    customVolumeCountEnabled,
    customVolumeCountInput,
    onCustomVolumeCountEnabledChange,
    onCustomVolumeCountInputChange,
    onApplyCustomVolumeCount,
    onRestoreSystemRecommendedVolumeCount,
    isGeneratingStrategy,
    isCritiquingStrategy,
    isGeneratingSkeleton,
    isGeneratingBeatSheet,
    isGeneratingChapterList,
    generatingChapterListVolumeId,
    generatingChapterListBeatKey,
    generatingChapterListMode,
    isGeneratingChapterDetail,
    isGeneratingChapterDetailBundle,
    generatingChapterDetailMode,
    generatingChapterDetailChapterId,
    chapterDetailFailure,
    startStrategyGeneration,
    startStrategyCritique,
    startSkeletonGeneration,
    startBeatSheetGeneration,
    startChapterListGeneration,
    startChapterDetailGeneration,
    startChapterDetailBundleGeneration,
    retryFailedChapterDetail,
    handleVolumeFieldChange,
    handleOpenPayoffsChange,
    handleAddVolume,
    handleRemoveVolume,
    handleMoveVolume,
    handleChapterFieldChange,
    handleChapterNumberChange,
    handleChapterPayoffRefsChange,
    handleAddChapter,
    handleRemoveChapter,
    handleMoveChapter,
  } = useNovelVolumePlanning({
    novelId: id,
    hasCharacters,
    llm,
    estimatedChapterCount: basicForm.estimatedChapterCount,
    volumeDraft,
    strategyPlan: volumeStrategyPlan,
    critiqueReport: volumeCritiqueReport,
    beatSheets: volumeBeatSheets,
    rebalanceDecisions: volumeRebalanceDecisions,
    savedWorkspace: savedVolumeWorkspace,
    setVolumeDraft,
    setStrategyPlan: setVolumeStrategyPlan,
    setCritiqueReport: setVolumeCritiqueReport,
    setBeatSheets: setVolumeBeatSheets,
    setRebalanceDecisions: setVolumeRebalanceDecisions,
    setVolumeGenerationMessage,
    setStructuredMessage,
  });
  const volumeSyncPreview = useMemo(
    () => buildVolumeSyncPreview(normalizedVolumeDraft, outlineSyncChapters, volumeSyncOptions),
    [normalizedVolumeDraft, outlineSyncChapters, volumeSyncOptions],
  );
  const coreCharacterCount = useMemo(
    () => characters.filter((item) => /主角|反派/.test(item.role)).length,
    [characters],
  );
  const bible = novelDetailQuery.data?.data?.bible;
  const plotBeats = novelDetailQuery.data?.data?.plotBeats ?? [];
  const maxOrder = useMemo(
    () => chapters.reduce((max, chapter) => Math.max(max, chapter.order), 1),
    [chapters],
  );
  const worldInjectionSummary = useMemo(
    () => buildWorldInjectionSummary(novelDetailQuery.data?.data?.world),
    [novelDetailQuery.data?.data?.world],
  );
  const qualitySummary = qualityReportQuery.data?.data?.summary;
  const chapterQualityReport = useMemo(() => (qualityReportQuery.data?.data?.chapterReports ?? []).find((item) => item.chapterId === selectedChapterId), [qualityReportQuery.data?.data?.chapterReports, selectedChapterId]);
  const chapterPlan = chapterPlanQuery.data?.data ?? null;
  const chapterTimeline = chapterTimelineQuery.data?.data ?? null;
  const latestStateSnapshot = latestStateSnapshotQuery.data?.data ?? null;
  const chapterStateSnapshot = chapterStateSnapshotQuery.data?.data ?? null;
  const payoffLedger = payoffLedgerQuery.data?.data ?? null;
  const characterResources = characterResourcesQuery.data?.data?.items ?? [];
  const pendingCharacterResourceProposals = characterResourcesQuery.data?.data?.pendingProposals ?? [];
  const chapterResourceContext = chapterResourceContextQuery.data?.data ?? null;
  const chapterAuditReports = chapterAuditReportsQuery.data?.data ?? [];
  const pipelineBackgroundActivities = useMemo(
    () => parsePipelineBackgroundActivities(pipelineJobQuery.data?.data?.payload ?? null),
    [pipelineJobQuery.data?.data?.payload],
  );
  const {
    activeAutoDirectorFollowUp,
    activeAutoDirectorTask,
    activeDirectorRuntimeBlockedReason,
    activeDirectorRuntimeHardBlocked,
    activeDirectorRuntimeSnapshot,
    activeDirectorSession,
    activeDirectorSnapshot,
    activeStructuredOutlineChapterId,
    bookAutomationProjection,
    chapterPendingCharacterResourceProposals,
    displayAutoDirectorTask,
    executeFollowUpActionMutation,
    handleDrawerFollowUpAction,
    handleTaskDrawerProjectionAction,
    isTakeoverDismissed,
    openAuditIssueIds,
    openAutoDirectorTaskCenter,
    retryAutoDirectorWithCurrentModelMutation,
    retryAutoDirectorWithTaskModelMutation,
    takeover,
    taskDrawerActions,
    workflowCurrentTab,
    retryOverride,
    setRetryOverride,
  } = useNovelEditDirectorWorkspace({
    id,
    activeTab,
    directorTaskId,
    taskPanelOpen,
    hasUnsavedVolumeDraft,
    chapters,
    characters,
    chapterAuditReports,
    pendingCharacterResourceProposals,
    selectedChapterId,
    selectedVolumeId,
    selectedChapterOrder: selectedChapter?.order,
    payoffLedgerChapterOrder,
    llm,
    navigate,
    queryClient,
    novelTitle: novelDetailQuery.data?.data?.title,
    setActiveTab,
    setDirectorTaskId,
    setSelectedChapterId,
    setSelectedVolumeId,
    setIsTaskDrawerOpen,
    activeAutoDirectorTaskQuery,
    bookAutomationQuery,
  });

  useNovelEditInitialization({
    detail: novelDetailQuery.data?.data,
    chapters,
    characters,
    baseCharacters,
    basicForm,
    selectedCharacter,
    selectedChapterId,
    selectedCharacterId,
    selectedBaseCharacterId,
    sourceNovelBookAnalysisOptions,
    sourceBookAnalysesLoading: sourceBookAnalysesQuery.isLoading,
    sourceBookAnalysesFetching: sourceBookAnalysesQuery.isFetching,
    hydrateVolumeDraftFromDetail: !shouldLoadVolumeWorkspace,
    setBasicForm,
    setVolumeDraft,
    setPipelineForm,
    setSelectedChapterId,
    setSelectedCharacterId,
    setSelectedBaseCharacterId,
    setCharacterForm,
  });

  useEffect(() => {
    const workspace = volumeWorkspaceQuery.data?.data;
    if (!workspace) {
      return;
    }
    // 草稿有未保存改动时跳过水合：生成分卷/章节列表期间工作区查询每 2 秒
    // 轮询刷新，直接回灌会把用户正在编辑的内容清回已保存状态。
    if (hasUnsavedVolumeDraft) {
      return;
    }
    setVolumeDraft(workspace.volumes ?? []);
    setVolumeStrategyPlan(workspace.strategyPlan ?? null);
    setVolumeCritiqueReport(workspace.critiqueReport ?? null);
    setVolumeBeatSheets(workspace.beatSheets ?? []);
    setVolumeRebalanceDecisions(workspace.rebalanceDecisions ?? []);
  }, [volumeWorkspaceQuery.data?.data, hasUnsavedVolumeDraft]);

  useEffect(() => {
    if (!id) {
      return;
    }
    useStructuredOutlineWorkspaceStore.getState().patchWorkspace(id, {
      selectedVolumeId: selectedVolumeId || undefined,
      selectedChapterId: selectedChapterId || undefined,
    });
  }, [id, selectedChapterId, selectedVolumeId]);

  useEffect(() => {
    if (!id || activeTab !== "structured" || !activeStructuredOutlineChapterId) {
      return;
    }
    const targetVolume = normalizedVolumeDraft.find((volume) => (
      volume.chapters.some((chapter) => (
        chapter.id === activeStructuredOutlineChapterId
        || chapter.chapterId === activeStructuredOutlineChapterId
      ))
    ));
    if (!targetVolume) {
      return;
    }
    const currentWorkspace = useStructuredOutlineWorkspaceStore.getState().workspaces[id];
    if (
      currentWorkspace?.selectedChapterId === activeStructuredOutlineChapterId
      && currentWorkspace.selectedVolumeId === targetVolume.id
      && currentWorkspace.selectedBeatKey === "all"
    ) {
      return;
    }
    useStructuredOutlineWorkspaceStore.getState().patchWorkspace(id, {
      selectedVolumeId: targetVolume.id,
      selectedChapterId: activeStructuredOutlineChapterId,
      selectedBeatKey: "all",
    });
  }, [activeStructuredOutlineChapterId, activeTab, id, normalizedVolumeDraft]);

  const outlineText = useMemo(
    () => buildOutlinePreviewFromVolumes(normalizedVolumeDraft),
    [normalizedVolumeDraft],
  );
  const structuredDraftText = useMemo(
    () => buildStructuredPreviewFromVolumes(normalizedVolumeDraft),
    [normalizedVolumeDraft],
  );
  const draftVolumeDocument = useMemo(() => ({
    novelId: id,
    workspaceVersion: "v2" as const,
    volumes: normalizedVolumeDraft,
    strategyPlan: volumeStrategyPlan,
    critiqueReport: volumeCritiqueReport,
    beatSheets: volumeBeatSheets,
    rebalanceDecisions: volumeRebalanceDecisions,
    readiness: buildVolumePlanningReadiness({
      volumes: normalizedVolumeDraft,
      strategyPlan: volumeStrategyPlan,
      critiqueReport: volumeCritiqueReport,
      beatSheets: volumeBeatSheets,
    }),
    derivedOutline: outlineText,
    derivedStructuredOutline: structuredDraftText,
    source: savedVolumeWorkspace?.source ?? "volume",
    activeVersionId: savedVolumeWorkspace?.activeVersionId ?? null,
  }), [
    id,
    normalizedVolumeDraft,
    outlineText,
    savedVolumeWorkspace?.activeVersionId,
    savedVolumeWorkspace?.source,
    structuredDraftText,
    volumeBeatSheets,
    volumeCritiqueReport,
    volumeRebalanceDecisions,
    volumeStrategyPlan,
  ]);

  const invalidateNovelDetail = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.novels.detail(id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.novels.volumeWorkspace(id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.novels.qualityReport(id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.novels.latestStateSnapshot(id) });
    await queryClient.invalidateQueries({ queryKey: ["novels", "payoff-ledger", id] });
    await queryClient.invalidateQueries({ queryKey: queryKeys.novels.worldSlice(id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterDynamicsOverview(id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterCandidates(id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterCastOptions(id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterRelations(id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterResources(id) });
    await queryClient.invalidateQueries({ queryKey: ["novels", "chapter-plan", id] });
    await queryClient.invalidateQueries({ queryKey: ["novels", "chapter-audit-reports", id] });
    await queryClient.invalidateQueries({ queryKey: ["novels", "chapter-timeline", id] });
    await queryClient.invalidateQueries({ queryKey: ["novels", "state-snapshots", id] });
  };

  const invalidateCharacterResourceViews = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterResources(id) });
    if (selectedChapterId) {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.novels.characterResourceContext(id, selectedChapterId),
      });
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.novels.latestStateSnapshot(id) });
    await queryClient.invalidateQueries({ queryKey: ["novels", "state-snapshots", id] });
  };

  const confirmCharacterResourceProposalMutation = useMutation({
    mutationFn: (proposalId: string) => confirmCharacterResourceProposal(id, proposalId),
    onSuccess: async () => {
      await invalidateCharacterResourceViews();
      toast.success("资源变更已确认，后续写作会参考它。");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "确认资源变更失败。");
    },
  });

  const rejectCharacterResourceProposalMutation = useMutation({
    mutationFn: (proposalId: string) => rejectCharacterResourceProposal(id, proposalId),
    onSuccess: async () => {
      await invalidateCharacterResourceViews();
      toast.success("资源变更已忽略。");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "忽略资源变更失败。");
    },
  });

  const extractChapterResourcesMutation = useMutation({
    mutationFn: async () => {
      if (!selectedChapterId) {
        throw new Error("请先选择要复查资源的章节。");
      }
      return extractChapterResources(id, selectedChapterId, {
        provider: llm.provider,
        model: llm.model,
      });
    },
    onSuccess: async (response) => {
      await invalidateCharacterResourceViews();
      const committedCount = response.data?.committed.length ?? 0;
      const pendingCount = response.data?.pendingReview.length ?? 0;
      if (pendingCount > 0) {
        toast.success(`已复查本章资源，${pendingCount} 个变更需要你判断。`);
        return;
      }
      toast.success(committedCount > 0
        ? `已复查本章资源，${committedCount} 个变更会用于后续写作。`
        : "已复查本章资源，未发现需要更新的关键资源。");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "复查本章资源失败。");
    },
  });

  const backfillCharacterResourcesMutation = useMutation({
    mutationFn: () => backfillNovelCharacterResources(id, {
      provider: llm.provider,
      model: llm.model,
      limit: 3,
    }),
    onSuccess: async (response) => {
      await invalidateCharacterResourceViews();
      const scanned = response.data?.scannedChapterCount ?? 0;
      const committed = response.data?.committedCount ?? 0;
      const pending = response.data?.pendingReviewCount ?? 0;
      toast.success(pending > 0
        ? `已回填最近 ${scanned} 章资源，${pending} 条变化需要你判断。`
        : `已回填最近 ${scanned} 章资源，${committed} 条变化会用于后续写作。`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "回填角色资源失败。");
    },
  });

  const chapterSSE = useSSE({
    onRunStatus: (payload) => {
      if ((payload.phase === "finalizing" || payload.phase === "completed") && payload.message) {
        setChapterOperationMessage(payload.message);
      }
    },
    onDone: async () => {
      await invalidateNovelDetail();
      setActiveChapterStream(null);
    },
  });
  const bibleSSE = useSSE({ onDone: invalidateNovelDetail });
  const beatsSSE = useSSE({ onDone: invalidateNovelDetail });
  const repairSSE = useSSE({
    onRunStatus: (payload) => {
      if ((payload.phase === "finalizing" || payload.phase === "completed") && payload.message) {
        setChapterOperationMessage(payload.message);
      }
    },
    onDone: async (fullContent) => {
      setRepairAfterContent(fullContent);
      await invalidateNovelDetail();
      setActiveRepairStream(null);
    },
  });

  const {
    saveBasicMutation,
    saveOutlineMutation,
    saveStructuredMutation,
    optimizeOutlineMutation,
    optimizeStructuredMutation,
    syncStructuredChaptersMutation,
    createChapterMutation,
    deleteManualChapterMutation,
    runPipelineMutation,
    reviewMutation,
    hookMutation,
  } = useNovelEditMutations({
    id,
    basicForm,
    hasCharacters,
    outlineText,
    outlineOptimizeInstruction,
    setOutlineOptimizePreview,
    setOutlineOptimizeMode,
    setOutlineOptimizeSourceText,
    structuredDraftText,
    structuredOptimizeInstruction,
    setStructuredOptimizePreview,
    setStructuredOptimizeMode,
    setStructuredOptimizeSourceText,
    volumeDocument: draftVolumeDocument,
    llm,
    pipelineForm,
    selectedChapterId,
    chapterCount: novelDetailQuery.data?.data?.chapters?.length ?? 0,
    chapters,
    setActiveTab,
    setSelectedChapterId,
    setCurrentJobId,
    setPipelineMessage,
    setStructuredMessage,
    setReviewResult,
    queryClient,
    invalidateNovelDetail,
  });

  const {
    characterTimelineQuery,
    syncTimelineMutation,
    syncAllTimelineMutation,
    evolveCharacterMutation,
    generateVisibleProfileMutation,
    applyVisibleProfileMutation,
    generateBatchVisibleProfilesMutation,
    applyBatchVisibleProfilesMutation,
    worldCheckMutation,
    saveCharacterMutation,
    importBaseCharacterMutation,
    quickCreateCharacterMutation,
    deleteCharacterMutation,
    generateSupplementalCharacterMutation,
    applySupplementalCharacterMutation,
  } = useNovelCharacterMutations({
    id,
    selectedCharacterId,
    selectedBaseCharacter,
    characters,
    pipelineForm,
    llm,
    characterForm,
    quickCharacterForm,
    queryClient,
    setCharacterMessage,
    setSelectedCharacterId,
    setQuickCharacterForm,
  });

  const {
    volumeMessage,
    volumeVersions,
    selectedVersionId,
    setSelectedVersionId,
    diffResult,
    impactResult,
    createDraftVersionMutation,
    activateVersionMutation,
    freezeVersionMutation,
    diffMutation,
    analyzeDraftImpactMutation,
    analyzeVersionImpactMutation,
    loadSelectedVersionToDraft,
  } = useVolumeVersionControl({
    novelId: id,
    draftDocument: draftVolumeDocument,
    setDraftVolumes: setVolumeDraft,
    setStrategyPlan: setVolumeStrategyPlan,
    setCritiqueReport: setVolumeCritiqueReport,
    setBeatSheets: setVolumeBeatSheets,
    setRebalanceDecisions: setVolumeRebalanceDecisions,
    queryClient,
    invalidateNovelDetail,
  });

  const goToCharacterTab = () => setActiveTab("character");
  const goToStructuredTab = () => setActiveTab("structured");
  const {
    generateChapterPlanMutation,
    replanChapterMutation,
    fullAuditMutation,
    reviewActionKind,
    runChapterReview,
    handleGenerateSelectedChapter,
    handleAbortChapterStream,
    handleAbortRepair,
    chapterExecutionActions,
  } = useNovelEditChapterRuntime({
    novelId: id,
    llm,
    selectedChapterId,
    selectedChapter,
    chapterStrategy,
    reviewResult,
    openAuditIssueIds,
    queryClient,
    invalidateNovelDetail,
    setChapterOperationMessage,
    setReviewResult,
    setRepairBeforeContent,
    setRepairAfterContent,
    setActiveChapterStream,
    setActiveRepairStream,
    chapterSSE,
    repairSSE,
  });

  const { basicTab, outlineTab, structuredTab } = buildNovelEditPlanningTabs({
    id,
    basicForm,
    genreOptions,
    storyModeOptions,
    worldOptions: worldListQuery.data?.data ?? [],
    sourceNovelOptions,
    sourceKnowledgeOptions,
    sourceNovelBookAnalysisOptions,
    isLoadingSourceNovelBookAnalyses: sourceBookAnalysesQuery.isLoading,
    availableBookAnalysisSections: [...BOOK_ANALYSIS_SECTIONS],
    novelWorldView,
    novelWorldSyncDiff,
    worldSliceView,
    worldSliceMessage,
    isLoadingNovelWorld,
    isImportingNovelWorld,
    isGeneratingNovelWorld,
    isCreatingManualNovelWorld,
    isSavingNovelWorldToLibrary,
    isLoadingNovelWorldSyncDiff,
    isSyncingNovelWorld,
    isRefreshingWorldSlice,
    isSavingWorldSliceOverrides,
    onBasicFormChange: (patch) => setBasicForm((prev) => patchNovelBasicForm(prev, patch)),
    onSaveBasic: () => saveBasicMutation.mutate(),
    onImportNovelWorld: importNovelWorld,
    onCreateManualNovelWorld: createManualNovelWorld,
    onGenerateNovelWorld: generateNovelWorld,
    onSaveNovelWorldToLibrary: saveNovelWorldToLibrary,
    onSyncNovelWorld: syncNovelWorld,
    onRefreshWorldSlice: refreshWorldSlice,
    onSaveWorldSliceOverrides: saveWorldSliceOverrides,
    isSavingBasic: saveBasicMutation.isPending,
    projectQuickStart: undefined,
    basicDirectorTakeoverEntry: undefined,
    storyMacroDirectorTakeoverEntry: undefined,
    outlineDirectorTakeoverEntry: undefined,
    structuredDirectorTakeoverEntry: undefined,
    worldInjectionSummary,
    hasCharacters,
    hasUnsavedVolumeDraft,
    generationNotice,
    readiness,
    volumeCountGuidance,
    customVolumeCountEnabled,
    customVolumeCountInput,
    onCustomVolumeCountEnabledChange,
    onCustomVolumeCountInputChange,
    onApplyCustomVolumeCount,
    onRestoreSystemRecommendedVolumeCount,
    strategyPlan: volumeStrategyPlan,
    critiqueReport: volumeCritiqueReport,
    isGeneratingStrategy,
    onGenerateStrategy: startStrategyGeneration,
    isCritiquingStrategy,
    onCritiqueStrategy: startStrategyCritique,
    isGeneratingSkeleton,
    onGenerateSkeleton: startSkeletonGeneration,
    onGoToCharacterTab: goToCharacterTab,
    onGoToStructuredTab: goToStructuredTab,
    latestStateSnapshot,
    payoffLedger,
    characterResources,
    outlineText,
    structuredDraftText,
    volumes: normalizedVolumeDraft,
    onVolumeFieldChange: handleVolumeFieldChange,
    onOpenPayoffsChange: handleOpenPayoffsChange,
    onAddVolume: handleAddVolume,
    onRemoveVolume: handleRemoveVolume,
    onMoveVolume: handleMoveVolume,
    onSaveOutline: () => saveOutlineMutation.mutate(),
    isSavingOutline: saveOutlineMutation.isPending,
    volumeMessage: volumeGenerationMessage || volumeMessage,
    volumeVersions,
    selectedVersionId,
    onSelectedVersionChange: setSelectedVersionId,
    onCreateDraftVersion: () => createDraftVersionMutation.mutate(),
    isCreatingDraftVersion: createDraftVersionMutation.isPending,
    onLoadSelectedVersionToDraft: loadSelectedVersionToDraft,
    onActivateVersion: () => activateVersionMutation.mutate(),
    isActivatingVersion: activateVersionMutation.isPending,
    onFreezeVersion: () => freezeVersionMutation.mutate(),
    isFreezingVersion: freezeVersionMutation.isPending,
    onLoadVersionDiff: () => diffMutation.mutate(),
    isLoadingVersionDiff: diffMutation.isPending,
    diffResult,
    onAnalyzeDraftImpact: () => analyzeDraftImpactMutation.mutate(),
    isAnalyzingDraftImpact: analyzeDraftImpactMutation.isPending,
    onAnalyzeVersionImpact: () => analyzeVersionImpactMutation.mutate(),
    isAnalyzingVersionImpact: analyzeVersionImpactMutation.isPending,
    impactResult,
    beatSheets: volumeBeatSheets,
    rebalanceDecisions: volumeRebalanceDecisions,
    isGeneratingBeatSheet,
    onGenerateBeatSheet: startBeatSheetGeneration,
    isGeneratingChapterList,
    generatingChapterListVolumeId,
    generatingChapterListBeatKey,
    generatingChapterListMode,
    onGenerateChapterList: startChapterListGeneration,
    isGeneratingChapterDetail,
    isGeneratingChapterDetailBundle,
    generatingChapterDetailMode,
    generatingChapterDetailChapterId,
    chapterDetailFailure,
    onGenerateChapterDetail: startChapterDetailGeneration,
    onGenerateChapterDetailBundle: startChapterDetailBundleGeneration,
    onRetryFailedChapterDetail: retryFailedChapterDetail,
    syncPreview: volumeSyncPreview,
    syncOptions: volumeSyncOptions,
    onSyncOptionsChange: (patch) => setVolumeSyncOptions((prev) => ({ ...prev, ...patch })),
    onApplySync: (options) => syncStructuredChaptersMutation.mutate(options),
    isApplyingSync: syncStructuredChaptersMutation.isPending,
    syncMessage: structuredMessage,
    chapters: outlineSyncChapters,
    onChapterFieldChange: handleChapterFieldChange,
    onChapterNumberChange: handleChapterNumberChange,
    onChapterPayoffRefsChange: handleChapterPayoffRefsChange,
    onAddChapter: handleAddChapter,
    onRemoveChapter: handleRemoveChapter,
    onMoveChapter: handleMoveChapter,
    onApplyBatch: (patch) => {
      setVolumeDraft((prev) => applyVolumeChapterBatch(prev, patch));
    },
    onSaveStructured: () => saveStructuredMutation.mutate(),
    isSavingStructured: saveStructuredMutation.isPending,
  });
  const { chapterTab, pipelineTab, characterTab } = buildNovelEditExecutionTabs({
    id,
    worldInjectionSummary,
    hasCharacters,
    chapters,
    characters,
    selectedChapterId,
    selectedChapter,
    setSelectedChapterId,
    goToCharacterTab,
    createChapterMutation,
    deleteManualChapterMutation,
    chapterOperationMessage,
    chapterStrategy,
    setChapterStrategy,
    chapterExecutionActions,
    handleGenerateSelectedChapter,
    generateChapterPlanMutation,
    replanChapterMutation,
    runChapterReview,
    reviewActionKind,
    fullAuditMutation,
    repairSSE,
    reviewResult,
    chapterPlan,
    latestStateSnapshot,
    chapterStateSnapshot,
    chapterTimeline,
    chapterTimelineQuery,
    chapterResourceContext,
    chapterResourceContextQuery,
    activeDirectorSession,
    chapterPendingCharacterResourceProposals,
    extractChapterResourcesMutation,
    confirmCharacterResourceProposalMutation,
    rejectCharacterResourceProposalMutation,
    chapterAuditReports,
    pipelineBackgroundActivities,
    chapterQualityReport,
    chapterSSE,
    activeRepairStream,
    handleAbortRepair,
    activeChapterStream,
    handleAbortChapterStream,
    pipelineForm,
    setPipelineForm,
    maxOrder,
    bibleSSE,
    llm,
    beatsSSE,
    runPipelineMutation,
    pipelineMessage,
    pipelineJobQuery,
    reviewMutation,
    setRepairBeforeContent,
    setRepairAfterContent,
    setActiveRepairStream,
    openAuditIssueIds,
    hookMutation,
    repairBeforeContent,
    repairAfterContent,
    qualitySummary,
    qualityReportQuery,
    bible,
    plotBeats,
    characterMessage,
    quickCharacterForm,
    setQuickCharacterForm,
    quickCreateCharacterMutation,
    generateSupplementalCharacterMutation,
    applySupplementalCharacterMutation,
    coreCharacterCount,
    baseCharacters,
    selectedBaseCharacterId,
    setSelectedBaseCharacterId,
    selectedBaseCharacter,
    importedBaseCharacterIds,
    importBaseCharacterMutation,
    selectedCharacterId,
    setSelectedCharacterId,
    deleteCharacterMutation,
    syncTimelineMutation,
    syncAllTimelineMutation,
    evolveCharacterMutation,
    generateVisibleProfileMutation,
    applyVisibleProfileMutation,
    generateBatchVisibleProfilesMutation,
    applyBatchVisibleProfilesMutation,
    worldCheckMutation,
    selectedCharacter,
    characterResources,
    pendingCharacterResourceProposals,
    backfillCharacterResourcesMutation,
    characterForm,
    setCharacterForm,
    saveCharacterMutation,
    characterTimelineQuery,
  });

  const activeStepTakeoverEntry = renderNovelEditTakeoverEntry({
    novelId: id,
    basicForm,
    directorTaskId,
    activeAutoDirectorTask,
    bookAutomationProjection,
    step: resolveActiveTakeoverStep(activeTab),
  });
  const {
    isExportingCurrentMarkdown,
    isExportingCurrentJson,
    isExportingFullMarkdown,
    isExportingFullJson,
    isExportingFullTxt,
  } = resolveNovelExportFlags({
    isPending: exportNovelMutation.isPending,
    variables: exportNovelMutation.variables,
    currentScope: currentExportScope,
  });

  if (displayAutoDirectorTask?.checkpointType === "production_experience_required") {
    return (
      <NovelProductionExperienceHandoff
        taskId={displayAutoDirectorTask.id}
        novelId={id}
        novelTitle={basicForm.title}
      />
    );
  }

  return (
    <NovelEditView
      id={id}
      activeTab={activeTab}
      workflowCurrentTab={workflowCurrentTab}
      onActiveTabChange={setActiveTab}
      exportControls={{
        canExportCurrentStep: Boolean(currentExportScope),
        isExportingCurrentMarkdown,
        isExportingCurrentJson,
        isExportingFullMarkdown,
        isExportingFullJson,
        isExportingFullTxt,
        onExportCurrent: (format) => {
          if (!currentExportScope) {
            return;
          }
          exportNovelMutation.mutate({
            format,
            scope: currentExportScope,
            novelTitle: exportNovelTitle,
          });
        },
        onExportFull: (format) => {
          exportNovelMutation.mutate({
            format,
            scope: "full",
            novelTitle: exportNovelTitle,
          });
        },
      }}
      basicTab={basicTab}
      worldTab={basicTab}
      storyMacroTab={storyMacroTab}
      outlineTab={outlineTab}
      structuredTab={structuredTab}
      chapterTab={chapterTab}
      pipelineTab={pipelineTab}
      characterTab={characterTab}
      takeover={isTakeoverDismissed ? null : takeover}
      activeStepTakeoverEntry={activeStepTakeoverEntry}
      onSwitchToSimpleMode={() => switchToSimpleMutation.mutate()}
      isSwitchingToSimpleMode={switchToSimpleMutation.isPending}
      taskDrawer={{
        open: isTaskDrawerOpen,
        onOpenChange: (open) => {
          setIsTaskDrawerOpen(open);
          if (!open && taskPanelOpen) {
            clearTaskPanelOpen();
          }
        },
        task: displayAutoDirectorTask,
        snapshot: activeDirectorSnapshot,
        runtimeSnapshot: activeDirectorRuntimeSnapshot,
        projection: displayAutoDirectorTask?.status === "cancelled" ? null : bookAutomationProjection,
        currentUiModel: {
          provider: llm.provider,
          model: llm.model,
          temperature: llm.temperature,
        },
        actions: taskDrawerActions,
        onProjectionAction: handleTaskDrawerProjectionAction,
        followUp: activeAutoDirectorFollowUp,
        onFollowUpAction: handleDrawerFollowUpAction,
        executingFollowUpAction: executeFollowUpActionMutation.isPending,
        runtimeHardBlocked: activeDirectorRuntimeHardBlocked,
        runtimeBlockedReason: activeDirectorRuntimeBlockedReason,
        overrideModel: retryOverride,
        onOverrideModelChange: setRetryOverride,
        onRetryWithOverrideModel: () => retryAutoDirectorWithCurrentModelMutation.mutate(),
        retryWithOverrideModelPending: retryAutoDirectorWithCurrentModelMutation.isPending,
        canRetryWithOverrideModel: Boolean(retryOverride.provider && retryOverride.model.trim()),
        onRetryWithTaskModel: () => retryAutoDirectorWithTaskModelMutation.mutate(),
        retryWithTaskModelPending: retryAutoDirectorWithTaskModelMutation.isPending,
        capabilities: {
          availableActions: taskDrawerActions.length > 0,
          availableFollowUps: Boolean(activeAutoDirectorFollowUp),
          canAdjustRuntimePolicy: Boolean(activeDirectorRuntimeSnapshot && displayAutoDirectorTask),
          canInspectManualEditImpact: Boolean(displayAutoDirectorTask),
          canRetryWithOverrideModel: Boolean(displayAutoDirectorTask && (displayAutoDirectorTask.status === "failed" || displayAutoDirectorTask.status === "cancelled")),
          canCancel: Boolean(displayAutoDirectorTask && canCancelDirectorTask(displayAutoDirectorTask)),
          canArchive: Boolean(displayAutoDirectorTask && (displayAutoDirectorTask.status === "succeeded" || displayAutoDirectorTask.status === "failed" || displayAutoDirectorTask.status === "cancelled")),
        },
        resourceProposals: pendingCharacterResourceProposals,
        onOpenResourceProposalSource: (proposal) => {
          if (proposal.chapterId) {
            setSelectedChapterId(proposal.chapterId);
            setActiveTab("chapter");
          } else {
            setActiveTab("character");
          }
          setIsTaskDrawerOpen(false);
        },
        onConfirmResourceProposal: (proposalId) => confirmCharacterResourceProposalMutation.mutate(proposalId),
        onRejectResourceProposal: (proposalId) => rejectCharacterResourceProposalMutation.mutate(proposalId),
        confirmingResourceProposalId: confirmCharacterResourceProposalMutation.isPending
          ? confirmCharacterResourceProposalMutation.variables ?? ""
          : "",
        rejectingResourceProposalId: rejectCharacterResourceProposalMutation.isPending
          ? rejectCharacterResourceProposalMutation.variables ?? ""
          : "",
        onOpenFullTaskCenter: openAutoDirectorTaskCenter,
      }}
    />
  );
}
