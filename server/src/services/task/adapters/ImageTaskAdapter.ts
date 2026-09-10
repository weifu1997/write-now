import type { TaskStatus, UnifiedTaskDetail, UnifiedTaskSummary } from "@write-now/shared/types/task";
import { prisma } from "../../../db/prisma";
import { AppError } from "../../../middleware/errorHandler";
import { imageGenerationService } from "../../image/ImageGenerationService";
import { IMAGE_TASK_STEPS, buildSteps, toLegacyTaskStatus } from "../taskCenter.shared";
import {
  buildTaskRecoveryHint,
  isArchivableTaskStatus,
  normalizeFailureSummary,
} from "../taskSupport";
import {
  archiveTask as recordTaskArchive,
  getArchivedTaskIds,
  isTaskArchived,
} from "../taskArchive";
import {
  isSameImageTaskOwner,
  selectLatestVisibleImageTasks,
} from "../imageTaskOwnerVisibility";

function buildImageTaskPresentation(row: {
  id: string;
  sceneType: string;
  baseCharacterId: string | null;
  novelId: string | null;
  baseCharacter?: { id: string; name: string } | null;
  novel?: { id: string; title: string } | null;
}) {
  if (row.sceneType === "novel_cover" && row.novelId) {
    const title = row.novel?.title?.trim() || `小说 ${row.novelId.slice(0, 8)}`;
    const route = `/novels/${row.novelId}/edit?stage=basic`;
    return {
      title: `小说封面：${title}`,
      ownerId: row.novelId,
      ownerLabel: title,
      sourceRoute: route,
      sourceResource: {
        type: "novel" as const,
        id: row.novelId,
        label: title,
        route,
      },
    };
  }

  const ownerId = row.baseCharacterId ?? row.id;
  const ownerLabel = row.baseCharacter?.name ?? "未关联角色";
  const sourceRoute = row.baseCharacterId ? `/base-characters?id=${row.baseCharacterId}` : "/base-characters";
  return {
    title: row.baseCharacter?.name ? `角色图像：${row.baseCharacter.name}` : `图像任务 ${row.id.slice(0, 8)}`,
    ownerId,
    ownerLabel,
    sourceRoute,
    sourceResource: row.baseCharacterId
      ? {
        type: "base_character" as const,
        id: row.baseCharacterId,
        label: row.baseCharacter?.name ?? "基础角色",
        route: sourceRoute,
      }
      : {
        type: "task" as const,
        id: row.id,
        label: `图像任务 ${row.id.slice(0, 8)}`,
        route: "/tasks",
      },
  };
}

