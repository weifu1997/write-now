import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  DirectorContinuationMode,
  DirectorStepCalibrationAction,
} from "@write-now/shared/types/novelDirector";
import type { AutoDirectorMutationActionCode } from "@write-now/shared/types/autoDirectorFollowUp";
import type { UnifiedTaskDetail } from "@write-now/shared/types/task";
import {
  acceptManualChangesAndContinueDirector,
  calibrateDirectorStep,
} from "@/api/novelDirector";
import { executeAutoDirectorFollowUpAction } from "@/api/autoDirectorFollowUps";
import {
  archiveTask,
  cancelTask,
  retryTask,
} from "@/api/tasks";
import { continueNovelWorkflow } from "@/api/novelWorkflow";
import { toast } from "@/components/ui/toast";
import {
  resolveDirectorContinueMode,
  resolveWorkflowContinuationFeedback,
} from "@/lib/novelWorkflowContinuation";
import { syncAutoDirectorTaskCache } from "@/lib/taskQueryCache";

export interface UseDirectorWorkspaceMutationsInput {
  id: string;
  actionTargetDirectorTaskId?: string;
  visibleDirectorTask: UnifiedTaskDetail | null;
  activeAutoDirectorTask: UnifiedTaskDetail | null;
  displayAutoDirectorTask: UnifiedTaskDetail | null;
  activeAutoExecutionScopeLabel: string;
  llm: {
    provider: string;
    model: string;
    temperature?: number;
  };
  setDirectorTaskId: (id: string) => void;
  invalidateAutoDirectorTaskState: (taskId?: string) => Promise<unknown>;
  alignToAutoDirectorResumeTarget: (targetTask: UnifiedTaskDetail | null) => void;
  setIsTaskDrawerOpen: (open: boolean) => void;
  setIsDirectorExitActionExpanded: (expanded: boolean) => void;
}

