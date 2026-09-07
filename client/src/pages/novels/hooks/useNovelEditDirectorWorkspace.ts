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
  const continueAutoDirectorMutation = useMutation({
    mutationFn: async (input?: { directorTaskId?: string }) => {
      const targetTaskId = input?.directorTaskId || actionTargetDirectorTaskId;
      const targetTask = targetTaskId === visibleDirectorTask?.id ? visibleDirectorTask : activeAutoDirectorTask;
      if (!targetTaskId) {
        throw new Error("当前没有可继续的自动导演任务。");
      }
      return continueNovelWorkflow(targetTaskId, {
        continuationMode: resolveDirectorContinueMode(targetTask),
      });
    },
    onSuccess: async (response, input) => {
      const targetTaskId = input?.directorTaskId || actionTargetDirectorTaskId;
      const targetTask = targetTaskId === visibleDirectorTask?.id ? visibleDirectorTask : activeAutoDirectorTask;
      setDirectorTaskId(response.data?.taskId ?? targetTaskId);
      void invalidateAutoDirectorTaskState(response.data?.taskId ?? targetTaskId);
      const feedback = resolveWorkflowContinuationFeedback(response.data, {
        mode: resolveDirectorContinueMode(targetTask),
      });
      if (feedback.tone === "error") {
        toast.error(feedback.message);
        return;
      }
      alignToAutoDirectorResumeTarget(targetTask);
      toast.success(feedback.message);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "继续自动导演失败。";
      toast.error(message);
    },
  });
  const calibrateDirectorStepMutation = useMutation({
    mutationFn: async (input: {
      directorTaskId: string;
      stepId: string;
      action: DirectorStepCalibrationAction;
      instruction?: string | null;
    }) => calibrateDirectorStep(input.directorTaskId, {
      stepId: input.stepId,
      action: input.action,
      instruction: input.instruction,
    }),
    onSuccess: async (_response, input) => {
      await invalidateAutoDirectorTaskState(input.directorTaskId);
      toast.success(input.action === "validate" ? "当前步骤检查已完成。" : "当前步骤已更新，请检查结果。");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "步骤校准失败。");
    },
  });
  const acceptManualChangesAndContinueMutation = useMutation({
    mutationFn: (directorTaskId: string) => acceptManualChangesAndContinueDirector(directorTaskId),
    onSuccess: async (response, directorTaskId) => {
      setDirectorTaskId(response.data?.taskId ?? directorTaskId);
      await invalidateAutoDirectorTaskState(response.data?.taskId ?? directorTaskId);
      toast.success("已确认当前修改，导演将从下一个未完成步骤继续。");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "确认修改并继续失败。");
    },
  });
  const continueAutoExecutionMutation = useMutation({
    mutationFn: async (input?: { directorTaskId?: string; continuationMode?: "auto_execute_range" | "skip_quality_repair" }) => {
      const targetTaskId = input?.directorTaskId || actionTargetDirectorTaskId;
      if (!targetTaskId) {
        throw new Error("当前没有可继续自动执行的自动导演任务。");
      }
      return continueNovelWorkflow(targetTaskId, {
        continuationMode: input?.continuationMode ?? "auto_execute_range",
      });
    },
    onSuccess: async (response, input) => {
      const targetTaskId = input?.directorTaskId || actionTargetDirectorTaskId;
      const targetTask = targetTaskId === visibleDirectorTask?.id ? visibleDirectorTask : activeAutoDirectorTask;
      setDirectorTaskId(response.data?.taskId ?? targetTaskId);
      void invalidateAutoDirectorTaskState(response.data?.taskId ?? targetTaskId);
      const feedback = resolveWorkflowContinuationFeedback(response.data, {
        mode: input?.continuationMode ?? "auto_execute_range",
        scopeLabel: activeAutoExecutionScopeLabel,
      });
      if (feedback.tone === "error") {
        toast.error(feedback.message);
        return;
      }
      alignToAutoDirectorResumeTarget(targetTask);
      toast.success(feedback.message);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : `继续自动执行${activeAutoExecutionScopeLabel}失败。`;
      toast.error(message);
    },
  });
  const continueProjectedDirectorActionMutation = useMutation({
    mutationFn: async (input: {
      taskId: string;
      mode?: DirectorContinuationMode;
    }) => continueNovelWorkflow(
      input.taskId,
      input.mode ? { continuationMode: input.mode } : undefined,
    ),
    onSuccess: async (response, input) => {
      setDirectorTaskId(response.data?.taskId ?? input.taskId);
      void invalidateAutoDirectorTaskState(response.data?.taskId ?? input.taskId);
      const feedback = resolveWorkflowContinuationFeedback(response.data, {
        mode: input.mode,
        scopeLabel: activeAutoExecutionScopeLabel,
      });
      if (feedback.tone === "error") {
        toast.error(feedback.message);
        return;
      }
      alignToAutoDirectorResumeTarget(input.taskId === visibleDirectorTask?.id ? visibleDirectorTask : activeAutoDirectorTask);
      toast.success(feedback.message);
    },
    onError: (error, input) => {
      const message = error instanceof Error
        ? error.message
        : input.mode === "auto_execute_range"
          ? `继续自动执行${activeAutoExecutionScopeLabel}失败。`
          : "继续自动导演失败。";
      toast.error(message);
    },
  });
  const executeFollowUpActionMutation = useMutation({
    mutationFn: async (input: {
      directorTaskId?: string;
      actionCode: AutoDirectorMutationActionCode;
    }) => {
      const targetTaskId = input.directorTaskId || actionTargetDirectorTaskId;
      if (!targetTaskId) {
        throw new Error("当前没有可执行的动作。");
      }
      return executeAutoDirectorFollowUpAction(targetTaskId, {
        actionCode: input.actionCode,
        idempotencyKey: `${targetTaskId}:${input.actionCode}:${Date.now()}`,
      });
    },
    onSuccess: async (response, input) => {
      const result = response.data;
      if (result?.task) {
        syncAutoDirectorTaskCache(queryClient, id, result.task);
      }
      setDirectorTaskId(result?.directorTaskId ?? result?.taskId ?? input.directorTaskId ?? actionTargetDirectorTaskId);
      await invalidateAutoDirectorTaskState(result?.directorTaskId ?? result?.taskId ?? input.directorTaskId ?? actionTargetDirectorTaskId);
      if (result?.code === "failed" || result?.code === "forbidden") {
        toast.error(result.message);
        return;
      }
      toast.success(result?.message ?? "已执行动作。");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "执行动作失败。");
    },
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
  const retryableAutoDirectorTask = useMemo(() => {
    if (displayAutoDirectorTask && (displayAutoDirectorTask.status === "failed" || displayAutoDirectorTask.status === "cancelled")) {
      return displayAutoDirectorTask;
    }
    if (activeAutoDirectorTask && (activeAutoDirectorTask.status === "failed" || activeAutoDirectorTask.status === "cancelled")) {
      return activeAutoDirectorTask;
    }
    return null;
  }, [activeAutoDirectorTask, displayAutoDirectorTask]);
  const retryAutoDirectorWithCurrentModelMutation = useMutation({
    mutationFn: async () => {
      if (!retryableAutoDirectorTask?.id) {
        throw new Error("当前没有可重试的自动导演任务。");
      }
      return retryTask("novel_workflow", retryableAutoDirectorTask.id, {
        llmOverride: {
          provider: llm.provider,
          model: llm.model,
          temperature: llm.temperature,
        },
        resume: true,
      });
    },
    onSuccess: async (response) => {
      syncAutoDirectorTaskCache(queryClient, id, response.data);
      void invalidateAutoDirectorTaskState(response.data?.id ?? retryableAutoDirectorTask?.id);
      setIsTaskDrawerOpen(true);
      toast.success(`已切换到 ${llm.provider} / ${llm.model} 并重新启动自动导演。`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "切换当前模型重试失败。";
      toast.error(message);
    },
  });
  const retryAutoDirectorWithTaskModelMutation = useMutation({
    mutationFn: async () => {
      if (!retryableAutoDirectorTask?.id) {
        throw new Error("当前没有可重试的自动导演任务。");
      }
      return retryTask("novel_workflow", retryableAutoDirectorTask.id, { resume: true });
    },
    onSuccess: async (response) => {
      syncAutoDirectorTaskCache(queryClient, id, response.data);
      void invalidateAutoDirectorTaskState(response.data?.id ?? retryableAutoDirectorTask?.id);
      setIsTaskDrawerOpen(true);
      toast.success("自动导演已按任务原模型重新启动。");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "按原模型重试失败。";
      toast.error(message);
    },
  });
  const cancelAutoDirectorMutation = useMutation({
    mutationFn: async (targetTaskId?: string) => {
      const taskId = targetTaskId || displayAutoDirectorTask?.id || activeAutoDirectorTask?.id;
      if (!taskId) {
        throw new Error("当前没有可取消的自动导演任务。");
      }
      return cancelTask("novel_workflow", taskId);
    },
    onSuccess: async (response, targetTaskId) => {
      setIsDirectorExitActionExpanded(false);
      syncAutoDirectorTaskCache(queryClient, id, response.data);
      void invalidateAutoDirectorTaskState(response.data?.id ?? targetTaskId ?? displayAutoDirectorTask?.id ?? activeAutoDirectorTask?.id);
      toast.success("已取消自动导演任务。");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "取消自动导演失败。";
      toast.error(message);
    },
  });
  const archiveCompletedAutoDirectorMutation = useMutation({
    mutationFn: async (targetTaskId?: string) => {
      const taskId = targetTaskId || displayAutoDirectorTask?.id;
      if (!taskId) {
        throw new Error("当前没有可收起的自动导演完成记录。");
      }
      return archiveTask("novel_workflow", taskId);
    },
    onSuccess: async (_response, targetTaskId) => {
      setIsDirectorExitActionExpanded(false);
      await invalidateAutoDirectorTaskState(targetTaskId ?? displayAutoDirectorTask?.id);
      toast.success("已收起这次自动导演完成提醒。");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "收起自动导演完成提醒失败。";
      toast.error(message);
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
  const takeover = useMemo<NovelEditTakeoverState | null>(() => {
    const task = displayAutoDirectorTask;
    if (!task) {
      return null;
    }
    const consistencyIssue = resolveDirectorConsistencyIssue({
      checkpointType: task.checkpointType,
      characterCount: characters.length,
      chapterCount: chapters.length,
    });
    const dashboardView = activeDirectorSnapshot?.dashboardView ?? null;
    const mode = mapDashboardModeToTakeoverMode(dashboardView?.mode)
      ?? resolveTakeoverModeFromAutomation({
      task,
      projection: bookAutomationProjection,
    });
    const automationActionText = resolveAutomationActionText({
      task,
      projection: bookAutomationProjection,
    });
    const novelTitle = novelDetailQuery.data?.data?.title?.trim() || task.title?.trim() || "当前项目";
    const reviewScope = activeDirectorSession?.reviewScope ?? null;
    const autoExecutionScopeLabel = resolveAutoExecutionScopeLabel(task);
    const actions: NonNullable<NovelEditTakeoverState["actions"]> = [];
    if (activeChapterTitleWarning) {
      actions.push({
        label: chapterTitleRepairMutation.isPending && chapterTitleRepairMutation.pendingTaskId === task.id
          ? "AI 修复中..."
          : activeChapterTitleWarning.label,
        onClick: () => {
          if (hasUnsavedVolumeDraft) {
            toast.error("当前拆章工作区还有未保存修改，请先保存工作区，再发起 AI 修复标题。");
            return;
          }
          chapterTitleRepairMutation.startRepair(task);
        },
        variant: mode === "failed" ? "default" : "outline",
        disabled: chapterTitleRepairMutation.isPending,
      });
    }
    const reviewTab = tabFromScope(reviewScope);
    if (
      mode === "waiting"
      && task.checkpointType === "candidate_selection_required"
    ) {
      actions.push({
        label: "去确认书级方向",
        onClick: () => openCandidateSelection(task.id),
        variant: "default",
      });
    } else if (
      (mode === "waiting" || mode === "action_required")
      && reviewTab
      && reviewTab !== activeTab
      && task.checkpointType !== "chapter_batch_ready"
    ) {
      actions.push({
        label: "去当前审核阶段",
        onClick: () => setActiveTab(reviewTab),
        variant: "outline",
      });
    }
    if (task.pendingManualRecovery) {
      actions.push({
        label: continueAutoDirectorMutation.isPending ? "继续中..." : "继续自动导演",
        onClick: () => continueAutoDirectorMutation.mutate({ directorTaskId: task.id }),
        variant: "default",
        disabled: continueAutoDirectorMutation.isPending,
      });
    } else if (mode === "waiting" && task.checkpointType === "step_review_required") {
      const stepReview = extractDirectorTaskSeedPayloadFromMeta(task.meta)?.stepReview;
      const stepId = stepReview?.stepId?.trim() || task.currentItemKey?.trim() || "";
      const requestCalibrationInstruction = (action: DirectorStepCalibrationAction): string | null | undefined => {
        if (action === "validate") {
          return null;
        }
        const value = window.prompt("告诉 AI 这一步需要调整什么（可留空）", "");
        return value === null ? undefined : value.trim();
      };
      if (stepId) {
        actions.push({
          label: calibrateDirectorStepMutation.isPending ? "检查中..." : "AI 检查当前步骤",
          onClick: () => calibrateDirectorStepMutation.mutate({
            directorTaskId: task.id,
            stepId,
            action: "validate",
          }),
          variant: "outline",
          disabled: calibrateDirectorStepMutation.isPending,
        });
        actions.push({
          label: calibrateDirectorStepMutation.isPending ? "完善中..." : "AI 完善当前步骤",
          onClick: () => {
            const instruction = requestCalibrationInstruction("improve");
            if (instruction !== undefined) {
              calibrateDirectorStepMutation.mutate({ directorTaskId: task.id, stepId, action: "improve", instruction });
            }
          },
          variant: "outline",
          disabled: calibrateDirectorStepMutation.isPending,
        });
        actions.push({
          label: calibrateDirectorStepMutation.isPending ? "生成中..." : "重新生成当前步骤",
          onClick: () => {
            const instruction = requestCalibrationInstruction("regenerate");
            if (instruction !== undefined) {
              calibrateDirectorStepMutation.mutate({ directorTaskId: task.id, stepId, action: "regenerate", instruction });
            }
          },
          variant: "outline",
          disabled: calibrateDirectorStepMutation.isPending,
        });
      }
      actions.push({
        label: acceptManualChangesAndContinueMutation.isPending ? "确认中..." : "保存并确认",
        onClick: () => acceptManualChangesAndContinueMutation.mutate(task.id),
        variant: "default",
        disabled: acceptManualChangesAndContinueMutation.isPending,
      });
      actions.push({
        label: acceptManualChangesAndContinueMutation.isPending ? "继续中..." : "继续自动导演",
        onClick: () => acceptManualChangesAndContinueMutation.mutate(task.id),
        variant: "outline",
        disabled: acceptManualChangesAndContinueMutation.isPending,
      });
    } else if (mode === "waiting" && task.checkpointType === "chapter_batch_ready") {
      actions.push({
        label: buildContinueAutoExecutionActionLabel(autoExecutionScopeLabel, continueAutoExecutionMutation.isPending),
        onClick: () => continueAutoExecutionMutation.mutate({ directorTaskId: task.id }),
        variant: "default",
        disabled: continueAutoExecutionMutation.isPending,
      });
      actions.push({
        label: "进入章节执行",
        onClick: () => {
          if (task.resumeTarget?.chapterId) {
            setSelectedChapterId(task.resumeTarget.chapterId);
          }
          setActiveTab("chapter");
        },
        variant: "outline",
      });
    } else if (mode === "waiting" && task.checkpointType === "workflow_completed") {
      actions.push({
        label: "进入章节执行",
        onClick: () => openChapterExecution(task),
        variant: "default",
      });
    } else if ((mode === "action_required" || mode === "failed") && task.checkpointType === "replan_required") {
      actions.push({
        label: buildReplanAndContinueActionLabel(continueAutoExecutionMutation.isPending),
        onClick: () => continueAutoExecutionMutation.mutate({
          directorTaskId: task.id,
          continuationMode: "auto_execute_range",
        }),
        variant: "default",
        disabled: continueAutoExecutionMutation.isPending,
      });
      actions.push({
        label: "打开质量修复",
        onClick: () => openQualityRepair(task),
        variant: "outline",
      });
    } else if (mode === "waiting") {
      actions.push({
        label: continueAutoDirectorMutation.isPending ? "继续中..." : "继续自动导演",
        onClick: () => continueAutoDirectorMutation.mutate({ directorTaskId: task.id }),
        variant: "default",
        disabled: continueAutoDirectorMutation.isPending,
      });
    }
    if (mode === "failed" && task.checkpointType === "chapter_batch_ready") {
      actions.push({
        label: buildContinueAutoExecutionActionLabel(autoExecutionScopeLabel, continueAutoExecutionMutation.isPending),
        onClick: () => continueAutoExecutionMutation.mutate({ directorTaskId: task.id }),
        variant: "default",
        disabled: continueAutoExecutionMutation.isPending,
      });
      actions.push({
        label: "打开质量修复",
        onClick: () => openQualityRepair(task),
        variant: "outline",
      });
    }
    if (consistencyIssue) {
      actions.push({
        label: continueAutoDirectorMutation.isPending ? "修复中..." : "补齐导演产物",
        onClick: () => continueAutoDirectorMutation.mutate({ directorTaskId: task.id }),
        variant: "default",
        disabled: continueAutoDirectorMutation.isPending,
      });
      if (consistencyIssue === "missing_characters") {
        actions.push({
          label: "去角色准备",
          onClick: () => setActiveTab("character"),
          variant: "outline",
        });
      }
    } else if (task.checkpointType === "chapter_batch_ready" && mode !== "waiting") {
      actions.push({
        label: "进入章节执行",
        onClick: () => {
          if (task.resumeTarget?.chapterId) {
            setSelectedChapterId(task.resumeTarget.chapterId);
          }
          setActiveTab("chapter");
        },
        variant: mode === "running" ? "outline" : "default",
      });
    }
    const canCancelTask = canCancelDirectorTask(task);
    if (canCancelTask) {
      if (task.status === "failed") {
        actions.push({
          label: cancelAutoDirectorMutation.isPending ? "取消中..." : "取消任务",
          onClick: () => cancelAutoDirectorMutation.mutate(task.id),
          variant: "destructive",
          disabled: cancelAutoDirectorMutation.isPending,
        });
      } else if (isDirectorExitActionExpanded) {
        actions.push({
          label: "继续导演",
          onClick: () => setIsDirectorExitActionExpanded(false),
          variant: "outline",
          disabled: cancelAutoDirectorMutation.isPending,
        });
        actions.push({
          label: cancelAutoDirectorMutation.isPending ? "退出中..." : "退出导演模式",
          onClick: () => cancelAutoDirectorMutation.mutate(task.id),
          variant: "destructive",
          disabled: cancelAutoDirectorMutation.isPending,
        });
      } else {
        actions.push({
          label: "退出导演模式",
          onClick: () => setIsDirectorExitActionExpanded(true),
          variant: "destructive",
          disabled: cancelAutoDirectorMutation.isPending,
        });
      }
    } else if (
      task.status === "failed"
      || task.status === "cancelled"
    ) {
      actions.push({
        label: archiveCompletedAutoDirectorMutation.isPending ? "移除中..." : "从任务列表移除",
        onClick: () => archiveCompletedAutoDirectorMutation.mutate(task.id),
        variant: "secondary",
        disabled: archiveCompletedAutoDirectorMutation.isPending,
      });
    } else if (canArchiveCompletedAutoDirectorTask(task)) {
      actions.push({
        label: archiveCompletedAutoDirectorMutation.isPending ? "收起中..." : "完成并收起",
        onClick: () => archiveCompletedAutoDirectorMutation.mutate(task.id),
        variant: "secondary",
        disabled: archiveCompletedAutoDirectorMutation.isPending,
      });
    } else if (task.status === "waiting_approval") {
      actions.push({
        label: "收起此提醒",
        onClick: dismissTakeover,
        variant: "secondary",
      });
    }
    actions.push({
      label: "执行详情",
      onClick: () => setIsTaskDrawerOpen(true),
      variant: mode === "running" ? "outline" : "secondary",
    });

    return {
      mode,
      title: consistencyIssue === "missing_characters"
        ? `《${novelTitle}》导演产物未补齐角色准备`
        : consistencyIssue === "missing_chapters"
          ? `《${novelTitle}》导演产物未连接到章节执行区`
          : task.pendingManualRecovery
            ? `《${novelTitle}》等待从检查点恢复`
          : buildTakeoverTitle({
            mode,
            novelTitle,
            checkpointType: task.checkpointType,
            scopeLabel: autoExecutionScopeLabel,
          }),
      description: consistencyIssue === "missing_characters"
        ? "任务记录显示已完成开书交接，但当前项目里还没有角色资产，所以角色准备和章节执行都不完整。可以直接补齐导演产物，系统会继续修复。"
        : consistencyIssue === "missing_chapters"
          ? "任务记录显示前几章已经可开写，但当前章节执行区还是空的，说明导演产物还没有完整落库。可以直接补齐导演产物继续修复。"
          : task.pendingManualRecovery
            ? "任务已停在当前进度。你可以查看执行详情，再从最近进度点继续。"
          : buildTakeoverDescription({
            mode,
            checkpointType: task.checkpointType,
            reviewScope,
            scopeLabel: autoExecutionScopeLabel,
          }),
      progress: typeof dashboardView?.progressPercent === "number"
        ? dashboardView.progressPercent
        : task.progress,
      currentAction: consistencyIssue === "missing_characters"
        ? "检测到角色准备仍为空，当前导演结果需要继续补齐。"
        : consistencyIssue === "missing_chapters"
          ? "检测到章节执行区为空，当前导演结果需要继续同步章节资源。"
          : task.pendingManualRecovery
            ? (
              task.blockingReason?.trim()
              || task.recoveryHint?.trim()
              || task.lastError?.trim()
              || "任务已暂停，等待从最近检查点恢复。"
            )
          : dashboardView?.currentAction?.trim()
            ? dashboardView.currentAction.trim()
          : activeDirectorSnapshot?.displayState.currentAction?.trim()
            ? activeDirectorSnapshot.displayState.currentAction.trim()
          : automationActionText
            ? automationActionText
          : mode === "running" && task.checkpointType === "chapter_batch_ready" && task.currentItemLabel?.includes("已暂停")
            ? `正在继续自动执行${autoExecutionScopeLabel}`
            : task.currentItemLabel ?? null,
      checkpointLabel: consistencyIssue
        ? "导演产物待补齐"
        : task.pendingManualRecovery
          ? "等待恢复"
        : mode === "running" && task.checkpointType === "chapter_batch_ready"
          ? `${autoExecutionScopeLabel}自动执行中`
          : formatTakeoverCheckpoint(task.checkpointType, task),
      taskId: task.id,
      actions,
    };
  }, [
    activeAutoDirectorTask,
    activeChapterTitleWarning,
    activeDirectorSnapshot?.dashboardView,
    activeDirectorSnapshot?.displayState.currentAction,
    activeDirectorSession,
    activeTab,
    archiveCompletedAutoDirectorMutation,
    bookAutomationProjection,
    chapters.length,
    chapterTitleRepairMutation,
    characters.length,
    cancelAutoDirectorMutation,
    continueAutoDirectorMutation,
    continueAutoExecutionMutation,
    dismissTakeover,
    hasUnsavedVolumeDraft,
    isDirectorExitActionExpanded,
    novelDetailQuery.data?.data?.title,
    openCandidateSelection,
    openQualityRepair,
    displayAutoDirectorTask,
    setActiveTab,
    setSelectedChapterId,
  ]);
  const taskDrawerActions = useMemo<NovelTaskDrawerState["actions"]>(() => {
    const task = displayAutoDirectorTask;
    if (!task) {
      return [];
    }
    const actions: NovelTaskDrawerState["actions"] = [];
    if (activeChapterTitleWarning) {
      actions.push({
        label: chapterTitleRepairMutation.isPending && chapterTitleRepairMutation.pendingTaskId === task.id
          ? "AI 修复中..."
          : activeChapterTitleWarning.label,
        onClick: () => {
          if (hasUnsavedVolumeDraft) {
            toast.error("当前拆章工作区还有未保存修改，请先保存工作区，再发起 AI 修复标题。");
            return;
          }
          chapterTitleRepairMutation.startRepair(task);
        },
        variant: "default",
        disabled: chapterTitleRepairMutation.isPending,
      });
    }
    if (consistencyIssue) {
      actions.push({
        label: continueAutoDirectorMutation.isPending ? "补齐中..." : "补齐导演产物",
        onClick: () => continueAutoDirectorMutation.mutate({ directorTaskId: task.id }),
        variant: "default",
        disabled: continueAutoDirectorMutation.isPending,
      });
      if (consistencyIssue === "missing_characters") {
        actions.push({
          label: "去角色准备",
          onClick: () => {
            setActiveTab("character");
            setIsTaskDrawerOpen(false);
          },
          variant: "outline",
        });
      }
    } else if (
      task.checkpointType === "replan_required"
      && (task.status === "waiting_approval" || task.status === "failed" || task.status === "cancelled")
    ) {
      actions.push({
        label: buildReplanAndContinueActionLabel(continueAutoExecutionMutation.isPending),
        onClick: () => continueAutoExecutionMutation.mutate({
          directorTaskId: task.id,
          continuationMode: "auto_execute_range",
        }),
        variant: "default",
        disabled: continueAutoExecutionMutation.isPending,
      });
      actions.push({
        label: "打开质量修复",
        onClick: () => openQualityRepair(task),
        variant: "outline",
      });
    } else if (task.pendingManualRecovery) {
      actions.push({
        label: continueAutoDirectorMutation.isPending ? "继续中..." : "继续自动导演",
        onClick: () => continueAutoDirectorMutation.mutate({ directorTaskId: task.id }),
        variant: "default",
        disabled: continueAutoDirectorMutation.isPending,
      });
    } else if (
      task.status === "waiting_approval"
      && task.checkpointType === "chapter_batch_ready"
    ) {
      const autoExecutionScopeLabel = resolveAutoExecutionScopeLabel(task);
      actions.push({
        label: buildContinueAutoExecutionActionLabel(autoExecutionScopeLabel, continueAutoExecutionMutation.isPending),
        onClick: () => continueAutoExecutionMutation.mutate({ directorTaskId: task.id }),
        variant: "default",
        disabled: continueAutoExecutionMutation.isPending,
      });
      actions.push({
        label: "进入章节执行",
        onClick: () => openChapterExecution(task),
        variant: "outline",
      });
    } else if (task.status === "waiting_approval" && task.checkpointType === "candidate_selection_required") {
      actions.push({
        label: "去确认书级方向",
        onClick: () => openCandidateSelection(task.id),
        variant: "default",
      });
    } else if (
      task.status === "waiting_approval"
      && reviewTab
      && task.checkpointType !== "chapter_batch_ready"
    ) {
      actions.push({
        label: "去当前审核阶段",
        onClick: openReviewStage,
        variant: "default",
      });
      actions.push({
        label: continueAutoDirectorMutation.isPending ? "继续中..." : "继续自动导演",
        onClick: () => continueAutoDirectorMutation.mutate({ directorTaskId: task.id }),
        variant: "outline",
        disabled: continueAutoDirectorMutation.isPending,
      });
    } else if ((task.status === "failed" || task.status === "cancelled") && task.checkpointType === "chapter_batch_ready") {
      const autoExecutionScopeLabel = resolveAutoExecutionScopeLabel(task);
      actions.push({
        label: buildContinueAutoExecutionActionLabel(autoExecutionScopeLabel, continueAutoExecutionMutation.isPending),
        onClick: () => continueAutoExecutionMutation.mutate({ directorTaskId: task.id }),
        variant: "default",
        disabled: continueAutoExecutionMutation.isPending,
      });
      actions.push({
        label: "打开质量修复",
        onClick: () => openQualityRepair(task),
        variant: "outline",
      });
    } else if (task.checkpointType === "chapter_batch_ready" || task.checkpointType === "workflow_completed") {
      actions.push({
        label: "进入章节执行",
        onClick: () => openChapterExecution(task),
        variant: "default",
      });
    }



    if (canCancelDirectorTask(task)) {
      actions.push({
        label: cancelAutoDirectorMutation.isPending ? "取消中..." : "取消任务",
        onClick: () => cancelAutoDirectorMutation.mutate(task.id),
        variant: "destructive",
        disabled: cancelAutoDirectorMutation.isPending,
      });
    }
    return actions;
  }, [
    activeChapterTitleWarning,
    cancelAutoDirectorMutation,
    chapterTitleRepairMutation,
    consistencyIssue,
    continueAutoDirectorMutation,
    continueAutoExecutionMutation,
    displayAutoDirectorTask,
    hasUnsavedVolumeDraft,
    openCandidateSelection,
    openReviewStage,
    openChapterExecution,
    openQualityRepair,
    reviewTab,
    setActiveTab,
  ]);

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
