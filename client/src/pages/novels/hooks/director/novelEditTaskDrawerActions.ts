import type { UnifiedTaskDetail } from "@write-now/shared/types/task";
import { toast } from "@/components/ui/toast";
import type { NovelTaskDrawerState } from "../../components/NovelEditView.types";
import {
  buildContinueAutoExecutionActionLabel,
  buildReplanAndContinueActionLabel,
  resolveAutoExecutionScopeLabel,
} from "../../novelEditTakeover.shared";
import { canCancelDirectorTask } from "@/lib/novelWorkflowTaskUi";

export interface ComputeTaskDrawerActionsInput {
  displayAutoDirectorTask: UnifiedTaskDetail | null;
  activeChapterTitleWarning?: { label: string } | null;
  chapterTitleRepairMutation: {
    isPending: boolean;
    pendingTaskId?: string | null;
    startRepair: (task: UnifiedTaskDetail) => void;
  };
  hasUnsavedVolumeDraft: boolean;
  consistencyIssue?: string | null;
  continueAutoDirectorMutation: {
    isPending: boolean;
    mutate: (input?: { directorTaskId?: string }) => void;
  };
  continueAutoExecutionMutation: {
    isPending: boolean;
    mutate: (input?: { directorTaskId?: string; continuationMode?: "auto_execute_range" | "skip_quality_repair" }) => void;
  };
  cancelAutoDirectorMutation: {
    isPending: boolean;
    mutate: (taskId?: string) => void;
  };
  openCandidateSelection: (taskId: string) => void;
  openQualityRepair: (task: UnifiedTaskDetail) => void;
  openChapterExecution: (task: UnifiedTaskDetail) => void;
  openReviewStage: () => void;
  setActiveTab: (tab: string) => void;
  setIsTaskDrawerOpen: (open: boolean) => void;
  reviewTab?: string | null;
}

export function computeTaskDrawerActions(input: ComputeTaskDrawerActionsInput): NovelTaskDrawerState["actions"] {
  const task = input.displayAutoDirectorTask;
  if (!task) {
    return [];
  }
  const actions: NovelTaskDrawerState["actions"] = [];

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
      variant: "default",
      disabled: input.chapterTitleRepairMutation.isPending,
    });
  }

  if (input.consistencyIssue) {
    actions.push({
      label: input.continueAutoDirectorMutation.isPending ? "补齐中..." : "补齐导演产物",
      onClick: () => input.continueAutoDirectorMutation.mutate({ directorTaskId: task.id }),
      variant: "default",
      disabled: input.continueAutoDirectorMutation.isPending,
    });
    if (input.consistencyIssue === "missing_characters") {
      actions.push({
        label: "去角色准备",
        onClick: () => {
          input.setActiveTab("character");
          input.setIsTaskDrawerOpen(false);
        },
        variant: "outline",
      });
    }
  } else if (
    task.checkpointType === "replan_required"
    && (task.status === "waiting_approval" || task.status === "failed" || task.status === "cancelled")
  ) {
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
  } else if (task.pendingManualRecovery) {
    actions.push({
      label: input.continueAutoDirectorMutation.isPending ? "继续中..." : "继续自动导演",
      onClick: () => input.continueAutoDirectorMutation.mutate({ directorTaskId: task.id }),
      variant: "default",
      disabled: input.continueAutoDirectorMutation.isPending,
    });
  } else if (
    task.status === "waiting_approval"
    && task.checkpointType === "chapter_batch_ready"
  ) {
    const autoExecutionScopeLabel = resolveAutoExecutionScopeLabel(task);
    actions.push({
      label: buildContinueAutoExecutionActionLabel(autoExecutionScopeLabel, input.continueAutoExecutionMutation.isPending),
      onClick: () => input.continueAutoExecutionMutation.mutate({ directorTaskId: task.id }),
      variant: "default",
      disabled: input.continueAutoExecutionMutation.isPending,
    });
    actions.push({
      label: "进入章节执行",
      onClick: () => input.openChapterExecution(task),
      variant: "outline",
    });
  } else if (task.status === "waiting_approval" && task.checkpointType === "candidate_selection_required") {
    actions.push({
      label: "去确认书级方向",
      onClick: () => input.openCandidateSelection(task.id),
      variant: "default",
    });
  } else if (
    task.status === "waiting_approval"
    && input.reviewTab
    && task.checkpointType !== "chapter_batch_ready"
  ) {
    actions.push({
      label: "去当前审核阶段",
      onClick: input.openReviewStage,
      variant: "default",
    });
    actions.push({
      label: input.continueAutoDirectorMutation.isPending ? "继续中..." : "继续自动导演",
      onClick: () => input.continueAutoDirectorMutation.mutate({ directorTaskId: task.id }),
      variant: "outline",
      disabled: input.continueAutoDirectorMutation.isPending,
    });
  } else if ((task.status === "failed" || task.status === "cancelled") && task.checkpointType === "chapter_batch_ready") {
    const autoExecutionScopeLabel = resolveAutoExecutionScopeLabel(task);
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
  } else if (task.checkpointType === "chapter_batch_ready" || task.checkpointType === "workflow_completed") {
    actions.push({
      label: "进入章节执行",
      onClick: () => input.openChapterExecution(task),
      variant: "default",
    });
  }

  if (canCancelDirectorTask(task)) {
    actions.push({
      label: input.cancelAutoDirectorMutation.isPending ? "取消中..." : "取消任务",
      onClick: () => input.cancelAutoDirectorMutation.mutate(task.id),
      variant: "destructive",
      disabled: input.cancelAutoDirectorMutation.isPending,
    });
  }
  return actions;
}
