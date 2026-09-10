import type { UnifiedTaskDetail } from "@write-now/shared/types/task";
import type { DirectorBookAutomationProjection } from "@write-now/shared/types/directorRuntime";
import type { NovelBasicFormState } from "./novelBasicInfo.shared";
import NovelExistingProjectTakeoverDialog from "./components/NovelExistingProjectTakeoverDialog";
import { resolveTakeoverDialogContextTaskId } from "./novelEditAutomationStatus";

export type NovelEditTakeoverStep =
  | "basic"
  | "story_macro"
  | "world"
  | "character"
  | "outline"
  | "structured"
  | "chapter"
  | "pipeline";

export function renderNovelEditTakeoverEntry(input: {
  novelId: string;
  basicForm: NovelBasicFormState;
  directorTaskId: string;
  activeAutoDirectorTask: UnifiedTaskDetail | null;
  bookAutomationProjection: DirectorBookAutomationProjection | null;
  step: NovelEditTakeoverStep;
  variant?: "default" | "outline" | "secondary";
}) {
  const takeoverContextTaskId = resolveTakeoverDialogContextTaskId({
    directorTaskId: input.directorTaskId,
    activeAutoDirectorTask: input.activeAutoDirectorTask,
    projection: input.bookAutomationProjection,
  });
  return (
    <NovelExistingProjectTakeoverDialog
      novelId={input.novelId}
      basicForm={input.basicForm}
      triggerVariant={input.variant ?? "default"}
      defaultEntryStep={input.step}
      workflowTaskId={takeoverContextTaskId}
    />
  );
}

export function resolveActiveTakeoverStep(activeTab: string): NovelEditTakeoverStep {
  if (activeTab === "story_macro") return "story_macro";
  if (activeTab === "world") return "world";
  if (activeTab === "character") return "character";
  if (activeTab === "outline") return "outline";
  if (activeTab === "structured") return "structured";
  if (activeTab === "chapter") return "chapter";
  if (activeTab === "pipeline") return "pipeline";
  return "basic";
}
