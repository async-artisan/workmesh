import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findDocumentSummaryByTitle,
  findPublishedDocumentSummaryByTitle,
  readDocumentSummaries,
} from './document-summary-reader.mjs';

const summary = (id, title = 'latest') => ({
  document: { id, projectId: 'p1', version: 17 },
  latestVisibleRevision: { id: `${id}-latest`, title },
  publishedRevision: null,
});
const page = (items, nextCursor = null, total = items.length) => ({ items, nextCursor, total });
const historyPage = (items, nextCursor = null, total = items.length, documentVersion = 17) => ({
  ...page(items, nextCursor, total),
  documentVersion,
});
const revision = (id, title, documentId = 'doc-1') => ({ id, documentId, title });
function reader(handler) {
  const calls = [];
  const call = async (method, path) => {
    assert.equal(method, 'GET');
    calls.push(path);
    return handler(new URL(path, 'http://fixture.test'), calls.length);
  };
  return { call, calls };
}

test('compact summary pages include the document after the first 100 without reading history', async () => {
  const first = Array.from({ length: 100 }, (_, index) => summary(`doc-${index}`));
  const { call, calls } = reader((url) => {
    assert.equal(url.pathname, '/projects/p1/document-summaries');
    assert.equal(url.searchParams.get('kind'), 'UNDERSTANDING');
    assert.equal(url.searchParams.get('status'), 'published');
    assert.equal(url.searchParams.get('limit'), '100');
    return url.searchParams.has('cursor')
      ? page([summary('doc-100')], null, 101)
      : page(first, 'page-2', 101);
  });
  const items = await readDocumentSummaries(call, 'p1', {
    kind: 'UNDERSTANDING',
    status: 'published',
  });
  assert.equal(items.length, 101);
  assert.equal(items[100].document.id, 'doc-100');
  assert.equal(calls.length, 2);
});

test('the search query is encoded and a published exact title needs no history', async () => {
  const target = {
    ...summary('doc-1'),
    publishedRevision: { id: 'pub-2', title: '税率 %/_ & 条款' },
  };
  const { call, calls } = reader((url) => {
    assert.equal(url.pathname, '/projects/p%2F1/document-summaries');
    assert.equal(url.searchParams.get('q'), target.publishedRevision.title);
    return page([target]);
  });
  assert.equal(
    await findDocumentSummaryByTitle(call, 'p/1', target.publishedRevision.title),
    target,
  );
  assert.equal(calls.length, 1);
});

test('an early visible title can identify a document outside the first history page', async () => {
  const target = summary('doc-1');
  const { call, calls } = reader((url) => {
    if (url.pathname.endsWith('/document-summaries')) return page([target]);
    assert.equal(url.pathname, '/documents/doc-1/history');
    assert.equal(url.searchParams.get('limit'), '50');
    return url.searchParams.has('cursor')
      ? historyPage([revision('old-1', 'seed title')], null, 2)
      : historyPage([revision('new-2', 'renamed')], 'old-page', 2);
  });
  assert.equal(await findDocumentSummaryByTitle(call, 'p1', 'seed title'), target);
  assert.equal(calls.length, 3);
});

test('a requirement-text search hit is not treated as an exact revision title', async () => {
  const { call, calls } = reader((url) =>
    url.pathname.endsWith('/document-summaries')
      ? page([summary('doc-1')])
      : historyPage([revision('rev-1', 'unrelated')]),
  );
  assert.equal(await findDocumentSummaryByTitle(call, 'p1', 'requirement only'), null);
  assert.equal(calls.length, 2);
});

test('a title longer than the API search limit is matched without truncating the title', async () => {
  const title = '长'.repeat(101);
  const target = summary('doc-1', title);
  const { call } = reader((url) => {
    assert.equal(url.searchParams.has('q'), false);
    return page([target]);
  });
  assert.equal(await findDocumentSummaryByTitle(call, 'p1', title), target);
});

test('withdrawal selects the unique current publication rather than a renamed historical document', async () => {
  const renamed = {
    ...summary('doc-renamed', 'different current title'),
    publishedRevision: { id: 'renamed-pub', title: 'different current title' },
  };
  const target = {
    ...summary('doc-target', 'newer candidate title'),
    publishedRevision: { id: 'target-pub', title: 'seed title' },
  };
  const { call, calls } = reader((url) => {
    assert.equal(url.pathname, '/projects/p1/document-summaries');
    assert.equal(url.searchParams.get('status'), 'published');
    assert.equal(url.searchParams.get('q'), 'seed title');
    return url.searchParams.has('cursor') ? page([target], null, 2) : page([renamed], 'next', 2);
  });
  assert.equal(await findPublishedDocumentSummaryByTitle(call, 'p1', 'seed title'), target);
  assert.equal(calls.length, 2);
});

