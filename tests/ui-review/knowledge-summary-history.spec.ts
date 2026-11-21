import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import type { DocumentSummary } from '../../apps/web/src/api/documentSummaries';
import type { RevisionView } from '../../apps/web/src/api/resources';
import { installReviewFixtures } from './fixtures';

type ProjectId = 'p1' | 'p2';
interface ApiFailure {
  status: number;
  code: string;
  message: string;
}
interface Gate {
  pathname: string;
  query?: Record<string, string>;
  ready: Promise<void>;
  used?: boolean;
}
interface RequestEntry {
  method: string;
  path: string;
}
interface ActionBinding {
  action: string;
  projectId: string;
  targetType: string;
  targetId: string;
  expectedVersion: number;
  roleSlot: null;
  payload: { reason: string };
}
interface WithdrawalEntry {
  documentId: string;
  expectedVersion: number;
  reason: string;
  ticketId: string;
}
interface Ledger {
  requests: RequestEntry[];
  rejectedLegacyReads: string[];
  rejectedWrites: string[];
  previews: ActionBinding[];
  ticketBindings: ActionBinding[];
  withdrawals: WithdrawalEntry[];
}

const ledgers = new Map<Page, Ledger>();
const targetIndex = 107;
const earlySearch = '归档税率条款';
const collectionKinds = ['BUSINESS', 'SYSTEM', 'PRACTICE'] as const;
const collectionTitles = ['业务事实库', '系统事实库', '角色实践库'] as const;
const collectionKind = (index: number) => collectionKinds[index <= 36 ? 0 : index <= 72 ? 1 : 2]!;
const kbId = (index: number, projectId: ProjectId = 'p1') =>
  `kb-${projectId}-${projectId === 'p2' ? 'BUSINESS' : collectionKind(index)}`;
const kind = (index: number) =>
  index === targetIndex
    ? 'KNOWLEDGE'
    : (['UNDERSTANDING', 'DECISION', 'PRD', 'KNOWLEDGE'] as const)[(index - 1) % 4]!;
