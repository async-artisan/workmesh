import { describe, expect, it } from 'vitest';
import { sha256Bytes, V1_ERROR_CODES } from '@workmesh/shared';
import { MAX_DOCUMENT_BODY_BYTES } from '../common/strict-json.interceptor';
import { V1ArtifactService, type V1RawDeliverItem } from './v1-artifact.service';

/**
 * 交付路径的正文上限只在真正解码的 v1-artifact.service.ts 里可测：
 * 不经过 HTTP（body-parser limit 16MiB）也能证明 HOSTED 单件与总和控制生效。
 * 直接构造 service（构造函数依赖仅在实际业务方法里使用，normalizeItem 只用纯校验）。
 */
const service = new V1ArtifactService({} as never, {} as never, {} as never, {} as never);
const normalizeItems = (
  service as unknown as {
    normalizeItems: (taskId: string, raw: unknown, contract?: null) => Promise<unknown[]>;
  }
).normalizeItems.bind(service);

const SHA_PLACEHOLDER = 'a'.repeat(64);

async function hostedItem(
  bytes: Buffer,
  over: Partial<V1RawDeliverItem> = {},
): Promise<V1RawDeliverItem> {
  return {
    kind: 'IMPL',
    schemaVersion: '1.0',
    storage: 'HOSTED',
    mediaType: 'text/plain',
    sha256: await sha256Bytes(new Uint8Array(bytes)),
    byteLength: bytes.byteLength,
    bodyBase64: bytes.toString('base64'),
    checks: [],
    ...over,
  };
}

describe('交付 HOSTED 正文：单件 10MiB 上限', () => {
  it('恰好 10MiB 的单件正文通过（按解码后的原始字节，不按 Base64 长度）', async () => {
    const item = await hostedItem(Buffer.alloc(MAX_DOCUMENT_BODY_BYTES, 0x61));
    const items = (await normalizeItems('task-1', [item], null)) as Array<{ byteLength: number }>;
    expect(items).toHaveLength(1);
    expect(items[0].byteLength).toBe(MAX_DOCUMENT_BODY_BYTES);
  });

  it('解码后超过 10MiB 的单件正文 → 413 PAYLOAD_TOO_LARGE（Base64 膨胀不能绕过）', async () => {
    const bytes = Buffer.alloc(MAX_DOCUMENT_BODY_BYTES + 1, 0x61);
    const oversize: V1RawDeliverItem = {
      kind: 'IMPL',
      schemaVersion: '1.0',
      storage: 'HOSTED',
      mediaType: 'text/plain',
      // 在摘要重算之前就应因超限被拒，因此这里只需格式合法的占位值。
      sha256: SHA_PLACEHOLDER,
      byteLength: bytes.byteLength,
      bodyBase64: bytes.toString('base64'),
      checks: [],
    };
    await expect(normalizeItems('task-1', [oversize], null)).rejects.toMatchObject({
      status: 413,
      code: V1_ERROR_CODES.PAYLOAD_TOO_LARGE,
      details: {
        limitBytes: MAX_DOCUMENT_BODY_BYTES,
        field: 'bodyBase64',
        byteLength: MAX_DOCUMENT_BODY_BYTES + 1,
      },
    });
  });
});

describe('交付 HOSTED 正文：单次交付总和 10MiB 上限（05 §1）', () => {
  it('两件合计恰好 10MiB 通过', async () => {
    const half = MAX_DOCUMENT_BODY_BYTES / 2;
    const items = await Promise.all([
      hostedItem(Buffer.alloc(half, 0x61), { kind: 'IMPL' }),
      hostedItem(Buffer.alloc(half, 0x62), { kind: 'DESIGN' }),
    ]);
    const normalized = (await normalizeItems('task-1', items, null)) as unknown[];
    expect(normalized).toHaveLength(2);
  });

  it('单件都不超限但合计超过 10MiB → 413 PAYLOAD_TOO_LARGE，details 指向总和控制', async () => {
    const halfPlusOne = MAX_DOCUMENT_BODY_BYTES / 2 + 1;
    const items = await Promise.all([
      hostedItem(Buffer.alloc(halfPlusOne, 0x61), { kind: 'IMPL' }),
      hostedItem(Buffer.alloc(halfPlusOne, 0x62), { kind: 'DESIGN' }),
    ]);
    await expect(normalizeItems('task-1', items, null)).rejects.toMatchObject({
      status: 413,
      code: V1_ERROR_CODES.PAYLOAD_TOO_LARGE,
      details: {
        limitBytes: MAX_DOCUMENT_BODY_BYTES,
        field: 'hostedTotalBytes',
        byteLength: MAX_DOCUMENT_BODY_BYTES + 2,
      },
    });
  });
});
