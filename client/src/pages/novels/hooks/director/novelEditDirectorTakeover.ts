import type { DirectorTaskSnapshot } from "@write-now/shared/types/directorRuntime";
import {
  extractDirectorTaskSeedPayloadFromMeta,
  type DirectorSessionState,
  type DirectorStepCalibrationAction,
} from "@write-now/shared/types/novelDirector";
import type { UnifiedTaskDetail } from "@write-now/shared/types/task";
import { toast } from "@/components/ui/toast";
import {
  buildContinueAutoExecutionActionLabel,
  buildReplanAndContinueActionLabel,
  buildTakeoverDescription,
  buildTakeoverTitle,
  formatTakeoverCheckpoint,
  resolveAutoExecutionScopeLabel,
} from "../../novelEditTakeover.shared";
import {
  canArchiveCompletedAutoDirectorTask,
  resolveAutomationActionText,
  resolveTakeoverModeFromAutomation,
} from "../../novelEditAutomationStatus";
import {
  mapDashboardModeToTakeoverMode,
  resolveDirectorConsistencyIssue,
} from "../../novelEditPageHelpers";
import { tabFromScope } from "../../novelWorkspaceNavigation";
import { canCancelDirectorTask } from "@/lib/novelWorkflowTaskUi";
import type { NovelEditTakeoverState } from "../../components/NovelEditView.types";

export interface ComputeNovelEditTakeoverInput {
  displayAutoDirectorTask: UnifiedTaskDetail | null;
  activeAutoDirectorTask?: UnifiedTaskDetail | null;
  charactersCount: number;
  chaptersCount: number;
  activeDirectorSnapshot?: DirectorTaskSnapshot | null;
  bookAutomationProjection?: unknown;
  novelTitle: string;
  activeDirectorSession?: DirectorSessionState | null;
  activeChapterTitleWarning?: { label: string } | null;
  chapterTitleRepairMutation: {
    isPending: boolean;
    pendingTaskId?: string | null;
    startRepair: (task: UnifiedTaskDetail) => void;
  };
  hasUnsavedVolumeDraft: boolean;
  activeTab: string;
  openCandidateSelection: (taskId: string) => void;
  openQualityRepair: (task: UnifiedTaskDetail) => void;
  openChapterExecution: (task: UnifiedTaskDetail) => void;
  setActiveTab: (tab: string) => void;
  setSelectedChapterId: (id: string) => void;
  setIsTaskDrawerOpen: (open: boolean) => void;
  setIsDirectorExitActionExpanded: (expanded: boolean) => void;
  isDirectorExitActionExpanded: boolean;
  dismissTakeover: () => void;
  continueAutoDirectorMutation: {
    isPending: boolean;
    mutate: (input?: { directorTaskId?: string }) => void;
  };
  continueAutoExecutionMutation: {
    isPending: boolean;
    mutate: (input?: { directorTaskId?: string; continuationMode?: "auto_execute_range" | "skip_quality_repair" }) => void;
  };
  calibrateDirectorStepMutation: {
    isPending: boolean;
    mutate: (input: { directorTaskId: string; stepId: string; action: DirectorStepCalibrationAction; instruction?: string | null }) => void;
  };
  acceptManualChangesAndContinueMutation: {
    isPending: boolean;
    mutate: (taskId: string) => void;
  };
  cancelAutoDirectorMutation: {
    isPending: boolean;
    mutate: (taskId?: string) => void;
  };
  archiveCompletedAutoDirectorMutation: {
    isPending: boolean;
    mutate: (taskId?: string) => void;
  };
}

