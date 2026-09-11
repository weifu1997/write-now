import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Smile,
  Sparkles,
  Upload,
  User,
  Users,
  Wand2,
} from "lucide-react";
import {
  characterExpressionImageUrl,
  characterSheetImageUrl,
  prepareCharacterExpressionSheet,
  prepareCharacterSheet,
  generateCharacterExpressionSheet,
  generateCharacterSheet,
  updateCharacterGender,
  type ComicCharacterGender,
  type CharacterExpressionData,
  type GenerateCharacterSheetOptions,
  type CharacterSheetData,
  type ComicCharacter,
} from "@/api/comic";
import { ImageGenerationConfirmDialog } from "@/components/image/ImageGenerationConfirmDialog";
import { useImageGenerationFlow } from "@/components/image/useImageGenerationFlow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { GeneratedImageCard } from "@/components/comic/GeneratedImageCard";
import SelectControl from "@/components/common/SelectControl";
import {
  AssetSection,
  FactsSection,
  VisualAnchorEditor,
  buildRecommendedSheetPrompt,
  getExpressionData,
  getVisualAnchorText,
  parseSheetData,
} from "./characters";

function CharacterStatusBadges({
  sheetData,
  expressionData,
}: {
  sheetData: CharacterSheetData;
  expressionData: CharacterExpressionData;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={sheetData.status === "done" ? "default" : "secondary"} className="text-[11px]">
        三视图{sheetData.status === "done" ? ` v${sheetData.version ?? 1}` : "待生成"}
      </Badge>
      <Badge variant={expressionData.status === "done" ? "default" : "secondary"} className="text-[11px]">
        表情稿{expressionData.status === "done" ? ` v${expressionData.version ?? 1}` : "待生成"}
      </Badge>
    </div>
  );
}

