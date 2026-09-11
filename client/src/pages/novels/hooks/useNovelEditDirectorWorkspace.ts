import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";
import {
  extractDirectorTaskSeedPayloadFromMeta,
  type DirectorContinuationMode,
  type DirectorSessionState,
  type DirectorStepCalibrationAction,
} from "@write-now/shared/types/novelDirector";
import type { AutoDirectorAction, AutoDirectorMutationActionCode } from "@write-now/shared/types/autoDirectorFollowUp";
import type { DirectorBookAutomationAction, DirectorTaskSnapshot } from "@write-now/shared/types/directorRuntime";
import { acceptManualChangesAndContinueDirector, calibrateDirectorStep, getDirectorTaskSnapshot } from "@/api/novelDirector";
import { continueNovelWorkflow } from "@/api/novelWorkflow";
import { archiveTask, cancelTask, getTaskDetail, retryTask } from "@/api/tasks";
import { executeAutoDirectorFollowUpAction, getAutoDirectorFollowUpDetail } from "@/api/autoDirectorFollowUps";
import { queryKeys } from "@/api/queryKeys";
import { toast } from "@/components/ui/toast";
import { useDirectorChapterTitleRepair } from "@/hooks/useDirectorChapterTitleRepair";
import { useDirectorRealtimeStore } from "@/store/directorRealtimeStore";
import { useStructuredOutlineWorkspaceStore } from "../stores/useStructuredOutlineWorkspaceStore";
import { syncNovelWorkflowStageSilently, workflowStageFromTab } from "../novelWorkflow.client";
import {
  isNovelWorkspaceFlowTab,
  tabFromDirectorDisplayStage,
  tabFromDirectorProgress,
  tabFromScope,
  type NovelWorkspaceFlowTab,
} from "../novelWorkspaceNavigation";
import { resolveChapterTitleWarning } from "@/lib/directorTaskNotice";
import { resolveInternalNavigationTarget } from "@/lib/internalNavigation";
import { resolveDirectorContinueMode, resolveWorkflowContinuationFeedback } from "@/lib/novelWorkflowContinuation";
import {
  getDirectorCockpitActionHref,
  getDirectorCockpitContinuationMode,
  isDirectorCockpitContinuationAction,
} from "@/lib/directorCockpitActions";
import { canCancelDirectorTask, getCandidateSelectionLink } from "@/lib/novelWorkflowTaskUi";
import { syncAutoDirectorTaskCache } from "@/lib/taskQueryCache";
import {
  buildContinueAutoExecutionActionLabel,
  buildReplanAndContinueActionLabel,
  buildTakeoverDescription,
  buildTakeoverTitle,
  formatTakeoverCheckpoint,
  resolveAutoExecutionScopeLabel,
} from "../novelEditTakeover.shared";
import {
  buildDisplayAutoDirectorTask,
  canArchiveCompletedAutoDirectorTask,
  resolveTakeoverDialogContextTaskId,
  resolveAutomationActionText,
  resolveTakeoverModeFromAutomation,
  shouldPreserveRequestedDirectorTaskId,
  shouldAutofocusProjectedDirectorTask,
} from "../novelEditAutomationStatus";
import {
  mapDashboardModeToTakeoverMode,
  resolveActiveStructuredOutlineChapterId,
  resolveDirectorConsistencyIssue,
  takeoverDismissStorageKey,
} from "../novelEditPageHelpers";
import type { NovelEditTakeoverState, NovelTaskDrawerState } from "../components/NovelEditView.types";
import {
  useDirectorWorkspaceMutations,
  computeNovelEditTakeover,
  computeTaskDrawerActions,
} from "./director";
import type { LLMSelectorValue } from "@/components/common/LLMSelector";
import type { UnifiedTaskDetail } from "@write-now/shared/types/task";
import type { DirectorBookAutomationProjection } from "@write-now/shared/types/directorRuntime";
import type { AutoDirectorFollowUpDetail } from "@write-now/shared/types/autoDirectorFollowUp";
import type { AuditReport, Chapter, Character, PayoffLedgerResponse, StoryStateSnapshot } from "@write-now/shared/types/novel";
import type { CharacterResourceLedgerItem, CharacterResourceProposalSummary } from "@write-now/shared/types/characterResource";