export function useDirectorWorkspaceMutations(input: UseDirectorWorkspaceMutationsInput) {
  const {
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
  } = input;

  const queryClient = useQueryClient();

  const continueAutoDirectorMutation = useMutation({
    mutationFn: async (mutationInput?: { directorTaskId?: string }) => {
      const targetTaskId = mutationInput?.directorTaskId || actionTargetDirectorTaskId;
      const targetTask = targetTaskId === visibleDirectorTask?.id ? visibleDirectorTask : activeAutoDirectorTask;
      if (!targetTaskId) {
        throw new Error("当前没有可继续的自动导演任务。");
      }
      return continueNovelWorkflow(targetTaskId, {
        continuationMode: resolveDirectorContinueMode(targetTask),
      });
    },
    onSuccess: async (response, mutationInput) => {
      const targetTaskId = mutationInput?.directorTaskId || actionTargetDirectorTaskId;
      const targetTask = targetTaskId === visibleDirectorTask?.id ? visibleDirectorTask : activeAutoDirectorTask;
      setDirectorTaskId(response.data?.taskId ?? targetTaskId ?? "");
      void invalidateAutoDirectorTaskState((response.data?.taskId ?? targetTaskId) || undefined);
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
    mutationFn: async (mutationInput: {
      directorTaskId: string;
      stepId: string;
      action: DirectorStepCalibrationAction;
      instruction?: string | null;
    }) => calibrateDirectorStep(mutationInput.directorTaskId, {
      stepId: mutationInput.stepId,
      action: mutationInput.action,
      instruction: mutationInput.instruction,
    }),
    onSuccess: async (_response, mutationInput) => {
      await invalidateAutoDirectorTaskState(mutationInput.directorTaskId);
      toast.success(mutationInput.action === "validate" ? "当前步骤检查已完成。" : "当前步骤已更新，请检查结果。");
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
    mutationFn: async (mutationInput?: { directorTaskId?: string; continuationMode?: "auto_execute_range" | "skip_quality_repair" }) => {
      const targetTaskId = mutationInput?.directorTaskId || actionTargetDirectorTaskId;
      if (!targetTaskId) {
        throw new Error("当前没有可继续自动执行的自动导演任务。");
      }
      return continueNovelWorkflow(targetTaskId, {
        continuationMode: mutationInput?.continuationMode ?? "auto_execute_range",
      });
    },
    onSuccess: async (response, mutationInput) => {
      const targetTaskId = mutationInput?.directorTaskId || actionTargetDirectorTaskId;
      const targetTask = targetTaskId === visibleDirectorTask?.id ? visibleDirectorTask : activeAutoDirectorTask;
      setDirectorTaskId(response.data?.taskId ?? targetTaskId ?? "");
      void invalidateAutoDirectorTaskState((response.data?.taskId ?? targetTaskId) || undefined);
      const feedback = resolveWorkflowContinuationFeedback(response.data, {
        mode: mutationInput?.continuationMode ?? "auto_execute_range",
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
    mutationFn: async (mutationInput: {
      taskId: string;
      mode?: DirectorContinuationMode;
    }) => continueNovelWorkflow(
      mutationInput.taskId,
      mutationInput.mode ? { continuationMode: mutationInput.mode } : undefined,
    ),
    onSuccess: async (response, mutationInput) => {
      setDirectorTaskId(response.data?.taskId ?? mutationInput.taskId);
      void invalidateAutoDirectorTaskState(response.data?.taskId ?? mutationInput.taskId);
      const feedback = resolveWorkflowContinuationFeedback(response.data, {
        mode: mutationInput.mode,
        scopeLabel: activeAutoExecutionScopeLabel,
      });
      if (feedback.tone === "error") {
        toast.error(feedback.message);
        return;
      }
      alignToAutoDirectorResumeTarget(mutationInput.taskId === visibleDirectorTask?.id ? visibleDirectorTask : activeAutoDirectorTask);
      toast.success(feedback.message);
    },
    onError: (error, mutationInput) => {
      const message = error instanceof Error
        ? error.message
        : mutationInput.mode === "auto_execute_range"
          ? `继续自动执行${activeAutoExecutionScopeLabel}失败。`
          : "继续自动导演失败。";
      toast.error(message);
    },
  });

  const executeFollowUpActionMutation = useMutation({
    mutationFn: async (mutationInput: {
      directorTaskId?: string;
      actionCode: AutoDirectorMutationActionCode;
    }) => {
      const targetTaskId = mutationInput.directorTaskId || actionTargetDirectorTaskId;
      if (!targetTaskId) {
        throw new Error("当前没有可执行的动作。");
      }
      return executeAutoDirectorFollowUpAction(targetTaskId, {
        actionCode: mutationInput.actionCode,
        idempotencyKey: `${targetTaskId}:${mutationInput.actionCode}:${Date.now()}`,
      });
    },
    onSuccess: async (response, mutationInput) => {
      const result = response.data;
      if (result?.task) {
        syncAutoDirectorTaskCache(queryClient, id, result.task);
      }
      setDirectorTaskId(result?.directorTaskId ?? result?.taskId ?? mutationInput.directorTaskId ?? actionTargetDirectorTaskId ?? "");
      await invalidateAutoDirectorTaskState((result?.directorTaskId ?? result?.taskId ?? mutationInput.directorTaskId ?? actionTargetDirectorTaskId) || undefined);
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

  return {
    continueAutoDirectorMutation,
    calibrateDirectorStepMutation,
    acceptManualChangesAndContinueMutation,
    continueAutoExecutionMutation,
    continueProjectedDirectorActionMutation,
    executeFollowUpActionMutation,
    retryableAutoDirectorTask,
    retryAutoDirectorWithCurrentModelMutation,
    retryAutoDirectorWithTaskModelMutation,
    cancelAutoDirectorMutation,
    archiveCompletedAutoDirectorMutation,
  };
}