export function computeNovelEditTakeover(input: ComputeNovelEditTakeoverInput): NovelEditTakeoverState | null {
  const task = input.displayAutoDirectorTask;
  if (!task) {
    return null;
  }
  const consistencyIssue = resolveDirectorConsistencyIssue({
    checkpointType: task.checkpointType,
    characterCount: input.charactersCount,
    chapterCount: input.chaptersCount,
  });
  const dashboardView = input.activeDirectorSnapshot?.dashboardView ?? null;
  const mode = mapDashboardModeToTakeoverMode(dashboardView?.mode)
    ?? resolveTakeoverModeFromAutomation({
      task,
      projection: input.bookAutomationProjection as never,
    });
  const automationActionText = resolveAutomationActionText({
    task,
    projection: input.bookAutomationProjection as never,
  });
  const novelTitle = input.novelTitle;
  const reviewScope = input.activeDirectorSession?.reviewScope ?? null;
  const autoExecutionScopeLabel = resolveAutoExecutionScopeLabel(task);
  const actions: NonNullable<NovelEditTakeoverState["actions"]> = [];

  if (input.activeChapterTitleWarning) {
    actions.push({
      label: input.chapterTitleRepairMutation.isPending && input.chapterTitleRepairMutation.pendingTaskId === task.id
        ? "AI 修复中..."
        : input.activeChapterTitleWarning.label,
      onClick: () => {
        if (input.hasUnsavedVolumeDraft) {
          toast.error("当前拆章工作区还有未保存修改，请先保存工作区，再发起 AI 修复标题。");
          return;
        }
        input.chapterTitleRepairMutation.startRepair(task);
      },
      variant: mode === "failed" ? "default" : "outline",
      disabled: input.chapterTitleRepairMutation.isPending,
    });
  }

  const reviewTab = tabFromScope(reviewScope);
  if (
    mode === "waiting"
    && task.checkpointType === "candidate_selection_required"
  ) {
    actions.push({
      label: "去确认书级方向",
      onClick: () => input.openCandidateSelection(task.id),
      variant: "default",
    });
  } else if (
    (mode === "waiting" || mode === "action_required")
    && reviewTab
    && reviewTab !== input.activeTab
    && task.checkpointType !== "chapter_batch_ready"
  ) {
    actions.push({
      label: "去当前审核阶段",
      onClick: () => input.setActiveTab(reviewTab),
      variant: "outline",
    });
  }

  if (task.pendingManualRecovery) {
    actions.push({
      label: input.continueAutoDirectorMutation.isPending ? "继续中..." : "继续自动导演",
      onClick: () => input.continueAutoDirectorMutation.mutate({ directorTaskId: task.id }),
      variant: "default",
      disabled: input.continueAutoDirectorMutation.isPending,
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
        label: input.calibrateDirectorStepMutation.isPending ? "检查中..." : "AI 检查当前步骤",
        onClick: () => input.calibrateDirectorStepMutation.mutate({
          directorTaskId: task.id,
          stepId,
          action: "validate",
        }),
        variant: "outline",
        disabled: input.calibrateDirectorStepMutation.isPending,
      });
      actions.push({
        label: input.calibrateDirectorStepMutation.isPending ? "完善中..." : "AI 完善当前步骤",
        onClick: () => {
          const instruction = requestCalibrationInstruction("improve");
          if (instruction !== undefined) {
            input.calibrateDirectorStepMutation.mutate({ directorTaskId: task.id, stepId, action: "improve", instruction });
          }
        },
        variant: "outline",
        disabled: input.calibrateDirectorStepMutation.isPending,
      });
      actions.push({
        label: input.calibrateDirectorStepMutation.isPending ? "生成中..." : "重新生成当前步骤",
        onClick: () => {
          const instruction = requestCalibrationInstruction("regenerate");
          if (instruction !== undefined) {
            input.calibrateDirectorStepMutation.mutate({ directorTaskId: task.id, stepId, action: "regenerate", instruction });
          }
        },
        variant: "outline",
        disabled: input.calibrateDirectorStepMutation.isPending,
      });
    }
    actions.push({
      label: input.acceptManualChangesAndContinueMutation.isPending ? "确认中..." : "保存并确认",
      onClick: () => input.acceptManualChangesAndContinueMutation.mutate(task.id),
      variant: "default",
      disabled: input.acceptManualChangesAndContinueMutation.isPending,
    });
    actions.push({
      label: input.acceptManualChangesAndContinueMutation.isPending ? "继续中..." : "继续自动导演",
      onClick: () => input.acceptManualChangesAndContinueMutation.mutate(task.id),
      variant: "outline",
      disabled: input.acceptManualChangesAndContinueMutation.isPending,
    });
  } else if (mode === "waiting" && task.checkpointType === "chapter_batch_ready") {
    actions.push({
      label: buildContinueAutoExecutionActionLabel(autoExecutionScopeLabel, input.continueAutoExecutionMutation.isPending),
      onClick: () => input.continueAutoExecutionMutation.mutate({ directorTaskId: task.id }),
      variant: "default",
      disabled: input.continueAutoExecutionMutation.isPending,
    });
    actions.push({
      label: "进入章节执行",
      onClick: () => {
        if (task.resumeTarget?.chapterId) {
          input.setSelectedChapterId(task.resumeTarget.chapterId);
        }
        input.setActiveTab("chapter");
      },
      variant: "outline",
    });
  } else if (mode === "waiting" && task.checkpointType === "workflow_completed") {
    actions.push({
      label: "进入章节执行",
      onClick: () => input.openChapterExecution(task),
      variant: "default",
    });
  } else if ((mode === "action_required" || mode === "failed") && task.checkpointType === "replan_required") {
    actions.push({
      label: buildReplanAndContinueActionLabel(input.continueAutoExecutionMutation.isPending),
      onClick: () => input.continueAutoExecutionMutation.mutate({
        directorTaskId: task.id,
        continuationMode: "auto_execute_range",
      }),
      variant: "default",
      disabled: input.continueAutoExecutionMutation.isPending,
    });
    actions.push({
      label: "打开质量修复",
      onClick: () => input.openQualityRepair(task),
      variant: "outline",
    });
  } else if (mode === "waiting") {
    actions.push({
      label: input.continueAutoDirectorMutation.isPending ? "继续中..." : "继续自动导演",
      onClick: () => input.continueAutoDirectorMutation.mutate({ directorTaskId: task.id }),
      variant: "default",
      disabled: input.continueAutoDirectorMutation.isPending,
    });
  }

  if (mode === "failed" && task.checkpointType === "chapter_batch_ready") {
    actions.push({
      label: buildContinueAutoExecutionActionLabel(autoExecutionScopeLabel, input.continueAutoExecutionMutation.isPending),
      onClick: () => input.continueAutoExecutionMutation.mutate({ directorTaskId: task.id }),
      variant: "default",
      disabled: input.continueAutoExecutionMutation.isPending,
    });
    actions.push({
      label: "打开质量修复",
      onClick: () => input.openQualityRepair(task),
      variant: "outline",
    });
  }

  if (consistencyIssue) {
    actions.push({
      label: input.continueAutoDirectorMutation.isPending ? "修复中..." : "补齐导演产物",
      onClick: () => input.continueAutoDirectorMutation.mutate({ directorTaskId: task.id }),
      variant: "default",
      disabled: input.continueAutoDirectorMutation.isPending,
    });
    if (consistencyIssue === "missing_characters") {
      actions.push({
        label: "去角色准备",
        onClick: () => input.setActiveTab("character"),
        variant: "outline",
      });
    }
  } else if (task.checkpointType === "chapter_batch_ready" && mode !== "waiting") {
    actions.push({
      label: "进入章节执行",
      onClick: () => {
        if (task.resumeTarget?.chapterId) {
          input.setSelectedChapterId(task.resumeTarget.chapterId);
        }
        input.setActiveTab("chapter");
      },
      variant: mode === "running" ? "outline" : "default",
    });
  }

  const canCancelTask = canCancelDirectorTask(task);
  if (canCancelTask) {
    if (task.status === "failed") {
      actions.push({
        label: input.cancelAutoDirectorMutation.isPending ? "取消中..." : "取消任务",
        onClick: () => input.cancelAutoDirectorMutation.mutate(task.id),
        variant: "destructive",
        disabled: input.cancelAutoDirectorMutation.isPending,
      });
    } else if (input.isDirectorExitActionExpanded) {
      actions.push({
        label: "继续导演",
        onClick: () => input.setIsDirectorExitActionExpanded(false),
        variant: "outline",
        disabled: input.cancelAutoDirectorMutation.isPending,
      });
      actions.push({
        label: input.cancelAutoDirectorMutation.isPending ? "退出中..." : "退出导演模式",
        onClick: () => input.cancelAutoDirectorMutation.mutate(task.id),
        variant: "destructive",
        disabled: input.cancelAutoDirectorMutation.isPending,
      });
    } else {
      actions.push({
        label: "退出导演模式",
        onClick: () => input.setIsDirectorExitActionExpanded(true),
        variant: "destructive",
        disabled: input.cancelAutoDirectorMutation.isPending,
      });
    }
  } else if (
    task.status === "failed"
    || task.status === "cancelled"
  ) {
    actions.push({
      label: input.archiveCompletedAutoDirectorMutation.isPending ? "移除中..." : "从任务列表移除",
      onClick: () => input.archiveCompletedAutoDirectorMutation.mutate(task.id),
      variant: "secondary",
      disabled: input.archiveCompletedAutoDirectorMutation.isPending,
    });
  } else if (canArchiveCompletedAutoDirectorTask(task)) {
    actions.push({
      label: input.archiveCompletedAutoDirectorMutation.isPending ? "收起中..." : "完成并收起",
      onClick: () => input.archiveCompletedAutoDirectorMutation.mutate(task.id),
      variant: "secondary",
      disabled: input.archiveCompletedAutoDirectorMutation.isPending,
    });
  } else if (task.status === "waiting_approval") {
    actions.push({
      label: "收起此提醒",
      onClick: input.dismissTakeover,
      variant: "secondary",
    });
  }

  actions.push({
    label: "执行详情",
    onClick: () => input.setIsTaskDrawerOpen(true),
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
        ? "任务记录显示前几章可进入写作，但当前章节执行区为空，说明导演产物尚未完整落库。可直接补齐导演产物继续修复。"
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
        : input.activeDirectorSnapshot?.displayState.currentAction?.trim()
          ? input.activeDirectorSnapshot.displayState.currentAction.trim()
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
}
