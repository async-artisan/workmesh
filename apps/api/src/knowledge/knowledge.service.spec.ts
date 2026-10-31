import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeService } from './knowledge.service';

afterEach(() => vi.unstubAllEnvs());

describe('KnowledgeService', () => {
  it('returns paginated knowledge bases after membership check', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const assertMember = vi.fn();
    const service = new KnowledgeService(
      { knowledgeBase: { findMany, count } } as never,
      {} as never,
      { assertMember } as never,
    );
    await expect(service.list('user-1', 'project-1', 2, 10)).resolves.toEqual({
      items: [],
      total: 0,
      page: 2,
      limit: 10,
    });
    expect(assertMember).toHaveBeenCalledWith('user-1', 'project-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10, where: { projectId: 'project-1' } }),
    );
  });

  it('checks project membership before updating or deleting a knowledge base', async () => {
    const base = { id: 'base-1', projectId: 'project-1' };
    const update = vi.fn().mockResolvedValue({ ...base, name: 'New name' });
    const remove = vi.fn().mockResolvedValue(base);
    const assertMember = vi.fn();
    const service = new KnowledgeService(
      {
        knowledgeBase: {
          findUnique: vi.fn().mockResolvedValue(base),
          update,
          delete: remove,
        },
      } as never,
      {} as never,
      { assertMember } as never,
    );
    await service.update('user-1', 'base-1', 'New name');
    await service.remove('user-1', 'base-1');
    expect(assertMember).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('creates knowledge bases and stores bounded document chunks transactionally', async () => {
    const document = { id: 'doc-1' };
    const createDocument = vi.fn().mockResolvedValue(document);
    const createChunks = vi.fn().mockResolvedValue({ count: 2 });
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        knowledgeDocument: { create: createDocument },
        documentChunk: { createMany: createChunks },
      }),
    );
    const createBase = vi.fn().mockResolvedValue({ id: 'base-1' });
    const findBase = vi.fn().mockResolvedValue({ id: 'base-1', projectId: 'project-1' });
    const service = new KnowledgeService(
      {
        knowledgeBase: { create: createBase, findUnique: findBase },
        $transaction: transaction,
      } as never,
      {
        embedding: vi.fn().mockResolvedValueOnce([1, 0]).mockResolvedValueOnce([0, 1]),
      } as never,
      { assertMember: vi.fn() } as never,
      undefined,
    );
    await service.create('user-1', 'project-1', 'Docs', 'Description');
    const content = 'x'.repeat(1001);
    await service.addDocument('user-1', 'base-1', 'notes.txt', 'text/plain', content);
    expect(createBase).toHaveBeenCalledWith({
      data: { projectId: 'project-1', name: 'Docs', description: 'Description' },
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(createChunks).toHaveBeenCalledWith({
      data: [
        { documentId: 'doc-1', position: 0, content: 'x'.repeat(1000), embedding: [1, 0] },
        { documentId: 'doc-1', position: 1, content: 'x', embedding: [0, 1] },
      ],
    });
  });

  it('rejects missing knowledge bases and invalid document content', async () => {
    const findBase = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({
      id: 'base-1',
      projectId: 'project-1',
    });
    const create = vi.fn();
    const service = new KnowledgeService(
      { knowledgeBase: { findUnique: findBase, update: create, delete: create } } as never,
      { embeddings: vi.fn() } as never,
      { assertMember: vi.fn() } as never,
    );
    await expect(service.update('user-1', 'missing')).rejects.toMatchObject({ status: 404 });
    await expect(
      service.addDocument('user-1', 'base-1', 'empty.txt', 'text/plain', '  '),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.addDocument(
        'user-1',
        'base-1',
        'large.txt',
        'text/plain',
        'x'.repeat(10 * 1024 * 1024 + 1),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it('ranks Chinese queries by character bigrams and document title', async () => {
    const chunks = [
      {
        documentId: 'doc-1',
        position: 0,
        content: '品牌公海以及释放、认领只和采购有关',
        embedding: null,
        document: { filename: 'v1.0.0/需求文档-品牌分配.md' },
      },
      {
        documentId: 'doc-2',
        position: 0,
        content: '进入公海条件：采购跟进人达到上限后释放',
        embedding: null,
        document: { filename: 'v1.0.0/需求文档-品牌分配.md' },
      },
      {
        documentId: 'doc-3',
        position: 0,
        content: '与物流人员确认体积重系数',
        embedding: null,
        document: { filename: 'v1.0.6/PRD-运费计费规则修改.md' },
      },
      {
        documentId: 'doc-4',
        position: 0,
        content: '与物流人员确认体积重系数',
        embedding: null,
        document: { filename: 'v1.0.0/设计目标.md' },
      },
    ];
    const service = new KnowledgeService(
      { documentChunk: { findMany: vi.fn().mockResolvedValue(chunks) } } as never,
      { embedding: vi.fn().mockResolvedValue([]) } as never,
      { assertKnowledgeBaseMember: vi.fn() } as never,
    );

    const phrase = await service.search('user-1', 'base-1', '进入公海条件');
    expect(phrase.items[0].content).toContain('进入公海条件');

    const titled = await service.search('user-1', 'base-1', '运费计费规则');
    expect(titled.items.map((item) => item.document.filename)).toEqual([
      'v1.0.6/PRD-运费计费规则修改.md',
    ]);
  });

  it('ranks semantic and keyword results and limits assembled context', async () => {
    const chunks = [
      {
        documentId: 'doc-1',
        position: 0,
        content: 'Match phrase',
        embedding: [1, 0],
        document: { filename: 'first.md' },
      },
      {
        documentId: 'doc-2',
        position: 0,
        content: 'unrelated',
        embedding: [1, 0],
        document: { filename: 'second.md' },
      },
      {
        documentId: 'doc-3',
        position: 0,
        content: 'far away',
        embedding: [0, 1],
        document: { filename: 'third.md' },
      },
      {
        documentId: 'doc-4',
        position: 0,
        content: 'invalid vector',
        embedding: 'invalid',
        document: { filename: 'fourth.md' },
      },
    ];
    const service = new KnowledgeService(
      { documentChunk: { findMany: vi.fn().mockResolvedValue(chunks) } } as never,
      { embedding: vi.fn().mockResolvedValue([1, 0]) } as never,
      { assertKnowledgeBaseMember: vi.fn() } as never,
    );
    const results = await service.search('user-1', 'base-1', 'Match phrase');
    expect(results.items.map((item) => item.document.filename)).toEqual(['first.md', 'second.md']);
    expect(results.items[0].score).toBeGreaterThan(results.items[1].score);
    expect(results).toMatchObject({
      page: 1,
      limit: 20,
      total: 2,
      hasMore: false,
      truncated: false,
    });
    expect(results.metrics.candidateCount).toBe(4);

    const page = await service.search('user-1', 'base-1', 'Match phrase', 2, 1);
    expect(page.items).toHaveLength(1);
    expect(page).toMatchObject({ page: 2, limit: 1, total: 2, hasMore: false });

    const empty = new KnowledgeService(
      { documentChunk: { findMany: vi.fn().mockResolvedValue([]) } } as never,
      { embedding: vi.fn().mockResolvedValue([]) } as never,
      { assertKnowledgeBaseMember: vi.fn() } as never,
    );
    await expect(empty.search('user-1', 'base-1', 'query')).resolves.toMatchObject({
      items: [],
      total: 0,
      truncated: false,
      metrics: { candidateCount: 0 },
    });

    const keywordOnly = new KnowledgeService(
      {
        documentChunk: {
          findMany: vi.fn().mockResolvedValue([
            {
              documentId: 'doc-1',
              position: 0,
              content: 'keyword only match',
              embedding: null,
              document: { filename: 'keyword.md' },
            },
          ]),
        },
      } as never,
      { embedding: vi.fn().mockResolvedValue([]) } as never,
      { assertKnowledgeBaseMember: vi.fn() } as never,
    );
    await expect(keywordOnly.search('user-1', 'base-1', 'keyword')).resolves.toMatchObject({
      items: [expect.objectContaining({ document: { filename: 'keyword.md' } })],
      truncated: false,
    });

    vi.stubEnv('RAG_MAX_CANDIDATES', '1');
    const cappedFind = vi.fn().mockResolvedValue([
      {
        documentId: 'doc-1',
        position: 0,
        content: 'match',
        embedding: [1],
        document: { filename: 'one.md' },
      },
      {
        documentId: 'doc-2',
        position: 0,
        content: 'match',
        embedding: [1],
        document: { filename: 'two.md' },
      },
    ]);
    const capped = new KnowledgeService(
      { documentChunk: { findMany: cappedFind } } as never,
      { embedding: vi.fn().mockResolvedValue([1]) } as never,
      { assertKnowledgeBaseMember: vi.fn() } as never,
    );
    await expect(capped.search('user-1', 'base-1', 'match', 1, 200)).resolves.toMatchObject({
      items: [expect.objectContaining({ document: { filename: 'one.md' } })],
      limit: 100,
      truncated: true,
      hasMore: false,
      metrics: { candidateCount: 1 },
    });
    expect(cappedFind).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));

    vi.spyOn(service, 'search').mockResolvedValue({
      items: [
        { content: 'short', score: 1, document: { filename: 'one.md' } },
        { content: 'too long', score: 0.5, document: { filename: 'two.md' } },
      ],
      total: 2,
      page: 1,
      limit: 20,
      hasMore: false,
      truncated: false,
      metrics: {
        candidateCount: 2,
        keywordDurationMs: 0,
        embeddingDurationMs: 0,
        totalDurationMs: 0,
      },
    } as never);
    await expect(service.buildContext('user-1', 'base-1', 'query', 40)).resolves.toContain(
      'one.md',
    );
    await expect(service.buildContext('user-1', 'base-1', 'query', 40)).resolves.not.toContain(
      'two.md',
    );
  });
});