export interface NovelEditDirectorWorkspaceInput {
  id: string;
  activeTab: string;
  directorTaskId: string;
  taskPanelOpen: boolean;
  hasUnsavedVolumeDraft: boolean;
  chapters: Chapter[];
  characters: Character[];
  chapterAuditReports: AuditReport[];
  pendingCharacterResourceProposals: CharacterResourceProposalSummary[];
  selectedChapterId: string;
  selectedVolumeId: string;
  selectedChapterOrder?: number;
  payoffLedgerChapterOrder?: number;
  llm: { provider: string; model: string; temperature: number };
  navigate: NavigateFunction;
  queryClient: QueryClient;
  novelTitle: string | undefined;
  setActiveTab: (tab: string) => void;
  setDirectorTaskId: (taskId: string) => void;
  setSelectedChapterId: (chapterId: string) => void;
  setSelectedVolumeId: (volumeId: string) => void;
  setIsTaskDrawerOpen: (open: boolean) => void;
  activeAutoDirectorTaskQuery: {
    isFetchedAfterMount: boolean;
    isSuccess: boolean;
    data?: { data?: UnifiedTaskDetail | null } | null;
  };
  bookAutomationQuery: {
    data?: { data?: { projection?: DirectorBookAutomationProjection | null } | null } | null;
  };
}

