import type { SSEFrame } from "@write-now/shared/types/api";
import type { LLMProvider } from "@write-now/shared/types/llm";
import type {
  AuditReport,
  BaseCharacter,
  Chapter,
  Character,
  CharacterTimeline,
  CharacterVisibleProfileBatchResult,
  CharacterVisibleProfileSuggestion,
  NovelBible,
  PipelineJob,
  PlotBeat,
  QualityScore,
  ReplanResult,
  StoryPlan,
  StoryStateSnapshot,
  SupplementalCharacterCandidate,
  SupplementalCharacterGenerateInput,
  SupplementalCharacterGenerationResult,
} from "@write-now/shared/types/novel";
import type { ChapterRuntimePackage } from "@write-now/shared/types/chapterRuntime";
import type {
  CharacterResourceContext,
  CharacterResourceLedgerItem,
  CharacterResourceProposalSummary,
} from "@write-now/shared/types/characterResource";
import type { ChapterExecutionBackgroundActivity } from "./components/chapterExecution.shared";
import type {
  ChapterTabViewProps,
  CharacterTabViewProps,
  PipelineTabViewProps,
} from "./components/NovelEditView.types";
import type { ChapterReviewResult } from "./chapterPlanning.shared";
import type { ChapterExecutionStrategy } from "./chapterExecution.utils";
import type { QuickCharacterCreatePayload } from "./components/characterPanel.utils";

type PipelineFormState = PipelineTabViewProps["pipelineForm"];
type CharacterFormState = CharacterTabViewProps["characterForm"];
type QuickCharacterFormState = CharacterTabViewProps["quickCharacterForm"];
type ChapterStrategyField = Parameters<ChapterTabViewProps["onStrategyChange"]>[0];
type PipelineFormField = Parameters<PipelineTabViewProps["onPipelineFormChange"]>[0];
type CharacterFormField = Parameters<CharacterTabViewProps["onCharacterFormChange"]>[0];

interface MutationLike<TVariables = void, TData = unknown> {
  mutate(variables?: TVariables): void;
  mutateAsync(variables?: TVariables): Promise<{ data?: TData; message?: string }>;
  isPending: boolean;
  variables?: TVariables;
  data?: { data?: TData } | null;
}

interface QueryLike<TData> {
  isLoading: boolean;
  isFetching: boolean;
  data?: { data?: TData } | null;
}

interface StreamLike {
  start: (url: string, payload?: Record<string, unknown>) => void | Promise<void>;
  abort: () => void;
  isStreaming: boolean;
  content: string;
  latestRun?: Extract<SSEFrame, { type: "run_status" }> | null;
  runtimePackage?: ChapterRuntimePackage | null;
}

interface ChapterExecutionActionsLike {
  applyStrategy: () => void;
  isPatchingChapter: boolean;
  rewriteChapter: () => void;
  expandChapter: () => void;
  compressChapter: () => void;
  summarizeChapter: () => void;
  generateTaskSheet: () => void;
  generateSceneCards: () => void;
  checkContinuity: () => void;
  checkCharacterConsistency: () => void;
  checkPacing: () => void;
  autoRepair: () => void;
  strengthenConflict: () => void;
  enhanceEmotion: () => void;
  unifyStyle: () => void;
  addDialogue: () => void;
  addDescription: () => void;
  isGeneratingTaskSheet: boolean;
  isGeneratingSceneCards: boolean;
  isSummarizingChapter: boolean;
  repairActionKind?: ChapterTabViewProps["repairActionKind"];
  generationActionKind?: ChapterTabViewProps["generationActionKind"];
}

