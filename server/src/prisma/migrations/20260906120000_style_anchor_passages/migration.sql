CREATE TABLE IF NOT EXISTS "StyleAnchorPassage" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "sourceChapterId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleAnchorPassage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StyleAnchorPassage_novelId_createdAt_idx" ON "StyleAnchorPassage"("novelId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "StyleAnchorPassage_novelId_contentHash_key" ON "StyleAnchorPassage"("novelId", "contentHash");
