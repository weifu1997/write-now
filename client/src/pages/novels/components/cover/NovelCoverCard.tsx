import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listImageAssets, listImageTasks, resolveImageAssetUrl } from "@/api/images";
import { archiveTask } from "@/api/tasks";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/components/ui/button";
import type { NovelBasicFormState } from "../../novelBasicInfo.shared";
import type { StoryWorldSliceView } from "@write-now/shared/types/storyWorldSlice";
import { NovelCoverDialog } from "./NovelCoverDialog";

interface GenreOption {
  id: string;
  label: string;
  path: string;
}

interface StoryModeOption {
  id: string;
  name: string;
  label: string;
  path: string;
}

interface WorldOption {
  id: string;
  name: string;
}

interface NovelCoverCardProps {
  novelId: string;
  basicForm: NovelBasicFormState;
  genreOptions: GenreOption[];
  storyModeOptions: StoryModeOption[];
  worldOptions: WorldOption[];
  worldSliceView?: StoryWorldSliceView | null;
}

export function NovelCoverCard(props: NovelCoverCardProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const assetsQuery = useQuery({
    queryKey: queryKeys.images.assets("novel_cover", props.novelId),
    queryFn: () => listImageAssets({
      sceneType: "novel_cover",
      sceneId: props.novelId,
    }),
    staleTime: 30_000,
  });

  const coverTasksQuery = useQuery({
    queryKey: queryKeys.images.tasks("novel_cover", props.novelId),
    queryFn: () => listImageTasks({
      sceneType: "novel_cover",
      sceneId: props.novelId,
    }),
    staleTime: 15_000,
  });

  const assets = assetsQuery.data?.data ?? [];
  const primaryAsset = useMemo(
    () => assets.find((item) => item.isPrimary) ?? assets[0] ?? null,
    [assets],
  );
  const latestFailedCoverTask = useMemo(() => {
    const latestTask = coverTasksQuery.data?.data?.[0] ?? null;
    return latestTask?.status === "failed" ? latestTask : null;
  }, [coverTasksQuery.data?.data]);

  const dismissCoverHistoryMutation = useMutation({
    mutationFn: (taskId: string) => archiveTask("image_generation", taskId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.images.tasks("novel_cover", props.novelId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.overview }),
        queryClient.invalidateQueries({ queryKey: ["tasks", "list"] }),
      ]);
    },
  });

  return (
    <>
      <section className="space-y-4 border-t border-border/60 pt-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-foreground">小说封面主画面</div>
            <div className="text-sm leading-6 text-muted-foreground">
              先生成这本书的封面主画面。当前阶段不直接生成可用书名字体，后续仍可继续排版成正式封面。
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {latestFailedCoverTask ? (
              <Button
                type="button"
                variant="ghost"
                className="shrink-0 text-muted-foreground"
                disabled={dismissCoverHistoryMutation.isPending}
                onClick={() => dismissCoverHistoryMutation.mutate(latestFailedCoverTask.id)}
              >
                {dismissCoverHistoryMutation.isPending ? "收起中..." : "收起这次失败提醒"}
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="shrink-0" onClick={() => setOpen(true)}>
              {assets.length > 0 ? "管理封面图库" : "生成封面主画面"}
            </Button>
          </div>
        </div>

        {latestFailedCoverTask ? (
          <div className="text-sm leading-6 text-muted-foreground">
            最近一次封面生成没有成功。可以继续重试，也可以收起这次失败提醒。收起后，运行记录里这条失败提醒会消失，已有封面不会被删除。
            {latestFailedCoverTask.error ? ` 原因：${latestFailedCoverTask.error}` : ""}
          </div>
        ) : null}

        {assetsQuery.isLoading ? (
          <div className="py-5 text-sm text-muted-foreground">
            正在读取当前封面图库...
          </div>
        ) : null}

        {!assetsQuery.isLoading && !primaryAsset ? (
          <div className="py-5 text-sm leading-6 text-muted-foreground">
            还没有封面主画面。点击上方按钮，系统会先根据当前小说信息整理一版封面输入草稿。
          </div>
        ) : null}

        {primaryAsset ? (
          <div className="grid gap-4 lg:grid-cols-[220px,1fr]">
            <div className="overflow-hidden rounded-lg bg-muted/20">
              <div className="aspect-[2/3] w-full">
                <img
                  src={resolveImageAssetUrl(primaryAsset.url)}
                  alt={`${props.basicForm.title || "小说"}当前封面`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  当前主封面
                </span>
                <span className="text-xs text-muted-foreground">共 {assets.length} 张候选图</span>
              </div>

              <div className="text-sm leading-6 text-muted-foreground">
                主封面会随图片域里的 `isPrimary` 切换，不会把封面状态写死到小说主表里。
              </div>

              {assets.length > 1 ? (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                  {assets.slice(0, 6).map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      className="overflow-hidden rounded-lg bg-muted/15 opacity-80 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      onClick={() => setOpen(true)}
                      title="打开封面图库"
                    >
                      <div className="aspect-[2/3] w-full">
                        <img
                          src={resolveImageAssetUrl(asset.url)}
                          alt={`${props.basicForm.title || "小说"}封面候选图`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <NovelCoverDialog
        open={open}
        novelId={props.novelId}
        basicForm={props.basicForm}
        genreOptions={props.genreOptions}
        storyModeOptions={props.storyModeOptions}
        worldOptions={props.worldOptions}
        worldSliceView={props.worldSliceView}
        onOpenChange={setOpen}
      />
    </>
  );
}