interface BuildNovelEditExecutionTabsInput {
  id: string;
  worldInjectionSummary: string | null;
  hasCharacters: boolean;
  chapters: Chapter[];
  characters: Character[];
  selectedChapterId: string;
  selectedChapter?: Chapter;
  setSelectedChapterId: (chapterId: string) => void;
  goToCharacterTab: () => void;
  createChapterMutation: MutationLike;
  deleteManualChapterMutation: MutationLike<string>;
  chapterOperationMessage: string;
  chapterStrategy: ChapterExecutionStrategy;
  setChapterStrategy: (updater: (prev: ChapterExecutionStrategy) => ChapterExecutionStrategy) => void;
  chapterExecutionActions: ChapterExecutionActionsLike;
  handleGenerateSelectedChapter: () => void;
  generateChapterPlanMutation: MutationLike;
  replanChapterMutation: MutationLike<void, ReplanResult>;
  runChapterReview: (kind: NonNullable<ChapterTabViewProps["reviewActionKind"]>) => void;
  reviewActionKind?: ChapterTabViewProps["reviewActionKind"];
  fullAuditMutation: MutationLike;
  repairSSE: StreamLike;
  reviewResult: ChapterReviewResult | null;
  chapterPlan?: StoryPlan | null;
  latestStateSnapshot?: StoryStateSnapshot | null;
  chapterStateSnapshot?: StoryStateSnapshot | null;
  chapterTimeline?: ChapterTabViewProps["chapterTimeline"];
  chapterTimelineQuery: QueryLike<unknown>;
  chapterResourceContext?: CharacterResourceContext | null;
  chapterResourceContextQuery: QueryLike<unknown>;
  activeDirectorSession?: unknown;
  chapterPendingCharacterResourceProposals?: CharacterResourceProposalSummary[];
  extractChapterResourcesMutation: MutationLike;
  confirmCharacterResourceProposalMutation: MutationLike<string>;
  rejectCharacterResourceProposalMutation: MutationLike<string>;
  chapterAuditReports: AuditReport[];
  pipelineBackgroundActivities?: ChapterExecutionBackgroundActivity[];
  chapterQualityReport?: ChapterTabViewProps["chapterQualityReport"];
  chapterSSE: StreamLike;
  activeRepairStream?: { chapterId: string; chapterLabel: string } | null;
  handleAbortRepair: () => void;
  activeChapterStream?: { chapterId: string; chapterLabel: string } | null;
  handleAbortChapterStream: () => void;
  pipelineForm: PipelineFormState;
  setPipelineForm: (updater: (prev: PipelineFormState) => PipelineFormState) => void;
  maxOrder: number;
  bibleSSE: StreamLike;
  llm: { provider?: LLMProvider; model?: string };
  beatsSSE: StreamLike;
  runPipelineMutation: MutationLike<Partial<PipelineFormState>>;
  pipelineMessage: string;
  pipelineJobQuery: QueryLike<PipelineJob>;
  reviewMutation: MutationLike;
  setRepairBeforeContent: (content: string) => void;
  setRepairAfterContent: (content: string) => void;
  setActiveRepairStream: (stream: { chapterId: string; chapterLabel: string } | null) => void;
  openAuditIssueIds: string[];
  hookMutation: MutationLike;
  repairBeforeContent: string;
  repairAfterContent: string;
  qualitySummary?: QualityScore;
  qualityReportQuery: QueryLike<{ chapterReports?: PipelineTabViewProps["chapterReports"] }>;
  bible?: NovelBible | null;
  plotBeats: PlotBeat[];
  characterMessage: string;
  quickCharacterForm: QuickCharacterFormState;
  setQuickCharacterForm: (updater: (prev: QuickCharacterFormState) => QuickCharacterFormState) => void;
  quickCreateCharacterMutation: MutationLike<QuickCharacterCreatePayload>;
  generateSupplementalCharacterMutation: MutationLike<SupplementalCharacterGenerateInput, SupplementalCharacterGenerationResult>;
  applySupplementalCharacterMutation: MutationLike<SupplementalCharacterCandidate, { character?: Character; relationCount?: number }>;
  coreCharacterCount: number;
  baseCharacters: BaseCharacter[];
  selectedBaseCharacterId: string;
  setSelectedBaseCharacterId: (id: string) => void;
  selectedBaseCharacter?: BaseCharacter;
  importedBaseCharacterIds: Set<string>;
  importBaseCharacterMutation: MutationLike;
  selectedCharacterId: string;
  setSelectedCharacterId: (id: string) => void;
  deleteCharacterMutation: MutationLike<string>;
  syncTimelineMutation: MutationLike;
  syncAllTimelineMutation: MutationLike;
  evolveCharacterMutation: MutationLike;
  generateVisibleProfileMutation: MutationLike<string, CharacterVisibleProfileSuggestion>;
  applyVisibleProfileMutation: MutationLike;
  generateBatchVisibleProfilesMutation: MutationLike<string, CharacterVisibleProfileBatchResult>;
  applyBatchVisibleProfilesMutation: MutationLike;
  worldCheckMutation: MutationLike;
  selectedCharacter?: Character;
  characterResources?: CharacterResourceLedgerItem[];
  pendingCharacterResourceProposals: CharacterResourceProposalSummary[];
  backfillCharacterResourcesMutation: MutationLike;
  characterForm: CharacterFormState;
  setCharacterForm: (updater: (prev: CharacterFormState) => CharacterFormState) => void;
  saveCharacterMutation: MutationLike;
  characterTimelineQuery: QueryLike<CharacterTimeline[]>;
}

