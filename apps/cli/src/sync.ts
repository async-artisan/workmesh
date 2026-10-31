export interface RequirementPage<T = unknown> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export async function fetchAllRequirements<T>(
  request: <R>(path: string) => Promise<R>,
  projectId: string,
  status?: string,
) {
  const limit = 100;
  const items: T[] = [];
  let page = 1;
  let total: number;

  do {
    const query = new URLSearchParams({ projectId, page: String(page), limit: String(limit) });
    if (status) query.set('status', status);
    const result = await request<RequirementPage<T>>(`/requirements?${query}`);
    total = result.total;
    items.push(...result.items);
    if (result.items.length === 0) break;
    page += 1;
  } while (items.length < total);

  return { items, total, page: 1, limit };
}