export function useNovelEditDirectorWorkspace(input: NovelEditDirectorWorkspaceInput) {
  const {
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
    selectedChapterOrder,
    payoffLedgerChapterOrder,
    llm,
    navigate,
    queryClient,
    setActiveTab,
    setDirectorTaskId,
    setSelectedChapterId,
    setSelectedVolumeId,
    setIsTaskDrawerOpen,
    activeAutoDirectorTaskQuery,
    bookAutomationQuery,
  } = input;
  const novelDetailQuery = { data: { data: { title: input.novelTitle } } };
  const [retryOverride, setRetryOverride] = useState<LLMSelectorValue>({
    provider: llm.provider,
    model: llm.model,
    temperature: llm.temperature,
  });
  const [isDirectorExitActionExpanded, setIsDirectorExitActionExpanded] = useState(false);
  const [dismissedTakeoverSignature, setDismissedTakeoverSignature] = useState("");
  const [autoOpenedFailedTaskId, setAutoOpenedFailedTaskId] = useState("");
  const hasValidatedActiveAutoDirectorTask = activeAutoDirectorTaskQuery.isFetchedAfterMount;
  const latestAutoDirectorTask = hasValidatedActiveAutoDirectorTask
    ? activeAutoDirectorTaskQuery.data?.data ?? null
    : null;
  const activeDirectorTask = latestAutoDirectorTask?.status === "cancelled"
    ? null
    : latestAutoDirectorTask;
  const activeAutoDirectorTask = activeDirectorTask;
  const bookAutomationProjection = bookAutomationQuery.data?.data?.projection ?? null;
  const requestedDirectorTaskId = directorTaskId
    || activeAutoDirectorTask?.id
    || (shouldAutofocusProjectedDirectorTask(bookAutomationProjection) ? bookAutomationProjection?.latestTask?.id : "")
    || "";
  const requestedDirectorTaskQuery = useQuery({
    queryKey: queryKeys.tasks.detail("novel_workflow", requestedDirectorTaskId || "none"),
    queryFn: () => getTaskDetail("novel_workflow", requestedDirectorTaskId),
    enabled: Boolean(requestedDirectorTaskId),
    retry: false,
  });
  const requestedDirectorTask = requestedDirectorTaskQuery.data?.data ?? null;
  const visibleDirectorTask = useMemo(
    () => {
      const sourceTask = requestedDirectorTask ?? activeAutoDirectorTask;
      if (!directorTaskId && !taskPanelOpen && sourceTask?.status === "cancelled") {
        return null;
      }
      return buildDisplayAutoDirectorTask(sourceTask, bookAutomationProjection);
    },
    [activeAutoDirectorTask, bookAutomationProjection, directorTaskId, requestedDirectorTask, taskPanelOpen],
  );
  const displayAutoDirectorTask = visibleDirectorTask;
  const actionTargetDirectorTaskId = visibleDirectorTask?.id ?? "";
  const selectedDirectorTaskId = visibleDirectorTask?.id ?? requestedDirectorTaskId;
  useEffect(() => {
    if (!id || !activeAutoDirectorTaskQuery.isSuccess) {
      return;
    }
    const canonicalDirectorTaskId = activeAutoDirectorTask?.id ?? "";
    if (!canonicalDirectorTaskId && taskPanelOpen && directorTaskId) {
      return;
    }
    if (!canonicalDirectorTaskId && directorTaskId && !requestedDirectorTaskQuery.isFetched) {
      return;
    }
    if (!canonicalDirectorTaskId && shouldPreserveRequestedDirectorTaskId({
      directorTaskId,
      requestedTask: requestedDirectorTask,
    })) {
      return;
    }
    if (directorTaskId === canonicalDirectorTaskId) {
      return;
    }
    setDirectorTaskId(canonicalDirectorTaskId);
  }, [
    activeAutoDirectorTask?.id,
    activeAutoDirectorTaskQuery.isSuccess,
    directorTaskId,
    id,
    requestedDirectorTask,
    requestedDirectorTaskQuery.isFetched,
    setDirectorTaskId,
    taskPanelOpen,
  ]);
  useEffect(() => {
    if (!id || !activeAutoDirectorTaskQuery.isSuccess) {
      return;
    }
    useDirectorRealtimeStore.getState().setFromAutoDirectorTask(id, activeAutoDirectorTask);
  }, [id, activeAutoDirectorTask, activeAutoDirectorTaskQuery.isSuccess]);
  const activeDirectorSession = useMemo(() => {
    if (
      !activeAutoDirectorTask
      || (
        activeAutoDirectorTask.status !== "queued"
        && activeAutoDirectorTask.status !== "running"
        && activeAutoDirectorTask.status !== "waiting_approval"
      )
    ) {
      return null;
    }
    const raw = activeAutoDirectorTask?.meta.directorSession;
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return raw as DirectorSessionState;
  }, [activeAutoDirectorTask]);
  const chapterPendingCharacterResourceProposals = useMemo(
    () => pendingCharacterResourceProposals.filter((proposal) => !selectedChapterId || proposal.chapterId === selectedChapterId),
    [pendingCharacterResourceProposals, selectedChapterId],
  );
  const visibleAutoExecutionScopeLabel = resolveAutoExecutionScopeLabel(visibleDirectorTask);
  const activeAutoExecutionScopeLabel = visibleAutoExecutionScopeLabel;
  const activeChapterTitleWarning = useMemo(
    () => resolveChapterTitleWarning(displayAutoDirectorTask),
    [displayAutoDirectorTask],
  );
  const directorTaskSnapshotQuery = useQuery({
    queryKey: queryKeys.tasks.directorTaskSnapshot(selectedDirectorTaskId || "none"),
    queryFn: () => getDirectorTaskSnapshot(selectedDirectorTaskId),
    enabled: Boolean(selectedDirectorTaskId),
    retry: false,
    refetchInterval: () => (
      displayAutoDirectorTask && (
        displayAutoDirectorTask.status === "queued"
        || displayAutoDirectorTask.status === "running"
        || displayAutoDirectorTask.status === "waiting_approval"
      )
        ? 4000
        : false
    ),
  });
  const activeDirectorSnapshot = directorTaskSnapshotQuery.data?.data?.snapshot ?? null;
  const activeStructuredOutlineChapterId = useMemo(
    () => resolveActiveStructuredOutlineChapterId(activeDirectorSnapshot),
    [activeDirectorSnapshot],
  );
  const activeDirectorRuntimeSnapshot = activeDirectorSnapshot?.runtime ?? null;
  const activeDirectorRuntimeProjection = activeDirectorSnapshot?.projection ?? null;
  const activeDirectorDashboardView = activeDirectorSnapshot?.dashboardView ?? null;
  const activeDirectorRuntimeHardBlocked = activeDirectorDashboardView?.mode === "failed"
    || activeDirectorDashboardView?.mode === "recovering"
    || (
      activeDirectorDashboardView?.mode !== "running"
      && activeDirectorRuntimeProjection?.status === "blocked"
    );
  const activeDirectorRuntimeBlockedReason = activeDirectorDashboardView?.userActionReason?.trim()
    || activeDirectorRuntimeProjection?.blockedReason?.trim()
    || activeDirectorRuntimeProjection?.detail?.trim()
    || null;
  const activeAutoDirectorFollowUpQuery = useQuery({
    queryKey: queryKeys.autoDirectorFollowUps.detail(selectedDirectorTaskId || "none"),
    queryFn: () => getAutoDirectorFollowUpDetail(selectedDirectorTaskId),
    enabled: Boolean(selectedDirectorTaskId),
    retry: false,
    refetchInterval: () => (
      displayAutoDirectorTask && (
        displayAutoDirectorTask.status === "queued"
        || displayAutoDirectorTask.status === "running"
        || displayAutoDirectorTask.status === "waiting_approval"
      )
        ? 4000
        : false
    ),
  });
  const activeAutoDirectorFollowUp = activeAutoDirectorFollowUpQuery.data?.data ?? null;
  const workflowCurrentTab = useMemo(
    () => {
      const displayStageTab = tabFromDirectorDisplayStage(activeDirectorSnapshot?.displayState.stageKey ?? null);
      if (displayStageTab) {
        return displayStageTab;
      }
      return tabFromDirectorProgress({
        currentStage: activeAutoDirectorTask?.currentStage,
        currentItemKey: activeAutoDirectorTask?.currentItemKey,
        checkpointType: activeAutoDirectorTask?.checkpointType,
        reviewScope: activeDirectorSession?.reviewScope ?? null,
        status: activeAutoDirectorTask?.status,
      });
    },
    [
      activeDirectorSnapshot?.displayState.stageKey,
      activeAutoDirectorTask?.checkpointType,
      activeAutoDirectorTask?.currentItemKey,
      activeAutoDirectorTask?.currentStage,
      activeDirectorSession?.reviewScope,
      activeAutoDirectorTask?.status,
    ],
  );
  const autoDirectorRefreshSignatureRef = useRef("");
  const autoDirectorArtifactSignatureRef = useRef("");
  const autoDirectorWorkspaceSignatureRef = useRef("");
  const activeAutoDirectorRefreshSignature = useMemo(() => {
    if (!activeAutoDirectorTask) {
      return "";
    }
    return [
      activeAutoDirectorTask.id,
      activeAutoDirectorTask.status,
      activeAutoDirectorTask.pendingManualRecovery ? "manual_recovery" : "",
      activeAutoDirectorTask.currentStage ?? "",
      activeAutoDirectorTask.currentItemKey ?? "",
      activeAutoDirectorTask.checkpointType ?? "",
    ].join("|");
  }, [
    activeAutoDirectorTask,
    activeAutoDirectorTask?.checkpointType,
    activeAutoDirectorTask?.currentItemKey,
    activeAutoDirectorTask?.currentStage,
    activeAutoDirectorTask?.id,
    activeAutoDirectorTask?.pendingManualRecovery,
    activeAutoDirectorTask?.status,
  ]);
  const activeAutoDirectorArtifactSignature = useMemo(() => {
    if (!activeAutoDirectorTask) {
      return "";
    }
    const milestoneCount = Array.isArray(activeAutoDirectorTask.meta?.milestones)
      ? activeAutoDirectorTask.meta.milestones.length
      : 0;
    return [
      activeAutoDirectorTask.status,
      activeAutoDirectorTask.checkpointType ?? "",
      activeAutoDirectorTask.meta?.directorSession && typeof activeAutoDirectorTask.meta.directorSession === "object"
        ? JSON.stringify((activeAutoDirectorTask.meta.directorSession as { phase?: unknown }).phase ?? "")
        : "",
      milestoneCount,
    ].join("|");
  }, [
    activeAutoDirectorTask,
    activeAutoDirectorTask?.checkpointType,
    activeAutoDirectorTask?.meta,
    activeAutoDirectorTask?.status,
  ]);
  const activeAutoDirectorWorkspaceSignature = useMemo(() => {
    if (!activeAutoDirectorTask || !activeDirectorSnapshot) {
      return "";
    }
    const latestEvent = activeDirectorSnapshot.recentEvents.at(-1);
    const progressBreakdown = activeDirectorSnapshot.projection?.progressBreakdown;
    return [
      activeAutoDirectorTask.id,
      activeAutoDirectorTask.status,
      activeDirectorSnapshot.displayState.stageKey,
      activeDirectorSnapshot.currentFactStepId ?? "",
      activeDirectorSnapshot.displayState.progressPercent,
      progressBreakdown?.planningPercent ?? "",
      progressBreakdown?.chapterExecutionPercent ?? "",
      progressBreakdown?.qualityRepairPercent ?? "",
      progressBreakdown?.activeJobProgress ?? "",
      latestEvent?.eventId ?? "",
      activeDirectorSnapshot.artifacts.length,
      activeDirectorSnapshot.task.currentItemKey ?? "",
      activeDirectorSnapshot.task.checkpointType ?? "",
    ].join("|");
  }, [activeAutoDirectorTask, activeDirectorSnapshot]);
  const dismissTakeover = () => {
    if (!activeAutoDirectorRefreshSignature) {
      return;
    }
    setIsDirectorExitActionExpanded(false);
    setDismissedTakeoverSignature(activeAutoDirectorRefreshSignature);
    window.sessionStorage.setItem(
      takeoverDismissStorageKey(id),
      activeAutoDirectorRefreshSignature,
    );
    toast.success("已收起这条导演接管提醒。需要时仍可从执行详情继续处理。");
  };
  const isTakeoverDismissed = Boolean(
    activeAutoDirectorRefreshSignature
    && dismissedTakeoverSignature
    && dismissedTakeoverSignature === activeAutoDirectorRefreshSignature,
  );
  const openAuditIssueIds = useMemo(
    () => chapterAuditReports.flatMap((report) => report.issues.filter((issue) => issue.status === "open").map((issue) => issue.id)),
    [chapterAuditReports],
  );
  const openAutoDirectorTaskCenter = (directorTaskId?: string) => {
    const targetId = directorTaskId || actionTargetDirectorTaskId || activeAutoDirectorTask?.id;
    if (targetId) {
      navigate(`/tasks?kind=novel_workflow&id=${targetId}`);
      return;
    }
    navigate("/tasks");
  };
  const invalidateAutoDirectorTaskState = async (taskId?: string) => {
    const invalidations: Array<Promise<unknown>> = [
      queryClient.invalidateQueries({ queryKey: queryKeys.novels.autoDirectorTask(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.novels.directorBookAutomation(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.overview }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.recoveryCandidates }),
    ];
    if (taskId) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail("novel_workflow", taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.directorTaskSnapshot(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.directorRuntime(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.autoDirectorFollowUps.detail(taskId) }),
      );
    }
    await Promise.allSettled(invalidations);
  };
  const invalidateWorkspaceDataForTabs = async (tabs: Array<NovelWorkspaceFlowTab | null | undefined>) => {
    const invalidations: Array<Promise<unknown>> = [];
    const targetTabs = new Set(tabs.filter((tab): tab is NovelWorkspaceFlowTab => Boolean(tab)));
    if (targetTabs.has("basic")) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.detail(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.worldSlice(id) }),
      );
    }
    if (targetTabs.has("story_macro")) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.storyMacro(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.storyMacroState(id) }),
      );
    }
    if (targetTabs.has("character")) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.detail(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterCastOptions(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterDynamicsOverview(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterRelations(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterCandidates(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterResources(id) }),
      );
    }
    if (targetTabs.has("outline") || targetTabs.has("structured")) {
      invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.novels.volumeWorkspace(id) }));
    }
    if (targetTabs.has("structured")) {
      invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.novels.payoffLedger(id, payoffLedgerChapterOrder) }));
    }
    if (targetTabs.has("chapter")) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.detail(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.latestStateSnapshot(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.payoffLedger(id, payoffLedgerChapterOrder) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterResources(id) }),
      );
      if (selectedChapterId) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterResourceContext(id, selectedChapterId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.novels.chapterTimeline(id, selectedChapterId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.novels.chapterPlan(id, selectedChapterId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.novels.chapterAuditReports(id, selectedChapterId) }),
        );
      }
    }
    if (targetTabs.has("pipeline")) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.qualityReport(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.latestStateSnapshot(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.payoffLedger(id, payoffLedgerChapterOrder) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.novels.characterResources(id) }),
      );
    }
    await Promise.allSettled(invalidations);
  };
  const invalidateVisibleWorkspaceData = async () => {
    await invalidateWorkspaceDataForTabs([isNovelWorkspaceFlowTab(activeTab) ? activeTab : null]);
  };
  const alignToAutoDirectorResumeTarget = (task = visibleDirectorTask) => {
    const target = task?.resumeTarget;
    if (!target?.stage) {
      return;
    }
    setActiveTab(target.stage);
    if (target.chapterId) {
      setSelectedChapterId(target.chapterId);
    }
    if (target.volumeId) {
      setSelectedVolumeId(target.volumeId);
    }
  };
  const {
    continueAutoDirectorMutation,
    calibrateDirectorStepMutation,
    acceptManualChangesAndContinueMutation,
    continueAutoExecutionMutation,
    continueProjectedDirectorActionMutation,
    executeFollowUpActionMutation,
    retryAutoDirectorWithCurrentModelMutation,
    retryAutoDirectorWithTaskModelMutation,
    cancelAutoDirectorMutation,
    archiveCompletedAutoDirectorMutation,
  } = useDirectorWorkspaceMutations({
    id,
    actionTargetDirectorTaskId,
    visibleDirectorTask,
    activeAutoDirectorTask,
    displayAutoDirectorTask,
    activeAutoExecutionScopeLabel,
    llm,
    setDirectorTaskId,
    invalidateAutoDirectorTaskState,
    alignToAutoDirectorResumeTarget,
    setIsTaskDrawerOpen,
    setIsDirectorExitActionExpanded,
  });
  const consistencyIssue = useMemo(
    () => resolveDirectorConsistencyIssue({
      checkpointType: activeAutoDirectorTask?.checkpointType,
      characterCount: characters.length,
      chapterCount: chapters.length,
    }),
    [activeAutoDirectorTask?.checkpointType, chapters.length, characters.length],
  );
  const reviewScope = activeDirectorSession?.reviewScope ?? null;
  const reviewTab = useMemo(() => tabFromScope(reviewScope), [reviewScope]);
  const openReviewStage = () => {
    if (!reviewTab) {
      return;
    }
    setActiveTab(reviewTab);
    setIsTaskDrawerOpen(false);
  };
  const openCandidateSelection = (directorTaskId = actionTargetDirectorTaskId || activeAutoDirectorTask?.id || "") => {
    if (!directorTaskId) {
      return;
    }
    navigate(getCandidateSelectionLink(directorTaskId));
  };
  const openChapterExecution = (task = visibleDirectorTask) => {
    if (task?.resumeTarget?.chapterId) {
      setSelectedChapterId(task.resumeTarget.chapterId);
    }
    setActiveTab("chapter");
    setIsTaskDrawerOpen(false);
  };
  const openQualityRepair = (task = visibleDirectorTask) => {
    if (task?.resumeTarget?.chapterId) {
      setSelectedChapterId(task.resumeTarget.chapterId);
    }
    setActiveTab("pipeline");
    setIsTaskDrawerOpen(false);
  };
  const openChapterTitleRepair = (showToast = false) => {
    const targetVolumeId = activeChapterTitleWarning?.volumeId ?? activeAutoDirectorTask?.resumeTarget?.volumeId ?? "";
    setActiveTab("structured");
    setSelectedVolumeId(targetVolumeId);
    setSelectedChapterId("");
    useStructuredOutlineWorkspaceStore.getState().patchWorkspace(id, {
      selectedVolumeId: targetVolumeId || undefined,
      selectedChapterId: "",
      selectedBeatKey: "all",
    });
    setIsTaskDrawerOpen(false);
    if (!showToast) {
      return;
    }
    toast.success(targetVolumeId ? "已定位到当前卷拆章，可直接修复标题。" : "已切到节奏 / 拆章，可直接修复标题。");
  };
  const handleTaskDrawerProjectionAction = (action: DirectorBookAutomationAction) => {
    if (!bookAutomationProjection) {
      return;
    }
    const taskId = action.commandPayload?.taskId
      ?? action.target.taskId
      ?? bookAutomationProjection.latestTask?.id
      ?? activeAutoDirectorTask?.id;
    if (taskId && isDirectorCockpitContinuationAction(action)) {
      continueProjectedDirectorActionMutation.mutate({
        taskId,
        mode: getDirectorCockpitContinuationMode(action),
      });
      return;
    }
    if (action.type === "confirm_candidate") {
      openCandidateSelection(taskId);
      return;
    }
    if (action.type === "open_chapter") {
      openChapterExecution(taskId === visibleDirectorTask?.id ? visibleDirectorTask : undefined);
      return;
    }
    if (action.type === "open_quality_repair") {
      openQualityRepair(taskId === visibleDirectorTask?.id ? visibleDirectorTask : undefined);
      return;
    }
    if (action.type === "open_details") {
      openAutoDirectorTaskCenter(taskId);
      return;
    }
    setIsTaskDrawerOpen(false);
    navigate(getDirectorCockpitActionHref(bookAutomationProjection, action));
  };
  const handleDrawerFollowUpAction = (action: AutoDirectorAction) => {
    if (action.kind === "navigation") {
      const targetUrl = action.targetUrl?.trim() || visibleDirectorTask?.sourceRoute || activeAutoDirectorTask?.sourceRoute || "";
      const internalTarget = resolveInternalNavigationTarget(targetUrl);
      if (internalTarget) {
        setIsTaskDrawerOpen(false);
        navigate(internalTarget);
        return;
      }
      if (/^https?:\/\//i.test(targetUrl)) {
        window.location.assign(targetUrl);
      }
      return;
    }
    executeFollowUpActionMutation.mutate(
      {
        directorTaskId: activeAutoDirectorFollowUp?.directorTaskId ?? actionTargetDirectorTaskId,
        actionCode: (action.executorActionCode ?? action.code) as AutoDirectorMutationActionCode,
      },
    );
  };
  const chapterTitleRepairMutation = useDirectorChapterTitleRepair({
    navigateOnSuccess: false,
    onAfterStart: () => {
      openChapterTitleRepair(false);
    },
  });
  useEffect(() => {
    setRetryOverride({
      provider: llm.provider,
      model: llm.model,
      temperature: llm.temperature,
    });
  }, [activeAutoDirectorTask?.id, llm.model, llm.provider, llm.temperature]);
  useEffect(() => {
    if (activeAutoDirectorTask?.status !== "failed") {
      if (autoOpenedFailedTaskId) {
        setAutoOpenedFailedTaskId("");
      }
      return;
    }
    if (!activeAutoDirectorTask.id || activeAutoDirectorTask.id === autoOpenedFailedTaskId) {
      return;
    }
    setIsTaskDrawerOpen(true);
    setAutoOpenedFailedTaskId(activeAutoDirectorTask.id);
  }, [activeAutoDirectorTask?.id, activeAutoDirectorTask?.status, autoOpenedFailedTaskId]);
  useEffect(() => {
    if (!taskPanelOpen || !displayAutoDirectorTask?.id) {
      return;
    }
    setIsTaskDrawerOpen(true);
  }, [displayAutoDirectorTask?.id, taskPanelOpen]);
  useEffect(() => {
    if (!activeAutoDirectorTask) {
      setIsDirectorExitActionExpanded(false);
      setDismissedTakeoverSignature("");
      window.sessionStorage.removeItem(takeoverDismissStorageKey(id));
      return;
    }
    if (
      activeAutoDirectorTask.status !== "queued"
      && activeAutoDirectorTask.status !== "running"
      && activeAutoDirectorTask.status !== "waiting_approval"
    ) {
      setIsDirectorExitActionExpanded(false);
    }
  }, [activeAutoDirectorTask, id]);
  useEffect(() => {
    if (!id || !activeAutoDirectorRefreshSignature) {
      return;
    }
    const storedDismissedSignature = window.sessionStorage.getItem(takeoverDismissStorageKey(id)) ?? "";
    setDismissedTakeoverSignature(storedDismissedSignature);
  }, [activeAutoDirectorRefreshSignature, id]);
  const takeover = useMemo<NovelEditTakeoverState | null>(
    () => computeNovelEditTakeover({
      displayAutoDirectorTask,
      activeAutoDirectorTask,
      charactersCount: characters.length,
      chaptersCount: chapters.length,
      activeDirectorSnapshot,
      bookAutomationProjection,
      novelTitle: novelDetailQuery.data?.data?.title?.trim() || displayAutoDirectorTask?.title?.trim() || "当前项目",
      activeDirectorSession,
      activeChapterTitleWarning,
      chapterTitleRepairMutation,
      hasUnsavedVolumeDraft,
      activeTab,
      openCandidateSelection,
      openQualityRepair,
      openChapterExecution,
      setActiveTab,
      setSelectedChapterId,
      setIsTaskDrawerOpen,
      setIsDirectorExitActionExpanded,
      isDirectorExitActionExpanded,
      dismissTakeover,
      continueAutoDirectorMutation,
      calibrateDirectorStepMutation,
      acceptManualChangesAndContinueMutation,
      continueAutoExecutionMutation,
      cancelAutoDirectorMutation,
      archiveCompletedAutoDirectorMutation,
    }),
    [
      acceptManualChangesAndContinueMutation,
      activeChapterTitleWarning,
      activeDirectorSnapshot,
      activeDirectorSession,
      activeTab,
      archiveCompletedAutoDirectorMutation,
      bookAutomationProjection,
      calibrateDirectorStepMutation,
      cancelAutoDirectorMutation,
      chapterTitleRepairMutation,
      chapters.length,
      characters.length,
      continueAutoDirectorMutation,
      continueAutoExecutionMutation,
      dismissTakeover,
      displayAutoDirectorTask,
      hasUnsavedVolumeDraft,
      isDirectorExitActionExpanded,
      novelDetailQuery.data?.data?.title,
      openCandidateSelection,
      openChapterExecution,
      openQualityRepair,
      setActiveTab,
      setSelectedChapterId,
      setIsTaskDrawerOpen,
    ],
  );
  const taskDrawerActions = useMemo<NovelTaskDrawerState["actions"]>(
    () => computeTaskDrawerActions({
      displayAutoDirectorTask,
      activeChapterTitleWarning,
      chapterTitleRepairMutation,
      hasUnsavedVolumeDraft,
      consistencyIssue,
      continueAutoDirectorMutation,
      continueAutoExecutionMutation,
      cancelAutoDirectorMutation,
      openCandidateSelection,
      openQualityRepair,
      openChapterExecution,
      openReviewStage,
      setActiveTab,
      setIsTaskDrawerOpen,
      reviewTab,
    }),
    [
      activeChapterTitleWarning,
      cancelAutoDirectorMutation,
      chapterTitleRepairMutation,
      consistencyIssue,
      continueAutoDirectorMutation,
      continueAutoExecutionMutation,
      displayAutoDirectorTask,
      hasUnsavedVolumeDraft,
      openCandidateSelection,
      openChapterExecution,
      openQualityRepair,
      openReviewStage,
      reviewTab,
      setActiveTab,
      setIsTaskDrawerOpen,
    ],
  );

  useEffect(() => {
    if (!id) {
      return;
    }
    if (
      activeAutoDirectorTask
      && (
        activeAutoDirectorTask.status === "queued"
        || activeAutoDirectorTask.status === "running"
        || activeAutoDirectorTask.status === "waiting_approval"
      )
    ) {
      return;
    }
    const labels: Record<string, string> = {
      basic: "项目设定已打开",
      story_macro: "故事宏观规划已打开",
      character: "角色准备已打开",
      outline: "卷战略 / 卷骨架已打开",
      structured: "节奏 / 拆章已打开",
      chapter: selectedChapterOrder ? `正在查看第${selectedChapterOrder}章执行面板` : "章节执行已打开",
      pipeline: "质量修复 / 流水线已打开",
    };
    void syncNovelWorkflowStageSilently({
      novelId: id,
      stage: workflowStageFromTab(activeTab),
      itemLabel: labels[activeTab] ?? "小说主流程已打开",
      chapterId: activeTab === "chapter" ? selectedChapterId || undefined : undefined,
      volumeId: activeTab === "structured" || activeTab === "outline" ? selectedVolumeId || undefined : undefined,
      status: "waiting_approval",
    });
  }, [activeAutoDirectorTask, activeTab, id, selectedChapterId, selectedChapterOrder, selectedVolumeId]);

  useEffect(() => {
    if (!id || !activeAutoDirectorTask || !activeAutoDirectorRefreshSignature) {
      autoDirectorRefreshSignatureRef.current = activeAutoDirectorRefreshSignature;
      return;
    }
    if (!autoDirectorRefreshSignatureRef.current) {
      autoDirectorRefreshSignatureRef.current = activeAutoDirectorRefreshSignature;
      return;
    }
    if (autoDirectorRefreshSignatureRef.current === activeAutoDirectorRefreshSignature) {
      return;
    }
    autoDirectorRefreshSignatureRef.current = activeAutoDirectorRefreshSignature;
    void invalidateAutoDirectorTaskState(activeAutoDirectorTask.id);
  }, [activeAutoDirectorRefreshSignature, activeAutoDirectorTask, id]);

  useEffect(() => {
    if (!id || !activeAutoDirectorTask || !activeAutoDirectorWorkspaceSignature) {
      autoDirectorWorkspaceSignatureRef.current = activeAutoDirectorWorkspaceSignature;
      return;
    }
    if (!autoDirectorWorkspaceSignatureRef.current) {
      autoDirectorWorkspaceSignatureRef.current = activeAutoDirectorWorkspaceSignature;
      return;
    }
    if (autoDirectorWorkspaceSignatureRef.current === activeAutoDirectorWorkspaceSignature) {
      return;
    }
    autoDirectorWorkspaceSignatureRef.current = activeAutoDirectorWorkspaceSignature;
    const recommendedTab = tabFromDirectorDisplayStage(activeDirectorSnapshot?.displayState.stageKey ?? null);
    void invalidateWorkspaceDataForTabs([
      isNovelWorkspaceFlowTab(activeTab) ? activeTab : null,
      recommendedTab,
      workflowCurrentTab,
    ]);
  }, [
    activeAutoDirectorTask,
    activeAutoDirectorWorkspaceSignature,
    activeDirectorSnapshot?.displayState.stageKey,
    activeTab,
    id,
    workflowCurrentTab,
  ]);

  useEffect(() => {
    if (!id || !activeAutoDirectorTask || !activeAutoDirectorArtifactSignature) {
      autoDirectorArtifactSignatureRef.current = activeAutoDirectorArtifactSignature;
      return;
    }
    if (!autoDirectorArtifactSignatureRef.current) {
      autoDirectorArtifactSignatureRef.current = activeAutoDirectorArtifactSignature;
      return;
    }
    if (autoDirectorArtifactSignatureRef.current === activeAutoDirectorArtifactSignature) {
      return;
    }
    autoDirectorArtifactSignatureRef.current = activeAutoDirectorArtifactSignature;
    void invalidateVisibleWorkspaceData();
  }, [activeAutoDirectorArtifactSignature, activeAutoDirectorTask, id, selectedChapterId]);

  return {
    activeAutoDirectorArtifactSignature,
    activeAutoDirectorFollowUp,
    activeAutoDirectorRefreshSignature,
    activeAutoDirectorTask,
    activeAutoDirectorWorkspaceSignature,
    activeDirectorRuntimeBlockedReason,
    activeDirectorRuntimeHardBlocked,
    activeDirectorRuntimeSnapshot,
    activeDirectorSession,
    activeDirectorSnapshot,
    activeStructuredOutlineChapterId,
    autoDirectorArtifactSignatureRef,
    autoDirectorRefreshSignatureRef,
    autoDirectorWorkspaceSignatureRef,
    bookAutomationProjection,
    chapterPendingCharacterResourceProposals,
    displayAutoDirectorTask,
    executeFollowUpActionMutation,
    handleDrawerFollowUpAction,
    handleTaskDrawerProjectionAction,
    invalidateAutoDirectorTaskState,
    invalidateVisibleWorkspaceData,
    invalidateWorkspaceDataForTabs,
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
  };
}