export function buildNovelEditExecutionTabs(ctx: BuildNovelEditExecutionTabsInput) {
  const {
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
  } = ctx;
  const chapterTab: ChapterTabViewProps = {
    novelId: id,
    worldInjectionSummary,
    hasCharacters,
    chapters,
    selectedChapterId,
    selectedChapter,
    onSelectChapter: setSelectedChapterId,
    onGoToCharacterTab: goToCharacterTab,
    onCreateChapter: () => createChapterMutation.mutate(),
    isCreatingChapter: createChapterMutation.isPending,
    onRemoveChapter: (chapter: Chapter) => {
      const confirmed = window.confirm(`确认移除「第${chapter.order}章 ${chapter.title || "未命名章节"}」吗？该章节尚未开始写作，移除后不可恢复。`);
      if (confirmed) {
        deleteManualChapterMutation.mutate(chapter.id);
      }
    },
    removingChapterId: deleteManualChapterMutation.isPending
      ? deleteManualChapterMutation.variables ?? null
      : null,
    chapterOperationMessage,
    strategy: chapterStrategy,
    onStrategyChange: (field: ChapterStrategyField, value: string | number) =>
      setChapterStrategy((prev) => ({ ...prev, [field]: value })),
    onApplyStrategy: chapterExecutionActions.applyStrategy,
    isApplyingStrategy: chapterExecutionActions.isPatchingChapter,
    onGenerateSelectedChapter: handleGenerateSelectedChapter,
    onRewriteChapter: chapterExecutionActions.rewriteChapter,
    onExpandChapter: chapterExecutionActions.expandChapter,
    onCompressChapter: chapterExecutionActions.compressChapter,
    onSummarizeChapter: chapterExecutionActions.summarizeChapter,
    onGenerateTaskSheet: chapterExecutionActions.generateTaskSheet,
    onGenerateSceneCards: chapterExecutionActions.generateSceneCards,
    onGenerateChapterPlan: () => generateChapterPlanMutation.mutate(),
    onReplanChapter: () => replanChapterMutation.mutate(),
    onRunFullAudit: () => runChapterReview("full_audit"),
    onCheckContinuity: chapterExecutionActions.checkContinuity,
    onCheckCharacterConsistency: chapterExecutionActions.checkCharacterConsistency,
    onCheckPacing: chapterExecutionActions.checkPacing,
    onAutoRepair: chapterExecutionActions.autoRepair,
    onStrengthenConflict: chapterExecutionActions.strengthenConflict,
    onEnhanceEmotion: chapterExecutionActions.enhanceEmotion,
    onUnifyStyle: chapterExecutionActions.unifyStyle,
    onAddDialogue: chapterExecutionActions.addDialogue,
    onAddDescription: chapterExecutionActions.addDescription,
    isGeneratingTaskSheet: chapterExecutionActions.isGeneratingTaskSheet,
    isGeneratingSceneCards: chapterExecutionActions.isGeneratingSceneCards,
    isSummarizingChapter: chapterExecutionActions.isSummarizingChapter,
    reviewActionKind,
    repairActionKind: chapterExecutionActions.repairActionKind,
    generationActionKind: chapterExecutionActions.generationActionKind,
    isReviewingChapter: fullAuditMutation.isPending,
    isRepairingChapter: repairSSE.isStreaming,
    reviewResult,
    replanRecommendation: reviewResult?.replanRecommendation ?? null,
    lastReplanResult: replanChapterMutation.data?.data ?? null,
    chapterPlan,
    latestStateSnapshot,
    chapterStateSnapshot,
    chapterTimeline,
    isLoadingChapterTimeline: chapterTimelineQuery.isLoading || chapterTimelineQuery.isFetching,
    chapterResourceContext,
    isLoadingChapterResourceContext: chapterResourceContextQuery.isLoading || chapterResourceContextQuery.isFetching,
    resourceWorkflowMode: activeDirectorSession ? ("auto_director" as const) : ("manual" as const),
    pendingCharacterResourceProposals: chapterPendingCharacterResourceProposals,
    onExtractChapterResources: () => extractChapterResourcesMutation.mutate(),
    isExtractingChapterResources: extractChapterResourcesMutation.isPending,
    onConfirmCharacterResourceProposal: (proposalId: string) => confirmCharacterResourceProposalMutation.mutate(proposalId),
    onRejectCharacterResourceProposal: (proposalId: string) => rejectCharacterResourceProposalMutation.mutate(proposalId),
    confirmingCharacterResourceProposalId: confirmCharacterResourceProposalMutation.isPending
      ? confirmCharacterResourceProposalMutation.variables ?? ""
      : "",
    rejectingCharacterResourceProposalId: rejectCharacterResourceProposalMutation.isPending
      ? rejectCharacterResourceProposalMutation.variables ?? ""
      : "",
    chapterAuditReports,
    backgroundSyncActivities: pipelineBackgroundActivities,
    isGeneratingChapterPlan: generateChapterPlanMutation.isPending,
    isReplanningChapter: replanChapterMutation.isPending,
    isRunningFullAudit: fullAuditMutation.isPending && reviewActionKind === "full_audit",
    chapterQualityReport,
    chapterRuntimePackage: chapterSSE.runtimePackage,
    repairStreamContent: repairSSE.content,
    isRepairStreaming: repairSSE.isStreaming,
    repairStreamingChapterId: activeRepairStream?.chapterId ?? null,
    repairStreamingChapterLabel: activeRepairStream?.chapterLabel ?? null,
    repairRunStatus: repairSSE.latestRun,
    onAbortRepair: handleAbortRepair,
    streamContent: chapterSSE.content,
    isStreaming: chapterSSE.isStreaming,
    streamingChapterId: activeChapterStream?.chapterId ?? null,
    streamingChapterLabel: activeChapterStream?.chapterLabel ?? null,
    chapterRunStatus: chapterSSE.latestRun,
    onAbortStream: handleAbortChapterStream,
    directorTakeoverEntry: undefined,
  };
  const pipelineTab: PipelineTabViewProps = {
    novelId: id,
    worldInjectionSummary,
    hasCharacters,
    onGoToCharacterTab: goToCharacterTab,
    pipelineForm,
    onPipelineFormChange: (field: PipelineFormField, value: number | boolean | string) =>
      setPipelineForm((prev) => ({ ...prev, [field]: value })),
    maxOrder,
    onGenerateBible: () => void bibleSSE.start(`/novels/${id}/bible/generate`, {
      provider: llm.provider,
      model: llm.model,
      temperature: 0.6,
    }),
    onAbortBible: bibleSSE.abort,
    isBibleStreaming: bibleSSE.isStreaming,
    bibleStreamContent: bibleSSE.content,
    onGenerateBeats: () => void beatsSSE.start(`/novels/${id}/beats/generate`, {
      provider: llm.provider,
      model: llm.model,
      targetChapters: pipelineForm.endOrder,
    }),
    onAbortBeats: beatsSSE.abort,
    isBeatsStreaming: beatsSSE.isStreaming,
    beatsStreamContent: beatsSSE.content,
    onRunPipeline: (patch?: Partial<PipelineFormState>) => runPipelineMutation.mutate(patch ?? {}),
    isRunningPipeline: runPipelineMutation.isPending,
    pipelineMessage,
    pipelineJob: pipelineJobQuery.data?.data,
    chapters,
    selectedChapterId,
    onSelectedChapterChange: setSelectedChapterId,
    onReviewChapter: () => reviewMutation.mutate(),
    isReviewing: reviewMutation.isPending,
    onRepairChapter: () => {
      setRepairBeforeContent(selectedChapter?.content ?? "");
      setRepairAfterContent("");
      setActiveRepairStream(selectedChapter
        ? { chapterId: selectedChapter.id, chapterLabel: `第${selectedChapter.order}章 ${selectedChapter.title || "未命名章节"}` }
        : null);
      void repairSSE.start(`/novels/${id}/chapters/${selectedChapterId}/repair`, {
        provider: llm.provider,
        model: llm.model,
        reviewIssues: reviewResult?.issues ?? [],
        auditIssueIds: openAuditIssueIds,
      });
    },
    isRepairing: repairSSE.isStreaming,
    onGenerateHook: () => hookMutation.mutate(),
    isGeneratingHook: hookMutation.isPending,
    reviewResult,
    repairBeforeContent,
    repairAfterContent,
    repairStreamContent: repairSSE.content,
    isRepairStreaming: repairSSE.isStreaming,
    onAbortRepair: handleAbortRepair,
    qualitySummary,
    chapterReports: qualityReportQuery.data?.data?.chapterReports ?? [],
    bible,
    plotBeats,
  };
  const characterTab: CharacterTabViewProps = {
    novelId: id,
    llmProvider: llm.provider,
    llmModel: llm.model,
    characterMessage,
    quickCharacterForm,
    onQuickCharacterFormChange: (field: "name" | "role", value: string) =>
      setQuickCharacterForm((prev: QuickCharacterFormState) => ({ ...prev, [field]: value })),
    onQuickCreateCharacter: (payload: QuickCharacterCreatePayload) => quickCreateCharacterMutation.mutate(payload),
    isQuickCreating: quickCreateCharacterMutation.isPending,
    onGenerateSupplementalCharacters: generateSupplementalCharacterMutation.mutateAsync,
    isGeneratingSupplementalCharacters: generateSupplementalCharacterMutation.isPending,
    onApplySupplementalCharacter: applySupplementalCharacterMutation.mutateAsync,
    isApplyingSupplementalCharacter: applySupplementalCharacterMutation.isPending,
    characters,
    coreCharacterCount,
    baseCharacters,
    selectedBaseCharacterId,
    onSelectedBaseCharacterChange: setSelectedBaseCharacterId,
    selectedBaseCharacter,
    importedBaseCharacterIds,
    onImportBaseCharacter: () => importBaseCharacterMutation.mutate(),
    isImportingBaseCharacter: importBaseCharacterMutation.isPending,
    selectedCharacterId,
    onSelectedCharacterChange: setSelectedCharacterId,
    onDeleteCharacter: (characterId: string) => deleteCharacterMutation.mutate(characterId),
    isDeletingCharacter: deleteCharacterMutation.isPending,
    deletingCharacterId: deleteCharacterMutation.variables ?? "",
    onSyncTimeline: () => syncTimelineMutation.mutate(),
    isSyncingTimeline: syncTimelineMutation.isPending,
    onSyncAllTimeline: () => syncAllTimelineMutation.mutate(),
    isSyncingAllTimeline: syncAllTimelineMutation.isPending,
    onEvolveCharacter: () => evolveCharacterMutation.mutate(),
    isEvolvingCharacter: evolveCharacterMutation.isPending,
    onGenerateVisibleProfile: (userGuidance?: string) => generateVisibleProfileMutation.mutate(userGuidance),
    isGeneratingVisibleProfile: generateVisibleProfileMutation.isPending,
    visibleProfileSuggestion: generateVisibleProfileMutation.data?.data ?? null,
    onApplyVisibleProfile: () => applyVisibleProfileMutation.mutate(),
    isApplyingVisibleProfile: applyVisibleProfileMutation.isPending,
    onGenerateBatchVisibleProfiles: (userGuidance?: string) => generateBatchVisibleProfilesMutation.mutate(userGuidance),
    isGeneratingBatchVisibleProfiles: generateBatchVisibleProfilesMutation.isPending,
    batchVisibleProfileResult: generateBatchVisibleProfilesMutation.data?.data ?? null,
    onApplyBatchVisibleProfiles: () => applyBatchVisibleProfilesMutation.mutate(),
    isApplyingBatchVisibleProfiles: applyBatchVisibleProfilesMutation.isPending,
    onWorldCheck: () => worldCheckMutation.mutate(),
    isCheckingWorld: worldCheckMutation.isPending,
    selectedCharacter,
    characterResources,
    pendingCharacterResourceCount: pendingCharacterResourceProposals.length,
    onBackfillCharacterResources: () => backfillCharacterResourcesMutation.mutate(),
    isBackfillingCharacterResources: backfillCharacterResourcesMutation.isPending,
    characterForm,
    onCharacterFormChange: (field: CharacterFormField, value: string) =>
      setCharacterForm((prev) => ({ ...prev, [field]: value })),
    onSaveCharacter: () => saveCharacterMutation.mutate(),
    isSavingCharacter: saveCharacterMutation.isPending,
    timelineEvents: characterTimelineQuery.data?.data ?? [],
  };


  return { chapterTab, pipelineTab, characterTab };
}