export class ImageTaskAdapter {
  async list(input: {
    status?: TaskStatus;
    keyword?: string;
    take: number;
  }): Promise<UnifiedTaskSummary[]> {
    if (input.status === "waiting_approval") {
      return [];
    }
    const status = toLegacyTaskStatus(input.status);
    const archivedIds = await getArchivedTaskIds("image_generation");
    const rows = await prisma.imageGenerationTask.findMany({
      where: {
        ...(archivedIds.length
          ? {
            id: {
              notIn: archivedIds,
            },
          }
          : {}),
        ...(input.keyword
          ? {
            OR: [
              { prompt: { contains: input.keyword } },
              { baseCharacter: { name: { contains: input.keyword } } },
              { novel: { title: { contains: input.keyword } } },
            ],
          }
          : {}),
      },
      include: {
        baseCharacter: {
          select: {
            id: true,
            name: true,
          },
        },
        novel: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: Math.max(input.take * 8, 80),
    });

    return selectLatestVisibleImageTasks(rows)
      .filter((row) => !status || row.status === status)
      .sort((left, right) => {
        const timeDelta = right.updatedAt.getTime() - left.updatedAt.getTime();
        return timeDelta !== 0 ? timeDelta : right.id.localeCompare(left.id);
      })
      .slice(0, input.take)
      .map((row) => ({
        ...buildImageTaskPresentation(row),
        id: row.id,
        kind: "image_generation",
        status: row.status as TaskStatus,
        progress: row.progress,
        currentStage: row.currentStage,
        currentItemLabel: row.currentItemLabel,
        attemptCount: row.retryCount,
        maxAttempts: row.maxRetries,
        lastError: row.error,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        heartbeatAt: row.heartbeatAt?.toISOString() ?? null,
        failureCode: row.status === "failed" ? "IMAGE_GENERATION_FAILED" : null,
        failureSummary: row.status === "failed"
          ? normalizeFailureSummary(row.error, "图像任务失败，但没有记录明确错误。")
          : row.error,
        recoveryHint: buildTaskRecoveryHint("image_generation", row.status as TaskStatus),
        targetResources: [],
      }));
  }

  async detail(id: string): Promise<UnifiedTaskDetail | null> {
    if (await isTaskArchived("image_generation", id)) {
      return null;
    }

    const row = await prisma.imageGenerationTask.findUnique({
      where: { id },
      include: {
        baseCharacter: {
          select: {
            id: true,
            name: true,
          },
        },
        novel: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });
    if (!row) {
      return null;
    }

    const presentation = buildImageTaskPresentation(row);
    const summary: UnifiedTaskSummary = {
      ...presentation,
      id: row.id,
      kind: "image_generation",
      status: row.status as TaskStatus,
      progress: row.progress,
      currentStage: row.currentStage,
      currentItemLabel: row.currentItemLabel,
      attemptCount: row.retryCount,
      maxAttempts: row.maxRetries,
      lastError: row.error,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      heartbeatAt: row.heartbeatAt?.toISOString() ?? null,
      failureCode: row.status === "failed" ? "IMAGE_GENERATION_FAILED" : null,
      failureSummary: row.status === "failed"
        ? normalizeFailureSummary(row.error, "图像任务失败，但没有记录明确错误。")
        : row.error,
      recoveryHint: buildTaskRecoveryHint("image_generation", row.status as TaskStatus),
      targetResources: [],
    };

    return {
      ...summary,
      provider: row.provider,
      model: row.model,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      retryCountLabel: `${row.retryCount}/${row.maxRetries}`,
      meta: {
        sceneType: row.sceneType,
        baseCharacterId: row.baseCharacterId,
        novelId: row.novelId,
        prompt: row.prompt,
        negativePrompt: row.negativePrompt,
        size: row.size,
        imageCount: row.imageCount,
        cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
      },
      steps: buildSteps(
        IMAGE_TASK_STEPS,
        summary.status,
        summary.currentStage,
        summary.createdAt,
        summary.updatedAt,
      ),
      failureDetails: row.error,
    };
  }

  async retry(id: string): Promise<UnifiedTaskDetail> {
    if (await isTaskArchived("image_generation", id)) {
      throw new AppError("Task not found.", 404);
    }

    const task = await imageGenerationService.retryTask(id);
    const detail = await this.detail(task.id);
    if (!detail) {
      throw new AppError("Task not found after retry.", 404);
    }
    return detail;
  }

  async cancel(id: string): Promise<UnifiedTaskDetail> {
    if (await isTaskArchived("image_generation", id)) {
      throw new AppError("Task not found.", 404);
    }

    const task = await imageGenerationService.cancelTask(id);
    const detail = await this.detail(task.id);
    if (!detail) {
      throw new AppError("Task not found after cancellation.", 404);
    }
    return detail;
  }

  async archive(id: string): Promise<UnifiedTaskDetail | null> {
    if (await isTaskArchived("image_generation", id)) {
      return null;
    }

    const task = await prisma.imageGenerationTask.findUnique({
      where: { id },
    });
    if (!task) {
      throw new AppError("Task not found.", 404);
    }
    if (!isArchivableTaskStatus(task.status as TaskStatus)) {
      throw new AppError("Only completed, failed, or cancelled tasks can be archived.", 400);
    }

    const ownerWhere = task.sceneType === "novel_cover" && task.novelId
      ? { sceneType: "novel_cover" as const, novelId: task.novelId }
      : task.sceneType === "character" && task.baseCharacterId
        ? { sceneType: "character" as const, baseCharacterId: task.baseCharacterId }
        : task.sceneType === "book_analysis_character" && task.bookAnalysisCharacterId
          ? {
            sceneType: "book_analysis_character" as const,
            bookAnalysisCharacterId: task.bookAnalysisCharacterId,
          }
          : { id: task.id };
    const siblings = await prisma.imageGenerationTask.findMany({
      where: ownerWhere,
      select: {
        id: true,
        sceneType: true,
        novelId: true,
        baseCharacterId: true,
        bookAnalysisCharacterId: true,
        status: true,
        updatedAt: true,
      },
    });
    const idsToArchive = siblings
      .filter((row) => isSameImageTaskOwner(task, row) && isArchivableTaskStatus(row.status as TaskStatus))
      .map((row) => row.id);
    await Promise.all(
      (idsToArchive.length > 0 ? idsToArchive : [id]).map((taskId) => recordTaskArchive("image_generation", taskId)),
    );
    return null;
  }
}
