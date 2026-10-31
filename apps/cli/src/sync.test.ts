import { describe, expect, it, vi } from 'vitest';
import { fetchAllRequirements } from './sync';

describe('fetchAllRequirements', () => {
  it('fetches every page up to the API total', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, (_, id) => ({ id })),
        total: 101,
      })
      .mockResolvedValueOnce({ items: [{ id: 100 }], total: 101 });

    await expect(fetchAllRequirements(request, 'project-1', 'DRAFT')).resolves.toMatchObject({
      items: Array.from({ length: 101 }, (_, id) => ({ id })),
      total: 101,
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      '/requirements?projectId=project-1&page=1&limit=100&status=DRAFT',
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/requirements?projectId=project-1&page=2&limit=100&status=DRAFT',
    );
  });
});
