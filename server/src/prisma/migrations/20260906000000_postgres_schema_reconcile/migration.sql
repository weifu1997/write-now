-- 对账迁移：将全新库经既有迁移链得到的结构收敛到 schema.prisma 的期望状态。
-- 全部语句幂等，可安全重复执行。详见 docs/wiki/debugging/postgres-migration-chain.md。

-- DropForeignKey（schema 已不再声明这些数据库级外键）
ALTER TABLE "DirectorRuntimeCommand" DROP CONSTRAINT IF EXISTS "DirectorRuntimeCommand_novelId_fkey";
ALTER TABLE "DirectorRuntimeCommand" DROP CONSTRAINT IF EXISTS "DirectorRuntimeCommand_workflowTaskId_fkey";
ALTER TABLE "DirectorRuntimeEvent" DROP CONSTRAINT IF EXISTS "DirectorRuntimeEvent_novelId_fkey";
ALTER TABLE "DirectorRuntimeEvent" DROP CONSTRAINT IF EXISTS "DirectorRuntimeEvent_workflowTaskId_fkey";
ALTER TABLE "DirectorRuntimeExecution" DROP CONSTRAINT IF EXISTS "DirectorRuntimeExecution_novelId_fkey";
ALTER TABLE "DirectorRuntimeExecution" DROP CONSTRAINT IF EXISTS "DirectorRuntimeExecution_workflowTaskId_fkey";
ALTER TABLE "DirectorRuntimeInstance" DROP CONSTRAINT IF EXISTS "DirectorRuntimeInstance_novelId_fkey";
ALTER TABLE "DirectorRuntimeInstance" DROP CONSTRAINT IF EXISTS "DirectorRuntimeInstance_runId_fkey";
ALTER TABLE "DirectorRuntimeInstance" DROP CONSTRAINT IF EXISTS "DirectorRuntimeInstance_workflowTaskId_fkey";

-- AlterTable：默认值与类型收敛
ALTER TABLE "BookAnalysis" ALTER COLUMN "usedTokens" SET DEFAULT 0;
ALTER TABLE "BookAnalysisCharacter" ALTER COLUMN "status" SET DEFAULT 'candidate';
ALTER TABLE "CharacterMindSnapshot" ALTER COLUMN "confidence" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable：补齐缺失列
ALTER TABLE "ComicCharacter" ADD COLUMN IF NOT EXISTS "gender" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "ComicPanel" ADD COLUMN IF NOT EXISTS "sceneRef" TEXT;
ALTER TABLE "DramaCharacter" ADD COLUMN IF NOT EXISTS "portraitData" TEXT,
ADD COLUMN IF NOT EXISTS "threeViewData" TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NovelWorkflowTask" ADD COLUMN IF NOT EXISTS "pendingManualRecovery" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable：默认值收敛（@updatedAt 在数据库层无默认值）
ALTER TABLE "DramaCharacterLibrary" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "DramaEpisode" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "DramaProject" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "DramaShot" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "DramaSourceBundle" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "DramaStoryboard" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "DramaVideoPrompt" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NovelSideEffectJob" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NovelWorld" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "WorldAsset" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable：清理 schema 已移除的列
ALTER TABLE "Novel" DROP COLUMN IF EXISTS "directorRiskNoticeThreshold";
ALTER TABLE "Novel" DROP COLUMN IF EXISTS "directorRiskPauseThreshold";

-- CreateTable：补齐缺失表
CREATE TABLE IF NOT EXISTS "PromptSlotOverride" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "novelId" TEXT,
    "promptId" TEXT NOT NULL,
    "baseVersion" TEXT NOT NULL,
    "slots" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptSlotOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ComicCharacterAsset" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageData" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComicCharacterAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ComicScene" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sceneType" TEXT NOT NULL DEFAULT 'interior',
    "bible" TEXT,
    "sheetData" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComicScene_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PromptSlotOverride_promptId_idx" ON "PromptSlotOverride"("promptId");