const actionDigest = 'd'.repeat(64);
const documentId = (index: number, projectId: ProjectId = 'p1') =>
  `${projectId === 'p1' ? '10000000' : '20000000'}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const revisionId = (index: number, seq: number, projectId: ProjectId = 'p1') =>
  `${projectId === 'p1' ? '30000000' : '40000000'}-0000-4000-8000-${String(index).padStart(4, '0')}${String(seq).padStart(8, '0')}`;
const targetId = documentId(targetIndex);
const targetRevision = (seq: number) => revisionId(targetIndex, seq);
const title = (index: number, projectId: ProjectId = 'p1') =>
  projectId === 'p2'
    ? '另一项目独立知识'
    : index === targetIndex
      ? '远页税率知识'
      : `目录知识 ${String(index).padStart(3, '0')}`;
const historyPath = (id = targetId) => `/api/v1/documents/${id}/history`;
const metadataPath = (id: string, document = targetId) =>
  `/api/v1/documents/${document}/revisions/${id}/metadata`;
const contentPath = (id: string) => `/api/v1/document-revisions/${id}/content`;
const summaryPath = (projectId: ProjectId = 'p1') =>
  `/api/v1/projects/${projectId}/document-summaries`;
const historyCursor = (version: number, offset: number) => `history-${version}-${offset}`;

function latch() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

async function afterBrowserPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function finishOrAbort(request: Request) {
  const response = await request.response();
  if (response) await response.finished();
}

async function installKnowledgeFixtures(page: Page) {
  await installReviewFixtures(page);
  const ledger: Ledger = {
    requests: [],
    rejectedLegacyReads: [],
    rejectedWrites: [],
    previews: [],
    ticketBindings: [],
    withdrawals: [],
  };
  ledgers.set(page, ledger);
  const controls = {
    gates: [] as Gate[],
    historyFailures: new Map<string, ApiFailure>(),
    historyTotals: new Map<string, number>(),
    catalogFailures: new Map<string, ApiFailure>(),
    overviewFailures: new Map<string, ApiFailure>(),
    summaryFailures: new Map<string, ApiFailure>(),
    searchFailures: new Map<string, ApiFailure>(),
    searchTruncated: new Set<string>(),
    // A search hit can predate a publication change; always resolve its exact revision ID.
    targetSearchSeq: 2,
    metadataFailures: new Map<string, ApiFailure>(),
    contentFailures: new Map<string, ApiFailure>(),
    versions: new Map<string, number>([[targetId, 17]]),
    withdrawn: new Set<string>(),
    allowWithdraw: false,
    conflictOnNextWithdraw: false,
  };
  const identities = new Map<string, { index: number; projectId: ProjectId }>();
  const revisionIdentities = new Map<
    string,
    { index: number; seq: number; projectId: ProjectId }
  >();
  for (const projectId of ['p1', 'p2'] as const) {
    for (let index = 1; index <= (projectId === 'p1' ? 107 : 1); index += 1) {
      identities.set(documentId(index, projectId), { index, projectId });
      const count = projectId === 'p1' && index === targetIndex ? 123 : 3;
      for (let seq = 1; seq <= count; seq += 1)
        revisionIdentities.set(revisionId(index, seq, projectId), { index, seq, projectId });
    }
  }
  const version = (id: string) => controls.versions.get(id) ?? 3;
  function revision(
    index: number,
    seq: number,
    projectId: ProjectId = 'p1',
  ): RevisionView & { projectId: ProjectId; knowledgeBaseId: string } {
    const id = documentId(index, projectId);
    return {
      id: revisionId(index, seq, projectId),
      documentId: id,
      projectId,
      knowledgeBaseId: kbId(index, projectId),
      seq,
      title: `${title(index, projectId)} · ${seq === 1 && index === targetIndex && projectId === 'p1' ? earlySearch : `修订 ${seq}`}`,
      mimeType: seq === 7 ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8',
      byteLength: 80,
      digest: seq.toString(16).padStart(64, '0'),
      state: seq === 2 && !controls.withdrawn.has(id) ? 'PUBLISHED' : 'CANDIDATE',
      createdBy: 'fixture-user',
      basisUnderstandingRevisionId: seq === 7 ? revisionId(1, 3, projectId) : null,
      deliveryScope: null,
      acceptance: [
        { key: 'catalog-behavior', text: '文档与修订始终使用真实标识', verification: 'TEST' },
      ],
      reviewRequestId: seq === 2 ? null : `review-${revisionId(index, seq, projectId)}`,
    };
  }
  function summary(index: number, projectId: ProjectId = 'p1'): DocumentSummary {
    const id = documentId(index, projectId);
    const count = projectId === 'p1' && index === targetIndex ? 123 : 3;
    const compact = (seq: number) => {
      const item = revision(index, seq, projectId);
      return {
        id: item.id,
        documentId: id,
        seq,
        title: item.title,
        digest: item.digest,
        state: item.state as 'CANDIDATE' | 'PUBLISHED',
      };
    };
    return {
      document: {
        id,
        projectId,
        knowledgeBaseId: kbId(index, projectId),
        requirementId: projectId === 'p1' ? 'req-1' : null,
        kind: kind(index),
        version: version(id),
        currentPublishedRevisionId: controls.withdrawn.has(id)
          ? null
          : revisionId(index, 2, projectId),
        archivedAt: null,
      },
      updatedAt: new Date(Date.UTC(2026, 10, 10, 0, 0, 108 - index)).toISOString(),
      knowledgeBase: {
        id: kbId(index, projectId),
        name: `${projectId === 'p2' ? 'BUSINESS' : collectionKind(index)}验收知识库`,
        kind: projectId === 'p2' ? 'BUSINESS' : collectionKind(index),
      },
      requirement:
        projectId === 'p1'
          ? { id: 'req-1', code: 'DEMO-001', title: '移动端结算与登录改版' }
          : null,
      latestVisibleRevision: compact(count),
      publishedRevision: controls.withdrawn.has(id) ? null : compact(2),
      visibleRevisionCount: count,
      candidateRevisionCount: count - (controls.withdrawn.has(id) ? 0 : 1),
    };
  }
  const getRequests = (pathname: string) =>
    ledger.requests.filter(
      (entry) =>
        entry.method === 'GET' && new URL(entry.path, 'http://fixture').pathname === pathname,
    );
  const gates = async (url: URL) => {
    const gate = controls.gates.find(
      (item) =>
        !item.used &&
        item.pathname === url.pathname &&
        Object.entries(item.query ?? {}).every(
          ([key, value]) => url.searchParams.get(key) === value,
        ),
    );
    if (gate) {
      gate.used = true;
      await gate.ready;
    }
  };
  let ticketNo = 0;
  const tickets = new Map<string, { binding: ActionBinding; secret: string; used: boolean }>();
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      ledger.requests.push({ method, path: path + url.search });
      const reply = async (data: unknown, status = 200) => {
        await gates(url);
        return route.fulfill({
          status,
          json: { data, meta: { requestId: 'knowledge-summary-history-fixture' } },
        });
      };
      const fail = async (error: ApiFailure) => {
        await gates(url);
        return route.fulfill({
          status: error.status,
          json: {
            error: {
              code: error.code,
              message: error.message,
              requestId: 'knowledge-summary-history-fixture',
            },
          },
        });
      };
      const withdrawMatch = /^\/api\/v1\/documents\/([^/]+)\/withdraw$/.exec(path);
      if (method !== 'GET') {
        const allowed =
          controls.allowWithdraw &&
          method === 'POST' &&
          (path === '/api/v1/auth/action-previews' ||
            path === '/api/v1/auth/confirmation-tickets' ||
            withdrawMatch);
        if (!allowed) {
          ledger.rejectedWrites.push(`${method} ${path}`);
          return fail({
            status: 405,
            code: 'UNEXPECTED_WRITE',
            message: '只有明确撤销场景允许写入',
          });
        }
        expect(request.headers()['x-csrf-token']).toBe('fixture-csrf');
        const body = request.postDataJSON();
        if (
          path === '/api/v1/auth/action-previews' ||
          path === '/api/v1/auth/confirmation-tickets'
        ) {
          const binding: ActionBinding = {
            action: body.action,
            projectId: body.projectId,
            targetType: body.targetType,
            targetId: body.targetId,
            expectedVersion: body.expectedVersion,
            roleSlot: body.roleSlot,
            payload: body.payload,
          };
          expect(binding).toMatchObject({
            action: 'KNOWLEDGE_WITHDRAW',
            projectId: 'p1',
            targetType: 'KNOWLEDGE_DOCUMENT',
            targetId,
            roleSlot: null,
          });
          if (path.endsWith('/action-previews')) {
            ledger.previews.push(binding);
            return reply({ binding, actionDigest, display: { ...binding } });
          }
          expect(body.actionDigest).toBe(actionDigest);
          expect(body.password).toBe('fixture-password');
          ledger.ticketBindings.push(binding);
          ticketNo += 1;
          const ticketId = `knowledge-ticket-${ticketNo}`;
          const secret = `fixture-ticket-secret-${ticketNo}`;
          tickets.set(ticketId, { binding, secret, used: false });
          return reply(
            { ticketId, ticketSecret: secret, expiresAt: '2099-01-01T00:00:00.000Z', actionDigest },
            201,
          );
        }
        const id = withdrawMatch![1]!;
        expect(request.headers()['idempotency-key']).toBeTruthy();
        const ticket = tickets.get(body.confirmation?.ticketId);
        expect(ticket, '撤销必须使用已经签发的票据').toBeDefined();
        expect(ticket!.used).toBe(false);
        expect(body.confirmation.ticketSecret).toBe(ticket!.secret);
        expect(body).toEqual({
          expectedVersion: ticket!.binding.expectedVersion,
          reason: ticket!.binding.payload.reason,
          confirmation: { ticketId: body.confirmation.ticketId, ticketSecret: ticket!.secret },
        });
        ticket!.used = true;
        ledger.withdrawals.push({
          documentId: id,
          expectedVersion: body.expectedVersion,
          reason: body.reason,
          ticketId: body.confirmation.ticketId,
        });
        if (controls.conflictOnNextWithdraw) {
          controls.conflictOnNextWithdraw = false;
          controls.versions.set(id, version(id) + 1);
          return fail({
            status: 409,
            code: 'VERSION_CONFLICT',
            message: '文档版本已变化，请刷新后重新确认',
          });
        }
        expect(body.expectedVersion).toBe(version(id));
        controls.withdrawn.add(id);
        controls.versions.set(id, version(id) + 1);
        return reply({ documentVersion: version(id), publicationId: null });
      }
      if (
        /^\/api\/v1\/(?:projects\/[^/]+\/documents|knowledge-bases\/[^/]+\/documents|documents\/[^/]+(?:\/revisions(?:\/[^/]+)?)?|document-revisions\/[^/]+)$/.test(
          path,
        )
      ) {
        ledger.rejectedLegacyReads.push(path + url.search);
        return fail({
          status: 500,
          code: 'LEGACY_DOCUMENT_READ',
          message: 'Knowledge 目录不得退回全量文档或修订读取',
        });
      }
      const summaries = /^\/api\/v1\/projects\/(p[12])\/document-summaries$/.exec(path);
      if (summaries) {
        const projectId = summaries[1] as ProjectId;
        const query = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
        const status = url.searchParams.get('status') ?? 'all';
        expect(url.searchParams.get('searchProfile')).toBe('knowledge');
        expect(url.searchParams.get('limit')).toBe('50');
        expect(query.length).toBeLessThanOrEqual(100);
        expect(['all', 'candidate', 'published']).toContain(status);
        expect(
          [...url.searchParams.keys()].every((key) =>
            [
              'kind',
              'knowledgeBaseKind',
              'searchProfile',
              'q',
              'status',
              'limit',
              'cursor',
            ].includes(key),
          ),
        ).toBe(true);
        const catalogFailure = controls.catalogFailures.get(
          `${projectId}|${query}|${url.searchParams.get('cursor') ?? ''}`,
        );
        if (catalogFailure) return fail(catalogFailure);
        const items = Array.from({ length: projectId === 'p1' ? 107 : 1 }, (_, index) =>
          summary(index + 1, projectId),
        ).filter((item) => {
          if (url.searchParams.has('kind') && item.document.kind !== url.searchParams.get('kind'))
            return false;
          if (
            url.searchParams.has('knowledgeBaseKind') &&
            item.knowledgeBase.kind !== url.searchParams.get('knowledgeBaseKind')
          )
            return false;
          if (status === 'published' && !item.publishedRevision) return false;
          if (status === 'candidate' && !item.candidateRevisionCount) return false;
          if (!query) return true;
          const identity = identities.get(item.document.id)!;
          const revisions = Array.from({ length: item.visibleRevisionCount }, (_, seq) =>
            revision(identity.index, seq + 1, projectId),
          );
          return [
            item.document.kind,
            item.requirement?.code ?? '',
            item.requirement?.title ?? '',
            ...revisions.flatMap((item) => [
              item.title,
              `v${item.seq}`,
              item.state,
              item.state === 'PUBLISHED' ? '已发布' : '候选',
            ]),
          ]
            .join(' ')
            .toLowerCase()
            .includes(query);
        });
        const cursor = url.searchParams.get('cursor');
        const prefix = `catalog-${projectId}-${encodeURIComponent(query)}-${url.searchParams.get('knowledgeBaseKind') ?? ''}-${url.searchParams.get('kind') ?? ''}-${status}-`;
        expect(cursor === null || cursor.startsWith(prefix)).toBe(true);
        const offset = cursor ? Number(cursor.slice(prefix.length)) : 0;
        expect([0, 50, 100]).toContain(offset);
        return reply({
          items: items.slice(offset, offset + 50),
          nextCursor: offset + 50 < items.length ? `${prefix}${offset + 50}` : null,
          total: items.length,
        });
      }
      const singleSummary = /^\/api\/v1\/documents\/([^/]+)\/summary$/.exec(path);
      if (singleSummary) {
        const error = controls.summaryFailures.get(singleSummary[1]!);
        if (error) return fail(error);
        const identity = identities.get(singleSummary[1]!);
        expect(identity).toBeDefined();
        return reply(summary(identity!.index, identity!.projectId));
      }
      const history = /^\/api\/v1\/documents\/([^/]+)\/history$/.exec(path);
      if (history) {
        const id = history[1]!;
        const identity = identities.get(id)!;
        expect(identity).toBeDefined();
        expect(url.searchParams.get('limit')).toBe('50');
        expect([...url.searchParams.keys()].every((key) => ['limit', 'cursor'].includes(key))).toBe(
          true,
        );
        const cursor = url.searchParams.get('cursor') ?? '';
        const error = controls.historyFailures.get(`${id}|${cursor}`);
        if (error) return fail(error);
        const match = cursor ? /^history-(\d+)-(\d+)$/.exec(cursor) : null;
        if (cursor && (!match || Number(match[1]) !== version(id)))
          return fail({
            status: 409,
            code: 'RESOURCE_CONFLICT',
            message: 'HISTORY_REFRESH_REQUIRED',
          });
        const offset = match ? Number(match[2]) : 0;
        const count =
          controls.historyTotals.get(id) ??
          (identity.projectId === 'p1' && identity.index === targetIndex ? 123 : 3);
        const items = Array.from({ length: count }, (_, index) =>
          revision(identity.index, count - index, identity.projectId),
        );
        return reply({
          items: items.slice(offset, offset + 50),
          nextCursor: offset + 50 < count ? historyCursor(version(id), offset + 50) : null,
          total: count,
          documentVersion: version(id),
        });
      }
      const metadata = /^\/api\/v1\/documents\/([^/]+)\/revisions\/([^/]+)\/metadata$/.exec(path);
      if (metadata) {
        const id = metadata[2]!;
        const error = controls.metadataFailures.get(id);
        if (error) return fail(error);
        const identity = revisionIdentities.get(id);
        if (!identity || documentId(identity.index, identity.projectId) !== metadata[1])
          return fail({ status: 404, code: 'RESOURCE_NOT_FOUND', message: 'REVISION_NOT_FOUND' });
        return reply(revision(identity.index, identity.seq, identity.projectId));
      }
      const content = /^\/api\/v1\/document-revisions\/([^/]+)\/content$/.exec(path);
      if (content) {
        const id = content[1]!;
        const error = controls.contentFailures.get(id);
        if (error) return fail(error);
        const identity = revisionIdentities.get(id);
        expect(identity).toBeDefined();
        const text = `共同开头\n${identity!.projectId === 'p2' ? '另一项目正文' : identity!.seq === 2 ? '当前发布第2版' : `准确修订第${identity!.seq}版`}\n共同结尾`;
        return reply({
          revisionId: id,
          mimeType: identity!.seq === 7 ? 'text/plain' : 'text/markdown',
          encoding: 'base64',
          bodyBase64: Buffer.from(text).toString('base64'),
          byteLength: Buffer.byteLength(text),
          sha256: identity!.seq.toString(16).padStart(64, '0'),
        });
      }
      const overview = /^\/api\/v1\/projects\/(p[12])\/document-summary-overview$/.exec(path);
      if (overview) {
        const projectId = overview[1] as ProjectId;
        const error = controls.overviewFailures.get(projectId);
        if (error) return fail(error);
        const all = Array.from({ length: projectId === 'p1' ? 107 : 1 }, (_, index) =>
          summary(index + 1, projectId),
        );
        return reply({
          total: all.length,
          totalsByDocumentKind: Object.fromEntries(
            ['UNDERSTANDING', 'DECISION', 'PRD', 'KNOWLEDGE'].map((kind) => [
              kind,
              all.filter((item) => item.document.kind === kind).length,
            ]),
          ),
          collections: collectionKinds.map((knowledgeBaseKind) => {
            const items = all.filter((item) => item.knowledgeBase.kind === knowledgeBaseKind);
            return {
              knowledgeBaseKind,
              knowledgeBaseCount: items.length ? 1 : 0,
              documentCount: items.length,
              recentItems: items.slice(0, 2),
            };
          }),
        });
      }
      const bases = /^\/api\/v1\/projects\/(p[12])\/knowledge-bases$/.exec(path);
      if (bases) {
        const projectId = bases[1] as ProjectId;
        expect(url.searchParams.get('limit')).toBe('50');
        expect(url.searchParams.has('cursor')).toBe(false);
        return reply({
          items: (projectId === 'p1' ? collectionKinds : (['BUSINESS'] as const)).map(
            (baseKind) => ({
              id: `kb-${projectId}-${baseKind}`,
              projectId,
              key: baseKind,
              name: `${baseKind}验收知识库`,
              kind: baseKind,
              visibility: 'PROJECT',
              version: 1,
              authzVersion: 1,
              publicationApproverUserId: 'fixture-user',
              publicationApproverRoleId: null,
              archivedAt: null,
            }),
          ),
          hasMore: false,
          nextCursor: null,
        });
      }
      const search =
        /^\/api\/v1\/knowledge-bases\/(kb-(p[12])-(BUSINESS|SYSTEM|PRACTICE))\/search$/.exec(path);
      if (search) {
        const [knowledgeBaseId, projectId, baseKind] = search.slice(1) as [
          string,
          ProjectId,
          (typeof collectionKinds)[number],
        ];
        const q = url.searchParams.get('q') ?? '';
        const cursor = url.searchParams.get('cursor') ?? '';
        expect(q.length).toBeLessThanOrEqual(500);
        expect(url.searchParams.get('limit')).toBe('50');
        expect(
          [...url.searchParams.keys()].every((key) => ['q', 'limit', 'cursor'].includes(key)),
        ).toBe(true);
        const error = controls.searchFailures.get(`${knowledgeBaseId}|${cursor}`);
        if (error) return fail(error);
        const next = `search-${knowledgeBaseId}-${encodeURIComponent(q)}-next`;
        expect(cursor === '' || cursor === next).toBe(true);
        const index =
          projectId === 'p2'
            ? 1
            : baseKind === 'BUSINESS'
              ? cursor
                ? 2
                : 1
              : baseKind === 'SYSTEM'
                ? cursor
                  ? 71
                  : 70
                : cursor
                  ? 106
                  : 107;
        const seq = index === targetIndex ? controls.targetSearchSeq : 2;
        const item = revision(index, seq, projectId);
        return reply({
          items: [
            {
              knowledgeBaseId,
              knowledgeBaseName: `${baseKind}验收知识库`,
              knowledgeBaseKind: baseKind,
              revisionId: item.id,
              documentId: item.documentId,
              documentKind: kind(index),
              status: 'PUBLISHED',
              title: `${q}：${title(index, projectId)}命中`,
              excerpt: `正文摘录：${q}`,
              sha256: item.digest,
            },
          ],
          nextCursor: cursor ? null : next,
          hasMore: !cursor,
          truncated: controls.searchTruncated.has(knowledgeBaseId),
        });
      }
      if (/^\/api\/v1\/projects\/p[12]\/units$/.test(path))
        return reply([
          { id: 'unit-api', key: 'api', name: '接口服务', status: 'ACTIVE', repoPath: 'apps/api' },
          { id: 'unit-web', key: 'web', name: '知识门户', status: 'ACTIVE', repoPath: 'apps/web' },
        ]);
      if (/^\/api\/v1\/projects\/p[12]\/unit-dependencies$/.test(path))
        return reply([
          {
            id: 'dependency-1',
            fromUnitId: 'unit-web',
            toUnitId: 'unit-api',
            edgeKind: 'CALLS',
            protocol: 'HTTP',
            source: 'HUMAN',
            confidence: 'CONFIRMED',
            evidence: 'fixture declared dependency',
            verifiedAt: '2026-11-10T00:00:00.000Z',
          },
        ]);
      const discussions = /^\/api\/v1\/review-requests\/review-([^/]+)\/discussions$/.exec(path);
      if (discussions) {
        expect(revisionIdentities.has(discussions[1]!)).toBe(true);
        expect([...url.searchParams]).toEqual([]);
        return reply({ items: [], nextCursor: null, unresolvedCount: 0, canCreate: false });
      }
      const review = /^\/api\/v1\/review-requests\/review-([^/]+)$/.exec(path);
      if (review) {
        const identity = revisionIdentities.get(review[1]!);
        expect(identity).toBeDefined();
        const item = revision(identity!.index, identity!.seq, identity!.projectId);
        return reply({
          id: `review-${item.id}`,
          projectId: identity!.projectId,
          kind: 'KNOWLEDGE_PUBLICATION',
          status: 'OPEN',
          version: 2,
          subjectDigest: item.digest,
          documentRevisionId: item.id,
          artifactSetId: null,
          taskId: null,
          slots: [],
          decisions: [],
          subject: {
            documentId: item.documentId,
            knowledgeBaseId: kbId(identity!.index, identity!.projectId),
            documentVersion: version(item.documentId),
            currentPublishedRevisionId: revisionId(identity!.index, 2, identity!.projectId),
            revisionId: item.id,
            revisionDigest: item.digest,
          },
        });
      }
      return route.fallback();
    },
  );
  return { ledger, controls, getRequests };
}

function directory(page: Page) {
  return page.locator('.collection-document-list');
}

function directoryItems(page: Page) {
  return directory(page).locator('.collection-document-item');
}

function documentItem(page: Page, index: number, projectId: ProjectId = 'p1') {
  return directoryItems(page).filter({ hasText: title(index, projectId) });
}

function governance(page: Page) {
  return page.locator('.knowledge-governance-panel');
}

function history(page: Page) {
  return governance(page).getByRole('table');
}

function revisionRow(page: Page, seq: number): Locator {
  return history(page)
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: `v${seq}`, exact: true }) });
}

const overviewPath = (projectId: ProjectId = 'p1') =>
  `/api/v1/projects/${projectId}/document-summary-overview`;
const singleSummaryPath = (id = targetId) => `/api/v1/documents/${id}/summary`;
const searchPath = (baseKind: (typeof collectionKinds)[number], projectId: ProjectId = 'p1') =>
  `/api/v1/knowledge-bases/kb-${projectId}-${baseKind}/search`;

async function visitKnowledge(page: Page) {
  await page.goto('/knowledge?projectId=p1');
  await expect(directoryItems(page)).toHaveCount(50);
}

async function openTarget(page: Page) {
  await visitKnowledge(page);
  await page.getByRole('textbox', { name: '搜索文档', exact: true }).fill(earlySearch);
  await expect(directoryItems(page)).toHaveCount(1);
  await documentItem(page, targetIndex)
    .getByRole('button', { name: '查看版本', exact: true })
    .click();
  await expect(page.getByText('已加载 50 / 123 条历史', { exact: true })).toBeVisible();
  await expect(governance(page)).toContainText('122 个候选待处理');
}

async function readExactPair(page: Page, oldSeq: number, newSeq: number) {
  await page
    .getByRole('textbox', { name: '比较旧修订 ID', exact: true })
    .fill(targetRevision(oldSeq));
  await page
    .getByRole('textbox', { name: '比较新修订 ID', exact: true })
    .fill(targetRevision(newSeq));
  await page.getByRole('button', { name: '读取比较版本', exact: true }).click();
}

function getQuery(fixture: Awaited<ReturnType<typeof installKnowledgeFixtures>>, pathname: string) {
  const entry = fixture.getRequests(pathname).at(-1);
  expect(entry).toBeDefined();
  return new URL(entry!.path, 'http://fixture').searchParams;
}

async function waitForRead(page: Page, pathname: string, query: Record<string, string> = {}) {
  return page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === pathname &&
      Object.entries(query).every(([key, value]) => url.searchParams.get(key) === value)
    );
  });
}

function bodyReader(page: Page) {
  return page.locator('.knowledge-workspace-reader');
}

function searchHit(page: Page, index = targetIndex) {
  return page.locator('.knowledge-search-result').filter({ hasText: `${title(index)}命中` });
}

async function expectNoMoreReads(
  page: Page,
  fixture: Awaited<ReturnType<typeof installKnowledgeFixtures>>,
  pathname: string,
  expected: number,
) {
  await afterBrowserPaint(page);
  expect(fixture.getRequests(pathname)).toHaveLength(expected);
}

test.afterEach(async ({ page }, testInfo) => {
  const ledger = ledgers.get(page);
  if (!ledger) return;
  ledgers.delete(page);
  await testInfo.attach('knowledge-summary-history-network-ledger', {
    body: JSON.stringify(ledger, null, 2),
    contentType: 'application/json',
  });
  expect(ledger.rejectedLegacyReads, 'Knowledge 目录、历史和精确修订只能使用有界读取入口').toEqual(
    [],
  );
  expect(ledger.rejectedWrites, '浏览、搜索与比较不能产生写入').toEqual([]);
  expect(JSON.stringify(ledger), '网络账本只保留绑定与结果，不保留密码或票据秘密').not.toContain(
    'fixture-password',
  );
  expect(JSON.stringify(ledger)).not.toContain('fixture-ticket-secret');
});

for (const width of [1440, 390]) {
  test(`${width}px 门户用独立overview展示107份文档三类准确计数与每类最近两项，目录不自动读历史`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await visitKnowledge(page);
    const overview = page.getByTestId('knowledge-overview');
    await expect(overview.locator('.knowledge-collection-card')).toHaveCount(3);
    for (const [index, count] of [36, 36, 35].entries()) {
      const card = overview.locator('.knowledge-collection-card').nth(index);
      await expect(card).toContainText(collectionTitles[index]!);
      await expect(card).toContainText(`${count} 篇可浏览文档`);
      await expect(card).toContainText('1 个知识库');
      await card.locator('summary').click();
      await expect(card.locator('.knowledge-featured-item')).toHaveCount(2);
      const first = [1, 37, 73][index]!;
      await expect(card.locator('.knowledge-featured-item').nth(0)).toContainText(title(first));
      await expect(card.locator('.knowledge-featured-item').nth(1)).toContainText(title(first + 1));
    }
    expect(fixture.getRequests(overviewPath())).toHaveLength(1);
    expect(fixture.getRequests(summaryPath())).toHaveLength(1);
    expect(fixture.ledger.requests.filter((entry) => entry.path.includes('/history'))).toEqual([]);
    expect(fixture.ledger.requests.filter((entry) => entry.path.endsWith('/content'))).toEqual([]);
    await expect(governance(page)).toHaveCount(0);
    await expect(page.locator('.knowledge-agent-guide')).toHaveCount(0);
  });

  test(`${width}px 目录50/50/7按需翻页且搜索早期修订和类型集合走服务端，100字符不截断`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await visitKnowledge(page);
    await expect(page.getByRole('heading', { name: /文档.*当前页 50.*共 107/ })).toBeVisible();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(directoryItems(page)).toHaveCount(50);
    await expect(directory(page)).toContainText(title(51));
    await expect(directory(page)).not.toContainText(title(1));
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(directoryItems(page)).toHaveCount(7);
    await expect(directory(page)).toContainText(title(targetIndex));
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    expect(fixture.getRequests(summaryPath())).toHaveLength(3);
    expect(getQuery(fixture, summaryPath()).get('cursor')).toBe('catalog-p1----all-100');
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    await expect(directory(page)).toContainText(title(51));
    const query = page.getByRole('textbox', { name: '搜索文档', exact: true });
    await query.fill(earlySearch);
    await expect(directoryItems(page)).toHaveCount(1);
    expect(getQuery(fixture, summaryPath()).get('q')).toBe(earlySearch);
    expect(getQuery(fixture, summaryPath()).has('cursor')).toBe(false);
    await page
      .getByRole('combobox', { name: '文档类型筛选', exact: true })
      .selectOption('KNOWLEDGE');
    await expect.poll(() => getQuery(fixture, summaryPath()).get('kind')).toBe('KNOWLEDGE');
    await query.fill('');
    await page.getByRole('combobox', { name: '文档类型筛选', exact: true }).selectOption('');
    await expect(directoryItems(page)).toHaveCount(50);
    await page
      .locator('.knowledge-collection-card')
      .nth(2)
      .locator('.knowledge-collection-card-main')
      .click();
    await expect(directoryItems(page)).toHaveCount(35);
    expect(getQuery(fixture, summaryPath()).get('knowledgeBaseKind')).toBe('PRACTICE');
    await page.getByRole('button', { name: '移除角色实践库范围', exact: true }).click();
    await expect(directoryItems(page)).toHaveCount(50);
    await query.fill('a'.repeat(100));
    await expect.poll(() => getQuery(fixture, summaryPath()).get('q')).toBe('a'.repeat(100));
    const before = fixture.getRequests(summaryPath()).length;
    await query.fill('b'.repeat(101));
    await expect(
      page.getByText('搜索词最多 100 个字符，请缩短后重试。', { exact: false }).first(),
    ).toBeVisible();
    await expect(query).toHaveValue('b'.repeat(101));
    await expectNoMoreReads(page, fixture, summaryPath(), before);
    expect(fixture.ledger.requests.filter((entry) => entry.path.includes('/history'))).toEqual([]);
  });

  test(`${width}px 门户503不回退当前页计数，重试恢复且目录故障不阻断独立正文搜索`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    fixture.controls.overviewFailures.set('p1', {
      status: 503,
      code: 'OVERVIEW_UNAVAILABLE',
      message: '门户统计暂不可用',
    });
    await page.setViewportSize({ width, height: 1000 });
    await visitKnowledge(page);
    await expect(page.getByRole('alert').filter({ hasText: '门户统计暂不可用' })).toBeVisible();
    await expect(page.getByTestId('knowledge-overview')).not.toContainText('50 篇可浏览文档');
    await expect(page.getByTestId('knowledge-agent-guide')).toHaveCount(0);
    await page.getByRole('textbox', { name: '搜索项目知识', exact: true }).fill('独立正文');
    await expect(page.locator('.knowledge-search-result')).toHaveCount(3);
    fixture.controls.overviewFailures.delete('p1');
    await page.getByRole('button', { name: '重新读取门户', exact: true }).click();
    await expect(
      page.getByTestId('knowledge-overview').locator('.knowledge-collection-docs').nth(2),
    ).toContainText('35');
    fixture.controls.overviewFailures.set('p1', {
      status: 503,
      code: 'OVERVIEW_UNAVAILABLE',
      message: '门户刷新暂不可用',
    });
    await page.getByRole('button', { name: '重新读取门户', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '门户刷新暂不可用' })).toContainText(
      '统计可能已过期，当前保留上次成功结果。',
    );
    await expect(
      page.getByTestId('knowledge-overview').locator('.knowledge-collection-docs').nth(2),
    ).toContainText('35');
    fixture.controls.overviewFailures.delete('p1');
    fixture.controls.catalogFailures.set('p1|目录故障|', {
      status: 503,
      code: 'CATALOG_UNAVAILABLE',
      message: '目录暂不可用',
    });
    await page.getByRole('textbox', { name: '搜索文档', exact: true }).fill('目录故障');
    await expect(page.getByRole('alert').filter({ hasText: '目录暂不可用' }).first()).toBeVisible();
    await page.getByRole('textbox', { name: '搜索项目知识', exact: true }).fill('目录失败仍能搜索');
    await expect(searchHit(page)).toContainText('目录失败仍能搜索');
    expect(fixture.getRequests(searchPath('PRACTICE')).length).toBeGreaterThan(1);
  });

  test(`${width}px 123条历史按50/100/123读取且发布r2独立，精确r2/r7比较不扩大历史`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await expect(history(page).locator('tbody tr')).toHaveCount(50);
    await expect(revisionRow(page, 123)).toBeVisible();
    await expect(revisionRow(page, 2)).toHaveCount(0);
    await expect(page.getByTestId('knowledge-current-publication')).toContainText('v2');
    await page.getByRole('button', { name: '查看当前发布', exact: true }).click();
    await expect(bodyReader(page)).toContainText('当前发布第2版');
    expect(fixture.getRequests(metadataPath(targetRevision(2))).length).toBeGreaterThanOrEqual(1);
    expect(fixture.getRequests(contentPath(targetRevision(123)))).toHaveLength(0);
    await readExactPair(page, 2, 7);
    await expect(page.getByRole('combobox', { name: '对比旧版本', exact: true })).toHaveValue(
      targetRevision(2),
    );
    await expect(page.getByRole('combobox', { name: '对比新版本', exact: true })).toHaveValue(
      targetRevision(7),
    );
    await page.getByRole('button', { name: '对比所选版本', exact: true }).click();
    await expect(page.getByTestId('knowledge-diff')).toContainText('当前发布第2版');
    await expect(page.getByTestId('knowledge-diff')).toContainText('准确修订第7版');
    await expect(page.getByText('已加载 50 / 123 条历史', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(page.getByText('已加载 100 / 123 条历史', { exact: true })).toBeVisible();
    await expect(history(page).locator('tbody tr')).toHaveCount(100);
    await expect(page.getByRole('combobox', { name: '对比旧版本', exact: true })).toHaveValue(
      targetRevision(2),
    );
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(page.getByText('已加载 123 / 123 条历史', { exact: true })).toBeVisible();
    const sequence = await history(page).locator('tbody tr td:first-child').allTextContents();
    expect(sequence.map((value) => Number(value.trim().slice(1)))).toEqual(
      Array.from({ length: 123 }, (_, index) => 123 - index),
    );
    expect(new Set(sequence).size).toBe(123);
    expect(
      fixture
        .getRequests(historyPath())
        .map((entry) => new URL(entry.path, 'http://fixture').searchParams.get('cursor')),
    ).toEqual([null, historyCursor(17, 50), historyCursor(17, 100)]);
    await revisionRow(page, 7)
      .getByRole('button', { name: /^查看正文/ })
      .click();
    await expect(bodyReader(page)).toContainText('准确修订第7版');
    await governance(page).locator('.knowledge-source-panel > summary').click();
    await expect(governance(page).locator('.knowledge-source-panel')).toContainText(
      `未加载（${revisionId(1, 3)}） · 引用可能属于其他文档，未加载不代表不存在。`,
    );
    expect(
      fixture.ledger.requests.filter((entry) =>
        entry.path.includes(`/revisions/${revisionId(1, 3)}/metadata`),
      ),
    ).toHaveLength(0);
  });

  test(`${width}px 历史续页503保留已读50条并用相同游标重试，不把错误解释为读完`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    const key = `${targetId}|${historyCursor(17, 50)}`;
    fixture.controls.historyFailures.set(key, {
      status: 503,
      code: 'HISTORY_UNAVAILABLE',
      message: '历史续页暂不可用',
    });
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: '历史续页暂不可用' }).first(),
    ).toBeVisible();
    await expect(page.getByText('已加载 50 / 123 条历史', { exact: true })).toBeVisible();
    await expect(history(page).locator('tbody tr')).toHaveCount(50);
    fixture.controls.historyFailures.delete(key);
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(page.getByText('已加载 100 / 123 条历史', { exact: true })).toBeVisible();
    expect(
      fixture
        .getRequests(historyPath())
        .map((entry) => new URL(entry.path, 'http://fixture').searchParams.get('cursor')),
    ).toEqual([null, historyCursor(17, 50), historyCursor(17, 50)]);
  });

  test(`${width}px 历史409废弃旧续页并要求刷新，版本18不能接到版本17缓存`, async ({ page }) => {
    const fixture = await installKnowledgeFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    fixture.controls.versions.set(targetId, 18);
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'HISTORY_REFRESH_REQUIRED' }).first(),
    ).toBeVisible();
    await expect(page.getByText('已加载 50 / 123 条历史', { exact: true })).toBeVisible();
    const loadMore = page.getByRole('button', { name: '加载更多历史', exact: true });
    expect((await loadMore.count()) === 0 || (await loadMore.isDisabled())).toBe(true);
    const before = fixture.getRequests(historyPath()).length;
    await expectNoMoreReads(page, fixture, historyPath(), before);
    await page.getByRole('button', { name: '刷新历史', exact: true }).click();
    await expect(page.getByText('已加载 50 / 123 条历史', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'HISTORY_REFRESH_REQUIRED' }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(page.getByText('已加载 100 / 123 条历史', { exact: true })).toBeVisible();
    expect(
      fixture
        .getRequests(historyPath())
        .map((entry) => new URL(entry.path, 'http://fixture').searchParams.get('cursor')),
    ).toEqual([null, historyCursor(17, 50), null, historyCursor(18, 50)]);
  });

  test(`${width}px 相同文档版本total变动不混合旧页，刷新后按当前122条重新计数`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    fixture.controls.historyTotals.set(targetId, 122);
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'HISTORY_REFRESH_REQUIRED' }).first(),
    ).toBeVisible();
    await expect(history(page).locator('tbody tr')).toHaveCount(50);
    await expect(revisionRow(page, 73)).toHaveCount(0);
    await page.getByRole('button', { name: '刷新历史', exact: true }).click();
    await expect(page.getByText('已加载 50 / 122 条历史', { exact: true })).toBeVisible();
    await expect(revisionRow(page, 123)).toHaveCount(0);
    await expect(revisionRow(page, 122)).toBeVisible();
    expect(fixture.getRequests(historyPath())).toHaveLength(3);
  });

  test(`${width}px 精确修订404清除旧正文差异与历史可操作缓存，不换成当前发布`, async ({ page }) => {
    const fixture = await installKnowledgeFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await readExactPair(page, 2, 7);
    await page.getByRole('button', { name: '对比所选版本', exact: true }).click();
    await expect(page.getByTestId('knowledge-diff')).toContainText('准确修订第7版');
    fixture.controls.metadataFailures.set(targetRevision(8), {
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      message: 'REVISION_NOT_FOUND',
    });
    const before = fixture.ledger.requests.filter((entry) =>
      entry.path.endsWith('/content'),
    ).length;
    await readExactPair(page, 8, 9);
    await expect(
      page.getByRole('alert').filter({ hasText: 'REVISION_NOT_FOUND' }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('knowledge-diff')).toHaveCount(0);
    await expect(bodyReader(page)).toHaveCount(0);
    await expect(revisionRow(page, 123)).toHaveCount(0);
    expect(fixture.ledger.requests.filter((entry) => entry.path.endsWith('/content'))).toHaveLength(
      before,
    );
    expect(fixture.getRequests(contentPath(targetRevision(8)))).toHaveLength(0);
    expect(fixture.getRequests(contentPath(targetRevision(9)))).toHaveLength(0);
  });

  test(`${width}px 正文403清除旧阅读和差异且不得继续使用失权修订操作`, async ({ page }) => {
    const fixture = await installKnowledgeFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await page.getByRole('button', { name: '查看当前发布', exact: true }).click();
    await expect(bodyReader(page)).toContainText('当前发布第2版');
    fixture.controls.contentFailures.set(targetRevision(123), {
      status: 403,
      code: 'FORBIDDEN',
      message: 'REVISION_ACCESS_REVOKED',
    });
    await revisionRow(page, 123)
      .getByRole('button', { name: /^查看正文/ })
      .click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'REVISION_ACCESS_REVOKED' }).first(),
    ).toBeVisible();
    await expect(bodyReader(page)).toHaveCount(0);
    await expect(page.getByTestId('knowledge-diff')).toHaveCount(0);
    await expect(revisionRow(page, 123)).toHaveCount(0);
  });

  test(`${width}px 正文搜索500字符独立限制与每KB游标、truncated和部分失败保持，命中目录外版本不扩目录`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    const business = 'kb-p1-BUSINESS';
    const system = 'kb-p1-SYSTEM';
    const practice = 'kb-p1-PRACTICE';
    const query = '关'.repeat(500);
    fixture.controls.searchFailures.set(`${system}|`, {
      status: 503,
      code: 'SEARCH_UNAVAILABLE',
      message: '系统知识搜索失败',
    });
    fixture.controls.searchTruncated.add(business);
    await page.setViewportSize({ width, height: 1000 });
    await visitKnowledge(page);
    const input = page.getByRole('textbox', { name: '搜索项目知识', exact: true });
    await input.fill(query);
    await expect(page.locator('.knowledge-search-result')).toHaveCount(2);
    await expect(page.locator('.knowledge-search-results')).toContainText('当前结果可能不完整');
    await expect(page.locator('.knowledge-search-results')).toContainText('达到扫描范围');
    expect(getQuery(fixture, searchPath('PRACTICE')).get('q')).toBe(query);
    expect(fixture.getRequests(summaryPath())).toHaveLength(1);
    const businessCursor = `search-${business}-${encodeURIComponent(query)}-next`;
    fixture.controls.searchFailures.set(`${business}|${businessCursor}`, {
      status: 503,
      code: 'SEARCH_PAGE_UNAVAILABLE',
      message: '业务知识续页失败',
    });
    await page.getByRole('button', { name: '加载更多结果', exact: true }).click();
    await expect(page.locator('.knowledge-search-result')).toHaveCount(3);
    await expect(page.locator('.knowledge-search-results')).toContainText('当前结果可能不完整');
    expect(fixture.getRequests(searchPath('PRACTICE'))).toHaveLength(2);
    fixture.controls.searchFailures.delete(`${business}|${businessCursor}`);
    await page.getByRole('button', { name: '加载更多结果', exact: true }).click();
    await expect(page.locator('.knowledge-search-result')).toHaveCount(4);
    expect(fixture.getRequests(searchPath('PRACTICE'))).toHaveLength(2);
    expect(
      fixture
        .getRequests(searchPath('BUSINESS'))
        .map((entry) => new URL(entry.path, 'http://fixture').searchParams.get('cursor')),
    ).toEqual([null, businessCursor, businessCursor]);
    expect(fixture.getRequests(searchPath('SYSTEM'))).toHaveLength(1);
    for (const baseKind of ['BUSINESS', 'PRACTICE'] as const) {
      const params = getQuery(fixture, searchPath(baseKind));
      expect(params.get('cursor')).toBe(
        `search-kb-p1-${baseKind}-${encodeURIComponent(query)}-next`,
      );
    }
    await expect(page.getByRole('button', { name: '加载更多结果', exact: true })).toHaveCount(0);
    const before = fixture.ledger.requests.filter((entry) =>
      entry.path.includes('/search?'),
    ).length;
    await input.fill('长'.repeat(501));
    await expect(page.locator('.knowledge-search-results')).toContainText('500');
    await expect(input).toHaveValue('长'.repeat(501));
    // Cross the existing 250ms search debounce before proving no truncated query was sent.
    await page.waitForTimeout(350);
    expect(fixture.ledger.requests.filter((entry) => entry.path.includes('/search?'))).toHaveLength(
      before,
    );
    fixture.controls.searchFailures.delete(`${system}|`);
    fixture.controls.targetSearchSeq = 7;
    await page.getByRole('textbox', { name: '搜索文档', exact: true }).fill(title(1));
    await expect(directoryItems(page)).toHaveCount(1);
    await page
      .getByRole('combobox', { name: '知识搜索范围', exact: true })
      .selectOption('PRACTICE');
    await input.fill('目录外准确命中');
    await expect(page.locator('.knowledge-search-result')).toHaveCount(1);
    expect(getQuery(fixture, searchPath('PRACTICE')).has('cursor')).toBe(false);
    await page.getByRole('combobox', { name: '知识搜索范围', exact: true }).selectOption('');
    await expect(page.locator('.knowledge-search-result')).toHaveCount(3);
    await searchHit(page).click();
    await expect(bodyReader(page)).toContainText('准确修订第7版');
    expect(fixture.getRequests(singleSummaryPath())).toHaveLength(1);
    expect(fixture.getRequests(metadataPath(targetRevision(7)))).toHaveLength(1);
    await expect(page.getByText(/不在当前结果页/).first()).toBeVisible();
    await page.getByRole('button', { name: /返回角色实践库/ }).click();
    await expect(directoryItems(page)).toHaveCount(0);
    await page.getByRole('textbox', { name: '搜索文档', exact: true }).fill('');
    await expect(directoryItems(page)).toHaveCount(35);
    await page.getByRole('button', { name: '移除角色实践库范围', exact: true }).click();
    await expect(directoryItems(page)).toHaveCount(50);
    await expect(directory(page)).not.toContainText(title(targetIndex));
    await expect(page.getByRole('heading', { name: /文档.*当前页 50.*共 107/ })).toBeVisible();
    expect(
      fixture.ledger.requests.filter((entry) =>
        entry.path.includes(`/knowledge-bases/${practice}/search`),
      ).length,
    ).toBeGreaterThan(1);
  });

  test(`${width}px 正文搜索命中的准确版本404明确失败，不能读取发布版作为替代`, async ({ page }) => {
    const fixture = await installKnowledgeFixtures(page);
    fixture.controls.targetSearchSeq = 7;
    fixture.controls.metadataFailures.set(targetRevision(7), {
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      message: 'SEARCH_HIT_NO_LONGER_VISIBLE',
    });
    await page.setViewportSize({ width, height: 1000 });
    await visitKnowledge(page);
    await page.getByRole('textbox', { name: '搜索项目知识', exact: true }).fill('不可读命中');
    await expect(searchHit(page)).toHaveCount(1);
    await searchHit(page).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'SEARCH_HIT_NO_LONGER_VISIBLE' }).first(),
    ).toBeVisible();
    await expect(bodyReader(page)).toHaveCount(0);
    expect(fixture.getRequests(contentPath(targetRevision(7)))).toHaveLength(0);
    expect(fixture.getRequests(contentPath(targetRevision(2)))).toHaveLength(0);
    expect(fixture.getRequests(contentPath(targetRevision(123)))).toHaveLength(0);
  });

  test(`${width}px 目录与正文搜索查询改变后迟到旧响应不覆盖结果，也不追读旧游标`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    const oldCatalog = latch();
    const oldSearch = latch();
    await page.setViewportSize({ width, height: 1000 });
    try {
      await visitKnowledge(page);
      fixture.controls.gates.push({
        pathname: summaryPath(),
        query: { q: '知识' },
        ready: oldCatalog.ready,
      });
      for (const baseKind of collectionKinds)
        fixture.controls.gates.push({
          pathname: searchPath(baseKind),
          query: { q: '旧正文查询' },
          ready: oldSearch.ready,
        });
      const catalogRequest = waitForRead(page, summaryPath(), { q: '知识' });
      const searchRequests = collectionKinds.map((baseKind) =>
        waitForRead(page, searchPath(baseKind), { q: '旧正文查询' }),
      );
      await page.getByRole('textbox', { name: '搜索文档', exact: true }).fill('知识');
      await expect.poll(() => fixture.controls.gates.filter((gate) => gate.used).length).toBe(1);
      await page.getByRole('textbox', { name: '搜索项目知识', exact: true }).fill('旧正文查询');
      await expect.poll(() => fixture.controls.gates.filter((gate) => gate.used).length).toBe(4);
      await page.getByRole('textbox', { name: '搜索文档', exact: true }).fill(earlySearch);
      await expect(directoryItems(page)).toHaveCount(1);
      await page.getByRole('textbox', { name: '搜索项目知识', exact: true }).fill('新正文查询');
      await expect(page.locator('.knowledge-search-result')).toHaveCount(3);
      await expect(searchHit(page)).toContainText('新正文查询');
      const before = fixture.ledger.requests.length;
      oldCatalog.release();
      oldSearch.release();
      await finishOrAbort(await catalogRequest);
      for (const request of searchRequests) await finishOrAbort(await request);
      await afterBrowserPaint(page);
      await expect(directoryItems(page)).toHaveCount(1);
      await expect(directory(page)).toContainText(title(targetIndex));
      await expect(searchHit(page)).toContainText('新正文查询');
      await expect(page.locator('.knowledge-search-results')).not.toContainText('旧正文查询');
      expect(fixture.ledger.requests).toHaveLength(before);
    } finally {
      oldCatalog.release();
      oldSearch.release();
    }
  });

  test(`${width}px 切项目隔离迟到目录门户历史和正文，另一项目不自动读历史`, async ({ page }) => {
    const fixture = await installKnowledgeFixtures(page);
    const old = latch();
    await page.setViewportSize({ width, height: 1000 });
    try {
      await openTarget(page);
      const paths: Array<{ pathname: string; query?: Record<string, string> }> = [
        { pathname: summaryPath(), query: { q: '知识' } },
        { pathname: overviewPath() },
        { pathname: historyPath(), query: { cursor: historyCursor(17, 50) } },
        { pathname: contentPath(targetRevision(2)) },
      ];
      for (const item of paths) fixture.controls.gates.push({ ...item, ready: old.ready });
      const requests = paths.map((item) => waitForRead(page, item.pathname, item.query));
      await page.getByRole('button', { name: '查看当前发布', exact: true }).click();
      await expect.poll(() => fixture.getRequests(contentPath(targetRevision(2))).length).toBe(1);
      await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
      await expect.poll(() => fixture.getRequests(historyPath()).length).toBe(2);
      await page.getByRole('button', { name: '重新读取门户', exact: true }).click();
      await expect.poll(() => fixture.getRequests(overviewPath()).length).toBe(2);
      await page.getByRole('textbox', { name: '搜索文档', exact: true }).fill('知识');
      await expect.poll(() => fixture.controls.gates.filter((gate) => gate.used).length).toBe(4);
      await page.getByRole('combobox', { name: '选择项目', exact: true }).selectOption('p2');
      await expect(page).toHaveURL(/projectId=p2/);
      await expect(directoryItems(page)).toHaveCount(1);
      await expect(directory(page)).toContainText(title(1, 'p2'));
      await expect(
        page.getByTestId('knowledge-overview').locator('.knowledge-collection-docs').nth(0),
      ).toContainText('1');
      await expect(governance(page)).toHaveCount(0);
      const before = fixture.ledger.requests.length;
      old.release();
      for (const request of requests) await finishOrAbort(await request);
      await afterBrowserPaint(page);
      await expect(directoryItems(page)).toHaveCount(1);
      await expect(directory(page)).toContainText(title(1, 'p2'));
      await expect(page.getByTestId('knowledge-overview')).not.toContainText('36 篇可浏览文档');
      await expect(governance(page)).toHaveCount(0);
      await expect(bodyReader(page)).toHaveCount(0);
      await expect(page.getByTestId('knowledge-diff')).toHaveCount(0);
      expect(fixture.getRequests(historyPath(documentId(1, 'p2')))).toHaveLength(0);
      expect(fixture.ledger.requests).toHaveLength(before);
    } finally {
      old.release();
    }
  });

  test(`${width}px 换文档后迟到历史续页和精确metadata不恢复旧选择或扩充新历史`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    const old = latch();
    await page.setViewportSize({ width, height: 1000 });
    try {
      await openTarget(page);
      fixture.controls.gates.push({ pathname: metadataPath(targetRevision(7)), ready: old.ready });
      fixture.controls.gates.push({
        pathname: historyPath(),
        query: { cursor: historyCursor(17, 50) },
        ready: old.ready,
      });
      const metadataRequest = waitForRead(page, metadataPath(targetRevision(7)));
      const historyRequest = waitForRead(page, historyPath(), { cursor: historyCursor(17, 50) });
      await readExactPair(page, 7, 8);
      await expect.poll(() => fixture.getRequests(metadataPath(targetRevision(7))).length).toBe(1);
      await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
      await expect.poll(() => fixture.getRequests(historyPath()).length).toBe(2);
      await page.getByRole('textbox', { name: '搜索文档', exact: true }).fill('');
      await expect(directoryItems(page)).toHaveCount(50);
      await documentItem(page, 1).getByRole('button', { name: '查看版本', exact: true }).click();
      await expect(page.getByText('已加载 3 / 3 条历史', { exact: true })).toBeVisible();
      await expect(history(page)).toContainText(title(1));
      const before = fixture.ledger.requests.length;
      old.release();
      await finishOrAbort(await metadataRequest);
      await finishOrAbort(await historyRequest);
      await afterBrowserPaint(page);
      await expect(history(page).locator('tbody tr')).toHaveCount(3);
      await expect(history(page)).not.toContainText(title(targetIndex));
      await expect(page.getByRole('combobox', { name: '对比旧版本', exact: true })).not.toHaveValue(
        targetRevision(7),
      );
      await expect(page.getByRole('combobox', { name: '对比新版本', exact: true })).not.toHaveValue(
        targetRevision(8),
      );
      await expect(bodyReader(page)).toHaveCount(0);
      expect(fixture.ledger.requests).toHaveLength(before);
    } finally {
      old.release();
    }
  });

  test(`${width}px 换文档后迟到旧正文不替换当前文档准确发布内容`, async ({ page }) => {
    const fixture = await installKnowledgeFixtures(page);
    const old = latch();
    await page.setViewportSize({ width, height: 1000 });
    try {
      await openTarget(page);
      fixture.controls.gates.push({ pathname: contentPath(targetRevision(2)), ready: old.ready });
      const request = waitForRead(page, contentPath(targetRevision(2)));
      await page.getByRole('button', { name: '查看当前发布', exact: true }).click();
      await expect.poll(() => fixture.getRequests(contentPath(targetRevision(2))).length).toBe(1);
      await page.getByRole('textbox', { name: '搜索文档', exact: true }).fill('');
      await expect(directoryItems(page)).toHaveCount(50);
      await documentItem(page, 1).getByRole('button', { name: '查看版本', exact: true }).click();
      await expect(page.getByText('已加载 3 / 3 条历史', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '查看当前发布', exact: true }).click();
      await expect(bodyReader(page)).toContainText(title(1));
      await expect(bodyReader(page)).toContainText('当前发布第2版');
      old.release();
      await finishOrAbort(await request);
      await afterBrowserPaint(page);
      await expect(bodyReader(page)).toContainText(title(1));
      await expect(bodyReader(page)).not.toContainText(title(targetIndex));
      await expect(history(page)).toContainText(title(1));
      expect(fixture.getRequests(contentPath(revisionId(1, 2)))).toHaveLength(1);
    } finally {
      old.release();
    }
  });

  test(`${width}px 比较选择改变后迟到旧正文不恢复旧差异`, async ({ page }) => {
    const fixture = await installKnowledgeFixtures(page);
    const old = latch();
    await page.setViewportSize({ width, height: 1000 });
    try {
      await openTarget(page);
      await readExactPair(page, 2, 7);
      await expect(page.getByRole('combobox', { name: '对比新版本', exact: true })).toHaveValue(
        targetRevision(7),
      );
      fixture.controls.gates.push({ pathname: contentPath(targetRevision(7)), ready: old.ready });
      const request = waitForRead(page, contentPath(targetRevision(7)));
      await page.getByRole('button', { name: '对比所选版本', exact: true }).click();
      await expect.poll(() => fixture.getRequests(contentPath(targetRevision(7))).length).toBe(1);
      await page
        .getByRole('combobox', { name: '对比新版本', exact: true })
        .selectOption(targetRevision(123));
      old.release();
      await finishOrAbort(await request);
      await afterBrowserPaint(page);
      await expect(page.getByRole('combobox', { name: '对比新版本', exact: true })).toHaveValue(
        targetRevision(123),
      );
      await expect(bodyReader(page)).toHaveCount(0);
      await expect(page.getByTestId('knowledge-diff')).toHaveCount(0);
      await page.getByRole('button', { name: '对比所选版本', exact: true }).click();
      await expect(page.getByTestId('knowledge-diff')).toContainText('准确修订第123版');
      await expect(page.getByTestId('knowledge-diff')).not.toContainText('准确修订第7版');
    } finally {
      old.release();
    }
  });

  test(`${width}px 搜索结果打开的概要迟到在新搜索后失效，不重开旧命中`, async ({ page }) => {
    const fixture = await installKnowledgeFixtures(page);
    const old = latch();
    await page.setViewportSize({ width, height: 1000 });
    try {
      await visitKnowledge(page);
      await page.getByRole('textbox', { name: '搜索项目知识', exact: true }).fill('旧命中');
      await expect(searchHit(page)).toHaveCount(1);
      fixture.controls.gates.push({ pathname: singleSummaryPath(), ready: old.ready });
      const request = waitForRead(page, singleSummaryPath());
      await searchHit(page).click();
      await expect.poll(() => fixture.getRequests(singleSummaryPath()).length).toBe(1);
      await page.getByRole('textbox', { name: '搜索项目知识', exact: true }).fill('新命中');
      await expect(searchHit(page, 1)).toContainText('新命中');
      await searchHit(page, 1).click();
      await expect(bodyReader(page)).toContainText(title(1));
      const before = fixture.ledger.requests.length;
      old.release();
      await finishOrAbort(await request);
      await afterBrowserPaint(page);
      await expect(bodyReader(page)).toContainText(title(1));
      await expect(bodyReader(page)).not.toContainText(title(targetIndex));
      expect(fixture.getRequests(contentPath(targetRevision(2)))).toHaveLength(0);
      expect(fixture.ledger.requests).toHaveLength(before);
    } finally {
      old.release();
    }
  });

  test(`${width}px 第二页历史中的候选能进入准确评审，读取不需要写入`, async ({ page }) => {
    const fixture = await installKnowledgeFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(page.getByText('已加载 100 / 123 条历史', { exact: true })).toBeVisible();
    const reviewPath = `/api/v1/review-requests/review-${targetRevision(73)}`;
    const reviewResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === reviewPath && response.request().method() === 'GET',
    );
    await revisionRow(page, 73).getByRole('button', { name: '进入评审', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/reviews/review-${targetRevision(73)}$`));
    await expect.poll(() => fixture.getRequests(reviewPath).length).toBe(1);
    expect(await (await reviewResponse).json()).toMatchObject({
      data: {
        id: `review-${targetRevision(73)}`,
        documentRevisionId: targetRevision(73),
        subject: {
          documentId: targetId,
          revisionId: targetRevision(73),
          currentPublishedRevisionId: targetRevision(2),
        },
      },
    });
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: `${title(targetIndex)} · 修订 73`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('.req-head').getByText('知识发布', { exact: true })).toBeVisible();
    await expect(page.locator('pre.paper-content')).toHaveText(
      '共同开头\n准确修订第73版\n共同结尾',
    );
    expect(fixture.getRequests(metadataPath(targetRevision(73)))).toHaveLength(1);
    expect(fixture.getRequests(contentPath(targetRevision(73)))).toHaveLength(1);
    expect(fixture.getRequests(contentPath(targetRevision(2)))).toHaveLength(1);
    await expect(
      page
        .getByRole('region', { name: '结构化评审问题', exact: true })
        .getByText('没有本轮问题或此前轮次的未解决问题。', { exact: true }),
    ).toBeVisible();
    expect(fixture.getRequests(`${reviewPath}/discussions`)).toHaveLength(1);
    expect(fixture.ledger.previews).toEqual([]);
    expect(fixture.ledger.ticketBindings).toEqual([]);
    expect(fixture.ledger.withdrawals).toEqual([]);
  });

  test(`${width}px r2撤销沿用原因绑定一次性票据和CAS，冲突刷新重新确认后四源刷新清正文差异`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    fixture.controls.allowWithdraw = true;
    fixture.controls.conflictOnNextWithdraw = true;
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await readExactPair(page, 2, 7);
    await page.getByRole('button', { name: '对比所选版本', exact: true }).click();
    await expect(page.getByTestId('knowledge-diff')).toContainText('准确修订第7版');
    async function confirmWithdrawal() {
      await page
        .getByTestId('knowledge-current-publication')
        .getByRole('button', { name: '撤销发布', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: '撤销发布（需二次验证）', exact: true });
      await dialog.getByRole('textbox', { name: '撤销原因', exact: true }).fill('发布内容需要返修');
      await dialog.getByLabel('确认密码', { exact: true }).fill('fixture-password');
      await dialog.getByRole('button', { name: '验证密码并签发票据', exact: true }).click();
      await expect(dialog.getByText(/票据已签发，单次有效/)).toBeVisible();
      await dialog.getByRole('button', { name: '撤销发布', exact: true }).click();
      return dialog;
    }
    await confirmWithdrawal();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('alert').filter({ hasText: '文档已变化，请重新核对当前发布并确认撤销。' }),
    ).toBeVisible();
    expect(fixture.ledger.withdrawals).toEqual([
      {
        documentId: targetId,
        expectedVersion: 17,
        reason: '发布内容需要返修',
        ticketId: 'knowledge-ticket-1',
      },
    ]);
    await expect
      .poll(() => fixture.getRequests(singleSummaryPath()).length)
      .toBeGreaterThanOrEqual(1);
    await expect(page.getByText('已加载 50 / 123 条历史', { exact: true })).toBeVisible();
    await expect(
      page
        .getByTestId('knowledge-current-publication')
        .getByRole('button', { name: '撤销发布', exact: true }),
    ).toBeEnabled();
    const before = {
      summary: fixture.getRequests(singleSummaryPath()).length,
      catalog: fixture.getRequests(summaryPath()).length,
      overview: fixture.getRequests(overviewPath()).length,
      history: fixture.getRequests(historyPath()).length,
    };
    await confirmWithdrawal();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/发布已撤销/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '查看当前发布', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '撤销发布', exact: true })).toHaveCount(0);
    await expect(governance(page)).toContainText('123 个候选待处理');
    await expect(bodyReader(page)).toHaveCount(0);
    await expect(page.getByTestId('knowledge-diff')).toHaveCount(0);
    for (const [key, path] of Object.entries({
      summary: singleSummaryPath(),
      catalog: summaryPath(),
      overview: overviewPath(),
      history: historyPath(),
    })) {
      await expect
        .poll(() => fixture.getRequests(path).length)
        .toBeGreaterThan(before[key as keyof typeof before]);
    }
    expect(fixture.ledger.withdrawals[1]).toEqual({
      documentId: targetId,
      expectedVersion: 18,
      reason: '发布内容需要返修',
      ticketId: 'knowledge-ticket-2',
    });
    expect(fixture.ledger.ticketBindings.map((binding) => binding.expectedVersion)).toEqual([
      17, 18,
    ]);
    expect(
      fixture.ledger.previews.some(
        (binding) =>
          binding.expectedVersion === 18 && binding.payload.reason === '发布内容需要返修',
      ),
    ).toBe(true);
  });

  test(`${width}px 门户loading独立于已就绪目录，不把尚未读取总数显示为空项目`, async ({ page }) => {
    const fixture = await installKnowledgeFixtures(page);
    const pending = latch();
    fixture.controls.gates.push({ pathname: overviewPath(), ready: pending.ready });
    await page.setViewportSize({ width, height: 1000 });
    try {
      await visitKnowledge(page);
      await expect(page.getByText('正在读取门户统计…', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '重新读取门户', exact: true })).toBeDisabled();
      await expect(page.getByTestId('knowledge-agent-guide')).toHaveCount(0);
      await expect(directoryItems(page)).toHaveCount(50);
      await expect(page.getByTestId('knowledge-overview')).not.toContainText('0 篇可浏览文档');
      pending.release();
      await expect(
        page.getByTestId('knowledge-overview').locator('.knowledge-collection-docs').nth(2),
      ).toContainText('35');
      await expect(page.getByRole('button', { name: '重新读取门户', exact: true })).toBeEnabled();
    } finally {
      pending.release();
    }
  });

  test(`${width}px 历史续页403使可操作缓存失效，迟到旧正文不能重新显示或触发后续读取`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    const old = latch();
    await page.setViewportSize({ width, height: 1000 });
    try {
      await openTarget(page);
      fixture.controls.gates.push({ pathname: contentPath(targetRevision(2)), ready: old.ready });
      const request = waitForRead(page, contentPath(targetRevision(2)));
      await page.getByRole('button', { name: '查看当前发布', exact: true }).click();
      await expect.poll(() => fixture.getRequests(contentPath(targetRevision(2))).length).toBe(1);
      fixture.controls.historyFailures.set(`${targetId}|${historyCursor(17, 50)}`, {
        status: 403,
        code: 'FORBIDDEN',
        message: 'HISTORY_ACCESS_REVOKED',
      });
      await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'HISTORY_ACCESS_REVOKED' }).first(),
      ).toBeVisible();
      await expect(history(page)).toHaveCount(0);
      await expect(page.getByTestId('knowledge-current-publication')).toHaveCount(0);
      const before = fixture.ledger.requests.length;
      old.release();
      await finishOrAbort(await request);
      await afterBrowserPaint(page);
      await expect(bodyReader(page)).toHaveCount(0);
      await expect(page.getByTestId('knowledge-diff')).toHaveCount(0);
      await expect(history(page)).toHaveCount(0);
      expect(fixture.ledger.requests).toHaveLength(before);
    } finally {
      old.release();
    }
  });

  test(`${width}px 全局刷新使迟到历史续页失效，新首50条不混入旧续页或自动拉第三页`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    const old = latch();
    await page.setViewportSize({ width, height: 1000 });
    try {
      await openTarget(page);
      fixture.controls.gates.push({
        pathname: historyPath(),
        query: { cursor: historyCursor(17, 50) },
        ready: old.ready,
      });
      const request = waitForRead(page, historyPath(), { cursor: historyCursor(17, 50) });
      await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
      await expect.poll(() => fixture.getRequests(historyPath()).length).toBe(2);
      await page.getByRole('button', { name: '刷新文档', exact: true }).click();
      await expect.poll(() => fixture.getRequests(historyPath()).length).toBe(3);
      await expect(page.getByText('已加载 50 / 123 条历史', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '加载更多历史', exact: true })).toBeEnabled();
      old.release();
      await finishOrAbort(await request);
      await afterBrowserPaint(page);
      await expect(history(page).locator('tbody tr')).toHaveCount(50);
      await expect(revisionRow(page, 73)).toHaveCount(0);
      expect(
        fixture
          .getRequests(historyPath())
          .map((entry) => new URL(entry.path, 'http://fixture').searchParams.get('cursor')),
      ).toEqual([null, historyCursor(17, 50), null]);
    } finally {
      old.release();
    }
  });

  test(`${width}px 系统关系按声明方向显示并支持键盘进入集合、阅读与返回，页面无横向溢出`, async ({
    page,
  }) => {
    const fixture = await installKnowledgeFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await visitKnowledge(page);
    const system = page
      .locator('.knowledge-collection-card')
      .nth(1)
      .locator('.knowledge-collection-card-main');
    await system.focus();
    await expect(system).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('knowledge-collection-context')).toContainText('系统事实库');
    await expect(directoryItems(page)).toHaveCount(36);
    const details = page.locator('.collection-relations > summary');
    await details.focus();
    await page.keyboard.press('Enter');
    const relation = page.getByTestId('knowledge-system-relations');
    await expect(relation).toContainText('知识门户（web）');
    await expect(relation).toContainText('接口服务（api）');
    const cells = relation.getByRole('row').nth(1).getByRole('cell');
    await expect(cells.nth(0)).toContainText('知识门户');
    await expect(cells.nth(2)).toContainText('接口服务');
    await expect(relation).toContainText('HUMAN');
    const read = documentItem(page, 37).getByRole('button', { name: '阅读当前版本', exact: true });
    await read.focus();
    await page.keyboard.press('Enter');
    await expect(bodyReader(page)).toContainText(title(37));
    const back = page.getByRole('button', { name: /返回系统事实库/ });
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(directoryItems(page)).toHaveCount(36);
    await expect(bodyReader(page)).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(fixture.getRequests('/api/v1/projects/p1/units').length).toBeGreaterThanOrEqual(1);
    expect(
      fixture.getRequests('/api/v1/projects/p1/unit-dependencies').length,
    ).toBeGreaterThanOrEqual(1);
  });
}
