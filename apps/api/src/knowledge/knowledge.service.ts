import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ProjectAccessService } from '../projects/project-access.service';
import { RedisCacheService } from '../cache/redis-cache.service';

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const DEFAULT_MAX_CANDIDATES = 1000;
const MAX_CANDIDATES = 10_000;
const SEMANTIC_WEIGHT = 0.65;
const KEYWORD_WEIGHT = 0.35;
const EXACT_MATCH_BONUS = 0.25;
const TITLE_WEIGHT = 0.5;

// 中文查询没有空格分隔，按双字切分后统计词项覆盖率；单个汉字查询保留原字。
function tokenizeQuery(query: string) {
  const lowered = query.toLowerCase();
  const terms = new Set(lowered.match(/[a-z0-9][a-z0-9._-]*/g) ?? []);
  for (const run of lowered.match(/\p{Script=Han}+/gu) ?? []) {
    if (run.length === 1) terms.add(run);
    for (let index = 0; index < run.length - 1; index += 1) {
      terms.add(run.slice(index, index + 2));
    }
  }
  return [...terms];
}

function keywordScore(content: string, query: string, filename = '') {
  const normalized = query.trim().toLowerCase();
  const terms = tokenizeQuery(query);
  if (!normalized || terms.length === 0) return 0;
  const text = content.toLowerCase();
  const title = filename.toLowerCase();
  const coverage = terms.filter((term) => text.includes(term)).length / terms.length;
  const titleCoverage = terms.filter((term) => title.includes(term)).length / terms.length;
  return Math.min(
    1,
    coverage + titleCoverage * TITLE_WEIGHT + (text.includes(normalized) ? EXACT_MATCH_BONUS : 0),
  );
}

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly access: ProjectAccessService,
    @Optional() private readonly cache?: RedisCacheService,
  ) {}
  async list(userId: string, projectId: string, page = 1, limit = 20) {
    await this.access.assertMember(userId, projectId);
    const where = { projectId };
    const [items, total] = await Promise.all([
      this.prisma.knowledgeBase.findMany({
        where,
        include: { documents: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.knowledgeBase.count({ where }),
    ]);
    return { items, total, page, limit };
  }
  async create(userId: string, projectId: string, name: string, description?: string) {
    await this.access.assertMember(userId, projectId);
    return this.prisma.knowledgeBase.create({ data: { projectId, name, description } });
  }
  async update(userId: string, knowledgeBaseId: string, name?: string, description?: string) {
    const base = await this.prisma.knowledgeBase.findUnique({ where: { id: knowledgeBaseId } });
    if (!base) throw new NotFoundException('知识库不存在');
    await this.access.assertMember(userId, base.projectId);
    return this.prisma.knowledgeBase.update({
      where: { id: knowledgeBaseId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      },
    });
  }
  async remove(userId: string, knowledgeBaseId: string) {
    const base = await this.prisma.knowledgeBase.findUnique({ where: { id: knowledgeBaseId } });
    if (!base) throw new NotFoundException('知识库不存在');
    await this.access.assertMember(userId, base.projectId);
    return this.prisma.knowledgeBase.delete({ where: { id: knowledgeBaseId } });
  }
  async addDocument(
    userId: string,
    knowledgeBaseId: string,
    filename: string,
    mimeType: string,
    content: string,
  ) {
    const base = await this.prisma.knowledgeBase.findUnique({ where: { id: knowledgeBaseId } });
    if (!base) throw new NotFoundException('知识库不存在');
    await this.access.assertMember(userId, base.projectId);
    if (!content.trim() || Buffer.byteLength(content, 'utf8') > 10 * 1024 * 1024)
      throw new BadRequestException('文档内容为空或超过 10MB');
    const chunks = content.match(/.{1,1000}/gs) ?? [];
    const embeddings = await Promise.all(
      chunks.map(
        (chunk) =>
          this.cache?.getOrSet(
            `embedding:${createHash('sha256').update(chunk).digest('hex')}`,
            () => this.ai.embedding(chunk),
            86_400,
          ) ?? this.ai.embedding(chunk),
      ),
    );
    return this.prisma.$transaction(async (tx) => {
      const document = await tx.knowledgeDocument.create({
        data: { knowledgeBaseId, filename, mimeType, content },
      });
      await tx.documentChunk.createMany({
        data: chunks.map((chunk, position) => ({
          documentId: document.id,
          position,
          content: chunk,
          embedding: embeddings[position],
        })),
      });
      return document;
    });
  }
  async search(
    userId: string,
    knowledgeBaseId: string,
    query: string,
    page = 1,
    limit = DEFAULT_SEARCH_LIMIT,
  ) {
    await this.access.assertKnowledgeBaseMember(userId, knowledgeBaseId);
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(
      MAX_SEARCH_LIMIT,
      Math.max(1, Math.floor(limit) || DEFAULT_SEARCH_LIMIT),
    );
    const configuredLimit = Number(process.env.RAG_MAX_CANDIDATES);
    const maxCandidates =
      Number.isInteger(configuredLimit) && configuredLimit > 0
        ? Math.min(MAX_CANDIDATES, configuredLimit)
        : DEFAULT_MAX_CANDIDATES;
    const startedAt = performance.now();
    const chunks = await this.prisma.documentChunk.findMany({
      where: { document: { knowledgeBaseId } },
      include: { document: true },
      orderBy: [{ documentId: 'asc' }, { position: 'asc' }],
      take: maxCandidates + 1,
    });
    const truncated = chunks.length > maxCandidates;
    const candidates = chunks.slice(0, maxCandidates);
    const embeddingStartedAt = performance.now();
    const queryVector = await this.ai.embedding(query);
    const embeddingDurationMs = Number((performance.now() - embeddingStartedAt).toFixed(2));
    const keywordStartedAt = performance.now();
    const matched = candidates
      .map((chunk) => {
        const vector = Array.isArray(chunk.embedding)
          ? chunk.embedding.filter((value): value is number => typeof value === 'number')
          : [];
        const dot = vector.reduce(
          (sum, value, index) => sum + value * (queryVector[index] ?? 0),
          0,
        );
        const semantic =
          dot /
          ((Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1) *
            (Math.sqrt(queryVector.reduce((sum, value) => sum + value * value, 0)) || 1));
        const keyword = keywordScore(chunk.content, query, chunk.document.filename);
        return {
          ...chunk,
          score: Math.max(semantic, 0) * SEMANTIC_WEIGHT + keyword * KEYWORD_WEIGHT,
        };
      })
      .filter((chunk) => chunk.score > 0.05)
      .sort(
        (a, b) =>
          b.score - a.score || a.documentId.localeCompare(b.documentId) || a.position - b.position,
      );
    const keywordDurationMs = Number((performance.now() - keywordStartedAt).toFixed(2));
    const offset = (safePage - 1) * safeLimit;
    return {
      items: matched.slice(offset, offset + safeLimit).map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        position: chunk.position,
        content: chunk.content,
        score: chunk.score,
        document: { id: chunk.document.id, filename: chunk.document.filename },
      })),
      total: matched.length,
      page: safePage,
      limit: safeLimit,
      hasMore: offset + safeLimit < matched.length,
      truncated,
      metrics: {
        candidateCount: candidates.length,
        keywordDurationMs,
        embeddingDurationMs,
        totalDurationMs: Number((performance.now() - startedAt).toFixed(2)),
      },
    };
  }

  async buildContext(userId: string, knowledgeBaseId: string, query: string, maxChars = 6000) {
    const results = await this.search(userId, knowledgeBaseId, query);
    let used = 0;
    const sections: string[] = [];
    for (const result of results.items) {
      const section = `## ${result.document.filename} (score ${result.score.toFixed(3)})\n${result.content}`;
      if (used + section.length > maxChars) break;
      sections.push(section);
      used += section.length;
    }
    return sections.join('\n\n');
  }
}