CREATE INDEX IF NOT EXISTS "PromptSlotOverride_novelId_promptId_idx" ON "PromptSlotOverride"("novelId", "promptId");
CREATE UNIQUE INDEX IF NOT EXISTS "PromptSlotOverride_scope_novelId_promptId_key" ON "PromptSlotOverride"("scope", "novelId", "promptId");
CREATE INDEX IF NOT EXISTS "ComicCharacterAsset_characterId_idx" ON "ComicCharacterAsset"("characterId");
CREATE INDEX IF NOT EXISTS "ComicCharacterAsset_projectId_idx" ON "ComicCharacterAsset"("projectId");
CREATE INDEX IF NOT EXISTS "ComicScene_projectId_idx" ON "ComicScene"("projectId");

-- AddForeignKey（Postgres 不支持 ADD CONSTRAINT IF NOT EXISTS，用 DO 块幂等）
DO $$ BEGIN
    ALTER TABLE "PromptSlotOverride" ADD CONSTRAINT "PromptSlotOverride_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "ComicCharacterAsset" ADD CONSTRAINT "ComicCharacterAsset_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "ComicCharacter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "ComicCharacterAsset" ADD CONSTRAINT "ComicCharacterAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ComicProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "ComicScene" ADD CONSTRAINT "ComicScene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ComicProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RenameIndex：对齐超长索引名截断后的命名
ALTER INDEX IF EXISTS "AutoDirectorFollowUpNotificationLog_eventId_channelType_created" RENAME TO "AutoDirectorFollowUpNotificationLog_eventId_channelType_cre_idx";
ALTER INDEX IF EXISTS "BookAnalysisCharacterAppearanceSnapshot_appearanceId_chapterInd" RENAME TO "BookAnalysisCharacterAppearanceSnapshot_appearanceId_chapte_idx";
ALTER INDEX IF EXISTS "BookAnalysisCharacterAppearanceSnapshot_characterId_chapterInde" RENAME TO "BookAnalysisCharacterAppearanceSnapshot_characterId_chapter_key";
ALTER INDEX IF EXISTS "BookAnalysisCharacterAppearanceTerm_characterId_status_updatedA" RENAME TO "BookAnalysisCharacterAppearanceTerm_characterId_status_upda_idx";
ALTER INDEX IF EXISTS "BookAnalysisSourceCache_scope_unique" RENAME TO "BookAnalysisSourceCache_documentVersionId_sourceScopeKey_pr_key";
ALTER INDEX IF EXISTS "ChapterArtifactSyncCheckpoint_novelId_chapterId_artifactType_up" RENAME TO "ChapterArtifactSyncCheckpoint_novelId_chapterId_artifactTyp_idx";
ALTER INDEX IF EXISTS "ChapterArtifactSyncCheckpoint_novelId_chapterId_contentHash_art" RENAME TO "ChapterArtifactSyncCheckpoint_novelId_chapterId_contentHash_key";
ALTER INDEX IF EXISTS "CharacterConversationSession_subjectKind_subjectId_scopeKind_sc" RENAME TO "CharacterConversationSession_subjectKind_subjectId_scopeKin_idx";
ALTER INDEX IF EXISTS "CharacterDialogueInfluence_novelId_characterId_status_targetSta" RENAME TO "CharacterDialogueInfluence_novelId_characterId_status_targe_idx";
ALTER INDEX IF EXISTS "CharacterDialogueSession_novelId_characterId_status_updatedAt_i" RENAME TO "CharacterDialogueSession_novelId_characterId_status_updated_idx";
ALTER INDEX IF EXISTS "CharacterInfluenceProposal_novelId_characterId_status_targetSta" RENAME TO "CharacterInfluenceProposal_novelId_characterId_status_targe_idx";
ALTER INDEX IF EXISTS "CharacterMindSnapshot_novelId_characterId_isCurrent_updatedAt_i" RENAME TO "CharacterMindSnapshot_novelId_characterId_isCurrent_updated_idx";
ALTER INDEX IF EXISTS "VisualAssetProjection_sourceDomain_sourceType_sourceId_sourceVe" RENAME TO "VisualAssetProjection_sourceDomain_sourceType_sourceId_sour_key";