test('a matching candidate or historical search hit cannot identify a withdrawal target', async () => {
  const candidate = {
    ...summary('doc-1', 'seed title'),
    publishedRevision: { id: 'pub-2', title: 'other current title' },
  };
  const { call, calls } = reader(() => page([candidate]));
  assert.equal(await findPublishedDocumentSummaryByTitle(call, 'p1', 'seed title'), null);
  assert.equal(calls.length, 1);
});

test('duplicate exact publication titles fail across pages instead of choosing a write target', async () => {
  const target = (id) => ({
    ...summary(id),
    publishedRevision: { id: `${id}-pub`, title: 'seed title' },
  });
  const { call } = reader((url) =>
    url.searchParams.has('cursor')
      ? page([target('doc-2')], null, 2)
      : page([target('doc-1')], 'next', 2),
  );
  await assert.rejects(
    findPublishedDocumentSummaryByTitle(call, 'p1', 'seed title'),
    /DOCUMENT_TARGET_AMBIGUOUS/,
  );
});

test('withdrawal cannot select an early exact match when the remaining catalog is incomplete', async () => {
  const target = {
    ...summary('doc-1'),
    publishedRevision: { id: 'pub-2', title: 'seed title' },
  };
  const { call } = reader((url) =>
    url.searchParams.has('cursor') ? page([], null, 2) : page([target], 'next', 2),
  );
  await assert.rejects(
    findPublishedDocumentSummaryByTitle(call, 'p1', 'seed title'),
    /DOCUMENT_READ_INCOMPLETE/,
  );
});

for (const [name, pages] of [
  ['repeated cursor', [page([summary('one')], 'next', 2), page([summary('two')], 'next', 2)]],
  ['duplicate document', [page([summary('one')], 'next', 2), page([summary('one')], null, 2)]],
  ['total changed', [page([summary('one')], 'next', 2), page([summary('two')], null, 3)]],
  ['short final page', [page([summary('one')], null, 2)]],
  ['empty continuation', [page([], 'next', 1)]],
  ['missing cursor', [{ items: [], total: 0 }]],
  ['invalid total', [page([], null, -1)]],
])
  test(`incomplete summaries fail instead of returning partial data: ${name}`, async () => {
    const { call } = reader((_url, index) => pages[index - 1]);
    await assert.rejects(readDocumentSummaries(call, 'p1'), /DOCUMENT_READ_INCOMPLETE/);
  });

test('the 40-page budget stops without a 41st request or an incomplete success', async () => {
  const { call, calls } = reader((_url, index) =>
    page([summary(`doc-${index}`)], `cursor-${index}`, 41),
  );
  await assert.rejects(readDocumentSummaries(call, 'p1'), /page budget reached/);
  assert.equal(calls.length, 40);
});

for (const [name, result] of [
  ['changed version', historyPage([revision('rev-1', 'seed title')], null, 1, 18)],
  ['wrong document', historyPage([revision('rev-1', 'seed title', 'other-document')])],
])
  test(`history identity fails before selecting a write target: ${name}`, async () => {
    const { call } = reader((url) =>
      url.pathname.endsWith('/document-summaries') ? page([summary('doc-1')]) : result,
    );
    await assert.rejects(
      findDocumentSummaryByTitle(call, 'p1', 'seed title'),
      /DOCUMENT_READ_INCOMPLETE/,
    );
  });

test('history total changes, duplicates and repeated cursors cannot become an absent title', async (t) => {
  for (const [name, second] of [
    ['total', historyPage([revision('rev-1', 'other')], null, 3)],
    ['duplicate', historyPage([revision('rev-2', 'other')], null, 2)],
    ['cursor', historyPage([revision('rev-1', 'other')], 'next', 2)],
  ])
    await t.test(name, async () => {
      const { call } = reader((url) => {
        if (url.pathname.endsWith('/document-summaries')) return page([summary('doc-1')]);
        return url.searchParams.has('cursor')
          ? second
          : historyPage([revision('rev-2', 'renamed')], 'next', 2);
      });
      await assert.rejects(
        findDocumentSummaryByTitle(call, 'p1', 'seed title'),
        /DOCUMENT_READ_INCOMPLETE/,
      );
    });
});

test('authorization or service errors propagate without a legacy read fallback', async (t) => {
  for (const failingPath of ['document-summaries', 'history'])
    await t.test(failingPath, async () => {
      const failure = Object.assign(new Error('API read failed'), { status: 403 });
      const { call, calls } = reader((url) => {
        if (url.pathname.endsWith(`/${failingPath}`)) throw failure;
        return page([summary('doc-1')]);
      });
      await assert.rejects(
        findDocumentSummaryByTitle(call, 'p1', 'seed title'),
        (error) => error === failure,
      );
      assert.ok(calls.every((path) => /\/(document-summaries|history)\?/.test(path)));
    });
});
