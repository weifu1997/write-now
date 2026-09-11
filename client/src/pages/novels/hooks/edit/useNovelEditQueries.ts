import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/api/queryKeys";
import {
  getChapterAuditReports,
  getChapterPlan,
  getChapterResourceContext,
  getChapterStateSnapshot,
  getChapterTimeline,
  getLatestStateSnapshot,
  getNovelCharacterResources,
  getNovelDetail,
  getNovelPayoffLedger,
  getNovelQualityReport,
  getNovelVolumeWorkspace,
} from "@/api/novel";
import { getActiveAutoDirectorTask } from "@/api/novelWorkflow";
import { getDirectorBookAutomationProjection } from "@/api/novelDirector";
import { getBaseCharacterList } from "@/api/character";
import { getWorldList } from "@/api/world";
import { flattenGenreTreeOptions, getGenreTree } from "@/api/genre";
import { flattenStoryModeTreeOptions, getStoryModeTree } from "@/api/storyMode";
import type { ExistingOutlineChapter } from "../../volumePlan.utils";

export interface UseNovelEditQueriesInput {
  id: string;
  activeTab: string;
  selectedChapterId?: string;
  selectedCharacterId?: string;
  selectedBaseCharacterId?: string;
}

export function useNovelEditQueries(input: UseNovelEditQueriesInput) {
  const {
    id,
    activeTab,
    selectedChapterId = "",
    selectedCharacterId = "",
    selectedBaseCharacterId = "",
  } = input;

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

  const genreOptions = useMemo(
    () => flattenGenreTreeOptions(genreTreeQuery.data?.data ?? []),
    [genreTreeQuery.data?.data],
  );

  const storyModeOptions = useMemo(
    () => flattenStoryModeTreeOptions(storyModeTreeQuery.data?.data ?? []),
    [storyModeTreeQuery.data?.data],
  );

  const chapters = useMemo(
    () => novelDetailQuery.data?.data?.chapters ?? [],
    [novelDetailQuery.data?.data?.chapters],
  );

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

  return {
    shouldLoadVolumeWorkspace,
    shouldLoadStoryMacro,
    shouldLoadWorldSlice,
    shouldLoadQualityReport,
    shouldLoadLatestState,
    shouldLoadPayoffLedger,
    shouldLoadCharacterResources,
    shouldLoadChapterContext,
    shouldLoadChapterTimeline,
    novelDetailQuery,
    qualityReportQuery,
    volumeWorkspaceQuery,
    latestStateSnapshotQuery,
    chapterStateSnapshotQuery,
    payoffLedgerChapterOrder,
    payoffLedgerQuery,
    characterResourcesQuery,
    chapterResourceContextQuery,
    chapterTimelineQuery,
    activeAutoDirectorTaskQuery,
    bookAutomationQuery,
    chapterPlanQuery,
    chapterAuditReportsQuery,
    baseCharacterListQuery,
    worldListQuery,
    genreTreeQuery,
    storyModeTreeQuery,
    genreOptions,
    storyModeOptions,
    chapters,
    outlineSyncChapters,
    selectedChapter,
    characters,
    baseCharacters,
    selectedCharacter,
    selectedBaseCharacter,
    importedBaseCharacterIds,
    hasCharacters,
    savedVolumeWorkspace,
  };
}
