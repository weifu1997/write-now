import type { Router } from "express";
import type { ApiResponse } from "@write-now/shared/types/api";
import { z } from "zod";
import { AppError } from "../../../../middleware/errorHandler";
import { validate } from "../../../../middleware/validate";
import type { NovelApplicationServices } from "../../../../services/novel/application/NovelApplicationContracts";

const novelParamsSchema = z.object({ id: z.string().min(1) });
const chapterParamsSchema = z.object({ id: z.string().min(1), chapterId: z.string().min(1) });
const anchorParamsSchema = z.object({ id: z.string().min(1), anchorId: z.string().min(1) });
const styleAnchorCreateSchema = z.object({
  text: z.string().min(1).max(4000),
  source: z.enum(["adopted", "manual"]),
});

interface RegisterNovelStyleAnchorRoutesInput {
  router: Router;
  novelService: Pick<NovelApplicationServices,
    | "createStyleAnchor"
    | "listStyleAnchors"
    | "deleteStyleAnchor"
  >;
  forwardBusinessError: (error: unknown, next: (err?: unknown) => void) => boolean;
}

export function registerNovelStyleAnchorRoutes(input: RegisterNovelStyleAnchorRoutesInput): void {
  const { router, novelService, forwardBusinessError } = input;

  const forward = (error: unknown, next: (err?: unknown) => void): boolean => {
    if (forwardBusinessError(error, next)) {
      return true;
    }
    if (error instanceof Error && error.message === "小说不存在。") {
      next(new AppError(error.message, 400));
      return true;
    }
    return false;
  };

  router.post(
    "/:id/chapters/:chapterId/style-anchors",
    validate({ params: chapterParamsSchema, body: styleAnchorCreateSchema }),
    async (req, res, next) => {
      try {
        const { id, chapterId } = req.params as z.infer<typeof chapterParamsSchema>;
        const body = req.body as z.infer<typeof styleAnchorCreateSchema>;
        const result = await novelService.createStyleAnchor(id, chapterId, body);
        res.status(result.created ? 201 : 200).json({
          success: true,
          data: result,
          message: result.created ? "范文已收录，之后的写作会参考它的写法。" : "这段内容已在范文中，无需重复收录。",
        } satisfies ApiResponse<typeof result>);
      } catch (error) {
        if (forward(error, next)) {
          return;
        }
        next(error);
      }
    },
  );

  router.get(
    "/:id/style-anchors",
    validate({ params: novelParamsSchema }),
    async (req, res, next) => {
      try {
        const { id } = req.params as z.infer<typeof novelParamsSchema>;
        const anchors = await novelService.listStyleAnchors(id);
        res.status(200).json({
          success: true,
          data: anchors,
          message: "范文列表已加载。",
        } satisfies ApiResponse<typeof anchors>);
      } catch (error) {
        if (forward(error, next)) {
          return;
        }
        next(error);
      }
    },
  );

  router.delete(
    "/:id/style-anchors/:anchorId",
    validate({ params: anchorParamsSchema }),
    async (req, res, next) => {
      try {
        const { id, anchorId } = req.params as z.infer<typeof anchorParamsSchema>;
        const deleted = await novelService.deleteStyleAnchor(id, anchorId);
        res.status(200).json({
          success: true,
          data: { deleted },
          message: deleted ? "范文已移除。" : "范文不存在或已删除。",
        } satisfies ApiResponse<{ deleted: boolean }>);
      } catch (error) {
        if (forward(error, next)) {
          return;
        }
        next(error);
      }
    },
  );
}
