import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma";
import { ragServices } from "../rag";

const ANCHOR_TEXT_MAX_LENGTH = 800;
const MAX_ANCHORS_PER_NOVEL = 200;
const GENERATION_ANCHOR_LIMIT = 2;

export type StyleAnchorSource = "adopted" | "manual";

export interface StyleAnchorPassageCreateInput {
  novelId: string;
  text: string;
  source: StyleAnchorSource;
  sourceChapterId?: string | null;
}

export interface StyleAnchorGenerationItem {
  order: number | null;
  title: string | null;
  text: string;
  source: string;
  forbiddenEntities: string[];
}

export interface StyleAnchorGenerationInput {
  novelId: string;
  styleProfileId?: string | null;
  queryHint?: string;
  forbiddenEntities?: string[];
}

interface StyleAnchorPassageServiceDeps {
  prismaClient?: Pick<
    typeof prisma,
    "styleAnchorPassage" | "styleProfile" | "bookAnalysis"
  >;
  hybridRetrieval?: Pick<typeof ragServices.hybridRetrievalService, "retrieve">;
}

export function computeStyleAnchorContentHash(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

export class StyleAnchorPassageService {
  private readonly store: NonNullable<StyleAnchorPassageServiceDeps["prismaClient"]>;
  private readonly hybridRetrieval: NonNullable<StyleAnchorPassageServiceDeps["hybridRetrieval"]>;

  constructor(deps: StyleAnchorPassageServiceDeps = {}) {
    this.store = deps.prismaClient ?? prisma;
    this.hybridRetrieval = deps.hybridRetrieval ?? ragServices.hybridRetrievalService;
  }

  async create(input: StyleAnchorPassageCreateInput): Promise<{ created: boolean; anchor: { id: string } | null }> {
    const text = input.text.trim().slice(0, ANCHOR_TEXT_MAX_LENGTH);
    if (!text) {
      return { created: false, anchor: null };
    }
    const contentHash = computeStyleAnchorContentHash(text);
    const existing = await this.store.styleAnchorPassage.findUnique({
      where: { novelId_contentHash: { novelId: input.novelId, contentHash } },
      select: { id: true },
    });
    if (existing) {
      return { created: false, anchor: existing };
    }
    await this.evictOldestUnpinnedForCap(input.novelId);
    const anchor = await this.store.styleAnchorPassage.create({
      data: {
        novelId: input.novelId,
        text,
        contentHash,
        source: input.source,
        ...(input.sourceChapterId ? { sourceChapterId: input.sourceChapterId } : {}),
      },
      select: { id: true },
    });
    return { created: true, anchor };
  }

  async delete(novelId: string, anchorId: string): Promise<boolean> {
    const result = await this.store.styleAnchorPassage.deleteMany({
      where: { id: anchorId, novelId },
    });
    return result.count > 0;
  }

  async listForManage(novelId: string) {
    return this.store.styleAnchorPassage.findMany({
      where: { novelId },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: MAX_ANCHORS_PER_NOVEL,
      select: {
        id: true,
        sourceChapterId: true,
        source: true,
        text: true,
        pinned: true,
        createdAt: true,
      },
    });
  }

  /**
   * 生成时的范文锚点，分层降级：
   * 1) 用户确认范文（pinned 优先、最近次之）；
   * 2) 为空且写法资产来自拆书分析时，从源知识文档检索代表性叙事段落作初始锚点；
   * 3) 仍为空返回空数组。任何失败静默降级，不阻塞章节生成。
   */
  async listForGeneration(input: StyleAnchorGenerationInput): Promise<StyleAnchorGenerationItem[]> {
    const confirmed = await this.store.styleAnchorPassage.findMany({
      where: { novelId: input.novelId },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: GENERATION_ANCHOR_LIMIT,
      select: { text: true, source: true },
    }).catch(() => []);

    if (confirmed.length > 0) {
      return confirmed.map((item) => ({
        order: null,
        title: null,
        text: item.text,
        source: item.source,
        forbiddenEntities: [],
      }));
    }

    return this.listSourceBookAnchors(input);
  }

  private async listSourceBookAnchors(input: StyleAnchorGenerationInput): Promise<StyleAnchorGenerationItem[]> {
    try {
      if (!input.styleProfileId) {
        return [];
      }
      const profile = await this.store.styleProfile.findUnique({
        where: { id: input.styleProfileId },
        select: { sourceType: true, sourceRefId: true },
      });
      if (!profile || profile.sourceType !== "book_analysis" || !profile.sourceRefId) {
        return [];
      }
      const analysis = await this.store.bookAnalysis.findUnique({
        where: { id: profile.sourceRefId },
        select: { documentId: true },
      });
      if (!analysis?.documentId || !this.hybridRetrieval) {
        return [];
      }
      const chunks = await this.hybridRetrieval.retrieve(
        input.queryHint?.trim() || "场景 对话 动作 叙事段落",
        {
          novelId: input.novelId,
          ownerTypes: ["knowledge_document"],
          knowledgeDocumentIds: [analysis.documentId],
          finalTopK: GENERATION_ANCHOR_LIMIT,
        },
      );
      return chunks
        .map((chunk) => chunk.chunkText.trim())
        .filter((text) => text.length > 0)
        .slice(0, GENERATION_ANCHOR_LIMIT)
        .map((text) => ({
          order: null,
          title: null,
          text: text.slice(0, ANCHOR_TEXT_MAX_LENGTH),
          source: "source_book",
          forbiddenEntities: input.forbiddenEntities ?? [],
        }));
    } catch {
      return [];
    }
  }

  private async evictOldestUnpinnedForCap(novelId: string): Promise<void> {
    const count = await this.store.styleAnchorPassage.count({ where: { novelId } });
    if (count < MAX_ANCHORS_PER_NOVEL) {
      return;
    }
    const oldest = await this.store.styleAnchorPassage.findFirst({
      where: { novelId, pinned: false },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (oldest) {
      await this.store.styleAnchorPassage.delete({ where: { id: oldest.id } });
    }
  }
}