function CharacterList({
  characters,
  selectedCharacterId,
  onSelect,
}: {
  characters: ComicCharacter[];
  selectedCharacterId: string;
  onSelect: (characterId: string) => void;
}) {
  return (
    <aside className="overflow-hidden rounded-lg border bg-background">
      <div className="border-b px-3 py-3">
        <p className="text-sm font-semibold">角色列表</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{characters.length} 个角色</p>
      </div>
      <div className="max-h-[720px] overflow-y-auto p-2">
        <div className="space-y-1">
          {characters.map((character) => {
            const sheetData = parseSheetData(character);
            const expressionData = getExpressionData(sheetData);
            const isSelected = character.id === selectedCharacterId;
            const hasSheet = sheetData.status === "done";

            return (
              <button
                key={character.id}
                type="button"
                className={[
                  "group w-full rounded-md border px-3 py-2 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected ? "border-primary bg-primary/10" : "border-transparent hover:border-border hover:bg-muted/60",
                ].join(" ")}
                onClick={() => onSelect(character.id)}
              >
                <div className="flex items-start gap-2">
                  <div
                    className={[
                      "relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border",
                      isSelected ? "border-primary/30 bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    ].join(" ")}
                  >
                    <User className="h-4 w-4" />
                    {hasSheet && (
                      <img
                        src={characterSheetImageUrl(character.id)}
                        alt={`${character.name} 头像`}
                        className="absolute inset-0 h-full w-full object-cover object-left"
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{character.name}</p>
                      {hasSheet && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">v{sheetData.version ?? 1}</span>
                      )}
                    </div>
                    {character.persona && (
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {character.persona}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className={hasSheet ? "text-primary" : ""}>三视图</span>
                      <span className="text-border">/</span>
                      <span className={expressionData.status === "done" ? "text-primary" : ""}>表情稿</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

// ─── Gender Selector ──────────────────────────────────────────────────────────
// 角色性别是所有生图链路（三视图/表情稿/资产/格子图）的 GENDER LOCK 来源。
// 古风/韩漫语境里"鹅蛋脸/桃花眼"等描述男女通用，必须显式声明性别，否则模型偏向韩漫美男。

const GENDER_LABELS: Record<ComicCharacterGender, string> = {
  unknown: "未指定",
  male: "男",
  female: "女",
  other: "中性",
};

const GENDER_BADGE_STYLE: Record<ComicCharacterGender, string> = {
  unknown: "border-border bg-muted text-muted-foreground",
  male: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-300",
  female: "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-700 dark:bg-pink-900/20 dark:text-pink-300",
  other: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-300",
};

function GenderSelector({ character }: { character: ComicCharacter }) {
  const queryClient = useQueryClient();
  const current = (character.gender ?? "unknown") as ComicCharacterGender;

  const mut = useMutation({
    mutationFn: (g: ComicCharacterGender) => updateCharacterGender(character.id, g),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comic", "project"] });
      toast.success("性别已更新，下次生图生效");
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    <div className="flex items-center gap-1">
      <SelectControl
        className={`rounded border px-1.5 py-0.5 text-[11px] leading-tight ${GENDER_BADGE_STYLE[current]} disabled:opacity-50`}
        value={current}
        disabled={mut.isPending}
        title="角色性别（GENDER LOCK）：避免生图把女画成男或反之"
        onChange={(e) => mut.mutate(e.target.value as ComicCharacterGender)}
      >
        {(Object.keys(GENDER_LABELS) as ComicCharacterGender[]).map((g) => (
          <option key={g} value={g}>{GENDER_LABELS[g]}</option>
        ))}
      </SelectControl>
    </div>
  );
}

// ─── Character Detail ─────────────────────────────────────────────────────────

function CharacterDetail({
  character,
  provider,
}: {
  character: ComicCharacter;
  provider: string;
}) {
  const queryClient = useQueryClient();
  const [showSheetTuning, setShowSheetTuning] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [useCurrentImageAsReference, setUseCurrentImageAsReference] = useState(true);
  const [lockAppearance, setLockAppearance] = useState(true);
  const [appearanceOverride, setAppearanceOverride] = useState("");

  const sheetData = parseSheetData(character);
  const expressionData = getExpressionData(sheetData);
  const visualAnchorText = getVisualAnchorText(character);
  const recommendedSheetPrompt = buildRecommendedSheetPrompt(character);
  const hasSheet = sheetData.status === "done";
  const sheetFlow = useImageGenerationFlow();
  const expressionFlow = useImageGenerationFlow();

  const startSheetGeneration = (options?: GenerateCharacterSheetOptions) => {
    sheetFlow.start({
      prepare: () => prepareCharacterSheet(character.id, provider || undefined, options),
      generate: (overrides) => generateCharacterSheet(character.id, provider || undefined, options, overrides),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["comic", "project"] });
        toast.success(`${character.name} 设计稿生成完成`);
        setShowSheetTuning(false);
      },
    });
  };

  const startExpressionGeneration = () => {
    expressionFlow.start({
      prepare: () => prepareCharacterExpressionSheet(character.id, provider || undefined),
      generate: (overrides) => generateCharacterExpressionSheet(character.id, provider || undefined, overrides),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["comic", "project"] });
        toast.success(`${character.name} 表情稿生成完成`);
      },
    });
  };

  const isGenerating = sheetFlow.dialogProps.loading || sheetFlow.dialogProps.submitting || sheetData.status === "generating";
  const isExpressionGenerating = expressionFlow.dialogProps.loading || expressionFlow.dialogProps.submitting || expressionData.status === "generating";

  const openSheetTuning = () => {
    setDraftPrompt(sheetData.prompt?.trim() || recommendedSheetPrompt);
    setUseCurrentImageAsReference(true);
    setLockAppearance(true);
    setAppearanceOverride(visualAnchorText);
    setShowSheetTuning(true);
  };

  return (
    <>
      <ImageGenerationConfirmDialog {...sheetFlow.dialogProps} />
      <ImageGenerationConfirmDialog {...expressionFlow.dialogProps} />
      <section className="min-w-0 overflow-hidden rounded-lg border bg-background">
      <div className="flex flex-col gap-3 border-b px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="truncate text-lg font-semibold">{character.name}</h2>
            <GenderSelector character={character} />
          </div>
          {character.persona && (
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">{character.persona}</p>
          )}
        </div>
        <CharacterStatusBadges sheetData={sheetData} expressionData={expressionData} />
      </div>

      <div className="grid min-h-[560px] lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
          <div className="border-b px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">三视图主设计稿</p>
                <p className="mt-0.5 text-xs text-muted-foreground">正面、侧面、背面和面部特写用于锁定角色外观。</p>
              </div>
              {hasSheet && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isGenerating || showSheetTuning}
                  onClick={openSheetTuning}
                >
                  <Wand2 className="h-4 w-4" />
                  调整三视图
                </Button>
              )}
            </div>
          </div>

          <div className="flex min-h-[360px] items-center justify-center bg-muted/30 p-4">
            {hasSheet ? (
              <img
                src={characterSheetImageUrl(character.id)}
                alt={`${character.name} 设计稿`}
                className="max-h-[520px] w-full rounded-md object-contain"
              />
            ) : isGenerating ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm">三视图生成中</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <ImageIcon className="h-10 w-10 opacity-40" />
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">还没有三视图</p>
                  <p className="mt-1 text-xs">先生成主设计稿，再继续制作表情稿和格子图参考。</p>
                </div>
                <Button type="button" size="sm" disabled={isGenerating} onClick={() => startSheetGeneration(undefined)}>
                  <Sparkles className="h-4 w-4" />
                  生成三视图
                </Button>
              </div>
            )}
          </div>

          {sheetData.status === "error" && (
            <div className="border-t bg-destructive/10 px-4 py-3 text-xs text-destructive">{sheetData.error}</div>
          )}

          <div className="border-t px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">表情设计稿</p>
                <p className="mt-0.5 text-xs text-muted-foreground">常用表情会在分格生成时作为情绪参考。</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={expressionData.status === "done" ? "outline" : "secondary"}
                disabled={!hasSheet || isExpressionGenerating}
                onClick={startExpressionGeneration}
              >
                {isExpressionGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    生成中
                  </>
                ) : expressionData.status === "done" ? (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    更新表情稿
                  </>
                ) : (
                  <>
                    <Smile className="h-4 w-4" />
                    生成表情稿
                  </>
                )}
              </Button>
            </div>
            {expressionData.status === "done" ? (
              <div className="overflow-hidden rounded-md border bg-muted">
                <img
                  src={characterExpressionImageUrl(character.id)}
                  alt={`${character.name} 表情稿`}
                  className="max-h-56 w-full object-contain"
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
                {expressionData.status === "error"
                  ? expressionData.error ?? "表情稿生成失败"
                  : "生成三视图后，可继续生成 6 个核心表情。"}
              </div>
            )}
          </div>
        </div>

        <aside className="min-w-0">
          <VisualAnchorEditor character={character} />


          <div className="border-b px-4 py-3">
            <p className="text-sm font-medium">三视图提示词</p>
            <div className="mt-2 max-h-48 overflow-y-auto rounded-md border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {sheetData.prompt || recommendedSheetPrompt}
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">三视图微调</p>
                <p className="mt-0.5 text-xs text-muted-foreground">编辑提示词后重新生成，成功后替换当前主设计稿。</p>
              </div>
            </div>

            {hasSheet ? (
              showSheetTuning ? (
                <div className="mt-3 space-y-3">
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium">可编辑提示词</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={isGenerating}
                        onClick={() => setDraftPrompt(recommendedSheetPrompt)}
                      >
                        恢复推荐提示词
                      </Button>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      常规微调只改风格、服装细节或姿态；角色脸型、发型和标志特征会随外貌锚点一起锁定。
                    </p>
                  </div>
                  <textarea
                    className="min-h-[180px] w-full resize-y rounded-md border bg-background px-3 py-2 text-xs leading-relaxed"
                    value={draftPrompt}
                    placeholder="输入本次三视图生成提示词"
                    disabled={isGenerating}
                    onChange={(event) => setDraftPrompt(event.target.value)}
                  />
                  {!sheetData.prompt && (
                    <p className="text-xs text-muted-foreground">已填入推荐提示词，可直接微调后生成。</p>
                  )}
                  <div className="space-y-2 rounded-md border bg-background px-3 py-2">
                    <label className="flex items-start gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={useCurrentImageAsReference}
                        disabled={isGenerating}
                        onChange={(event) => setUseCurrentImageAsReference(event.target.checked)}
                      />
                      <span>使用这张三视图作为参考图</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={lockAppearance}
                        disabled={isGenerating}
                        onChange={(event) => setLockAppearance(event.target.checked)}
                      />
                      <span>锁定角色样貌</span>
                    </label>
                    {lockAppearance && (
                      <div className="space-y-1">
                        <textarea
                          className="min-h-16 w-full resize-y rounded-md border bg-muted/20 px-2 py-1.5 text-xs leading-relaxed"
                          value={appearanceOverride}
                          placeholder="补充用于锁定角色相貌的关键词，例如发型、眼睛、体型、服装和标志特征"
                          disabled={isGenerating}
                          onChange={(event) => setAppearanceOverride(event.target.value)}
                        />
                        {!appearanceOverride.trim() && (
                          <p className="text-[11px] text-muted-foreground">填写样貌关键词后，生成时会优先保持这些特征。</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={isGenerating}
                      onClick={() =>
                        startSheetGeneration({
                          prompt: draftPrompt,
                          useCurrentImageAsReference,
                          lockAppearance,
                          appearanceOverride,
                        })
                      }
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          生成中
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          生成微调图
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isGenerating}
                      onClick={() => setShowSheetTuning(false)}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  className="mt-3 w-full"
                  variant="outline"
                  disabled={isGenerating}
                  onClick={openSheetTuning}
                >
                  <Wand2 className="h-4 w-4" />
                  打开提示词微调
                </Button>
              )
            ) : (
              <div className="mt-3 rounded-md border border-dashed bg-muted/30 px-3 py-4 text-xs leading-relaxed text-muted-foreground">
                先生成三视图，系统会保存本次提示词，并允许基于当前图继续微调。
              </div>
            )}
          </div>
        </aside>
      </div>

      <AssetSection character={character} provider={provider} />
      </section>
    </>
  );
}

// ─── Characters Panel Facade ──────────────────────────────────────────────────

export function CharactersPanel({
  project,
  provider,
}: {
  project: { id: string; characters: ComicCharacter[] };
  provider: string;
}) {
  const [selectedCharacterId, setSelectedCharacterId] = useState(project.characters[0]?.id ?? "");

  if (project.characters.length === 0) {
    return (
      <div className="space-y-2 py-12 text-center text-sm text-muted-foreground">
        <Users className="mx-auto h-10 w-10 opacity-30" />
        <p>暂无角色。</p>
        <p className="text-xs">导入内容源后，角色会自动提取到这里。</p>
      </div>
    );
  }

  const selectedCharacter =
    project.characters.find((character) => character.id === selectedCharacterId) ?? project.characters[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <CharacterList
          characters={project.characters}
          selectedCharacterId={selectedCharacter.id}
          onSelect={setSelectedCharacterId}
        />
        <CharacterDetail key={selectedCharacter.id} character={selectedCharacter} provider={provider} />
      </div>
      <div className="rounded-lg border bg-background">
        <FactsSection projectId={project.id} />
      </div>
    </div>
  );
}
