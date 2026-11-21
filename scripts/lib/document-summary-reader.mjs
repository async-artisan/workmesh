const MAX_PAGES = 40;

function invalid(reason) {
  throw new Error(`DOCUMENT_READ_INCOMPLETE: ${reason}`);
}

async function* readPages(call, path, parameters, { documentId, documentVersion } = {}) {
  const cursors = new Set();
  const ids = new Set();
  let cursor = null;
  let total = null;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const query = new URLSearchParams(parameters);
    if (cursor !== null) query.set('cursor', cursor);
    const page = await call('GET', `${path}?${query}`);
    if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0)
      invalid('invalid page');
    if (total !== null && total !== page.total) invalid('total changed; retry the read');
    total = page.total;
    if (documentId && page.documentVersion !== documentVersion)
      invalid('document version changed; retry the read');
    if (
      page.nextCursor !== null &&
      (typeof page.nextCursor !== 'string' || !page.nextCursor || cursors.has(page.nextCursor))
    )
      invalid('invalid or repeated cursor');
    for (const item of page.items) {
      const id = documentId ? item?.id : item?.document?.id;
      if (typeof id !== 'string' || !id || ids.has(id)) invalid('invalid or repeated item');
      if (documentId && item.documentId !== documentId) invalid('revision document mismatch');
      ids.add(id);
    }
    if (ids.size > total) invalid('items exceed total');
    if (page.nextCursor === null && ids.size !== total) invalid('last page count mismatch');
    if (page.nextCursor !== null && page.items.length === 0) invalid('empty continuation page');
    yield page.items;
    if (page.nextCursor === null) return;
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  invalid('page budget reached; narrow the query');
}

/** Complete compact pages before a demo script decides that something is absent. */
export async function readDocumentSummaries(call, projectId, parameters = {}) {
  const query = { limit: '100', ...parameters };
  const items = [];
  for await (const page of readPages(
    call,
    `/projects/${encodeURIComponent(projectId)}/document-summaries`,
    query,
  ))
    items.push(...page);
  return items;
}

/** A withdrawal must identify one current publication, never an earlier historical title. */
export async function findPublishedDocumentSummaryByTitle(call, projectId, title, parameters = {}) {
  const summaries = await readDocumentSummaries(call, projectId, {
    ...parameters,
    status: 'published',
    ...(title.length <= 100 ? { q: title } : {}),
  });
  const matches = summaries.filter((summary) => summary.publishedRevision?.title === title);
  if (matches.length > 1) throw new Error('DOCUMENT_TARGET_AMBIGUOUS: select an explicit document');
  return matches[0] ?? null;
}

/** A search hit can come from requirement text; only an exact visible title identifies a document. */
export async function findDocumentSummaryByTitle(call, projectId, title, parameters = {}) {
  const summaries = await readDocumentSummaries(call, projectId, {
    ...parameters,
    ...(title.length <= 100 ? { q: title } : {}),
  });
  for (const summary of summaries) {
    if (
      summary.latestVisibleRevision?.title === title ||
      summary.publishedRevision?.title === title
    )
      return summary;
    const documentId = summary.document.id;
    for await (const history of readPages(
      call,
      `/documents/${encodeURIComponent(documentId)}/history`,
      { limit: '50' },
      { documentId, documentVersion: summary.document.version },
    ))
      if (history.some((revision) => revision.title === title)) return summary;
  }
  return null;
}
