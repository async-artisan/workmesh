import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, sha256Bytes } from '@workmesh/shared';
import { describe, expect, it } from 'vitest';
import { V1Client } from './client';
import {
  materializeSnapshot,
  parseSnapshot,
  type SnapshotManifest,
  type SnapshotResource,
  type SnapshotView,
} from './context';

const PROJECT = '2f6c1c4b-6b0e-4f5d-9c2d-2b1b4b0f9b4a';
const TASK = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';
const SNAPSHOT = '6f7a8b9c-0d1e-2f3a-4b5c-6d7e8f9a0b1c';
const REQUIREMENT = '7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d';
const WORKFLOW = '8b9c0d1e-2f3a-4b5c-6d7e-8f9a0b1c2d3e';
const PLATFORM = { origin: 'https://workmesh.example.com', apiBasePath: '/api/v1' };

type ResourceFixture = { refId: string; body: string; mediaType: string };

async function buildSnapshot(resources: ResourceFixture[]): Promise<SnapshotView> {
  const manifestResources: SnapshotResource[] = [];
  for (const resource of resources) {
    const bytes = Buffer.from(resource.body, 'utf8');
    manifestResources.push({
      refId: resource.refId,
      kind: 'DOCUMENT_REVISION',
      targetId: resource.refId,
      sha256: await sha256Bytes(new Uint8Array(bytes)),
      byteLength: bytes.length,
      mediaType: resource.mediaType,
      authority: 'PUBLISHED',
    });
  }
  const manifest: SnapshotManifest = {
    schemaVersion: '1.0',
    projectId: PROJECT,
    requirementId: REQUIREMENT,
    requirementGeneration: 1,
    taskId: TASK,
    taskGeneration: 1,
    workflowDefinitionRevisionId: WORKFLOW,
    workflowDigest: 'a'.repeat(64),
    knowledgeBindingsVersion: 1,
    stepKey: 'review',
    baselinePolicy: 'NONE',
    productBaseline: null,
    resources: manifestResources,
  };
  const manifestDigest = await sha256Bytes(new TextEncoder().encode(canonicalJson(manifest)));
  return {
    id: SNAPSHOT,
    projectId: PROJECT,
    taskId: TASK,
    manifest,
    manifestDigest,
    resources: manifestResources,
  };
}

function bodyMap(fixtures: ResourceFixture[]): Map<string, string> {
  return new Map(fixtures.map((fixture) => [fixture.refId, fixture.body]));
}

function makeClient(
  snapshot: SnapshotView,
  bodies: Map<string, string>,
  overrides: Map<string, string> = new Map(),
): V1Client {
  const fetch = async (url: string): Promise<Response> => {
    const path = new URL(url).pathname;
    const resourceMatch = /\/context-snapshots\/[^/]+\/resources\/([^/]+)$/.exec(path);
    if (resourceMatch) {
      const refId = decodeURIComponent(resourceMatch[1] ?? '');
      const resource = snapshot.resources.find((item) => item.refId === refId);
      if (!resource) throw new Error(`unknown ref ${refId}`);
      const body = overrides.get(refId) ?? bodies.get(refId) ?? '';
      const bytes = Buffer.from(body, 'utf8');
      return new Response(
        JSON.stringify({
          data: {
            refId,
            encoding: 'base64',
            bodyBase64: bytes.toString('base64'),
            byteLength: bytes.length,
            sha256:
              overrides.has(refId)
                ? resource.sha256
                : await sha256Bytes(new Uint8Array(bytes)),
          },
          meta: { requestId: 'req-resource' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ data: snapshot, meta: { requestId: 'req-snapshot' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return new V1Client({ platform: PLATFORM, fetch, sleep: async () => undefined });
}

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wm-context-'));
}

describe('parseSnapshot', () => {
  it('拒绝重复 refId 与非法摘要', async () => {
    const snapshot = await buildSnapshot([{ refId: 'doc:a', body: 'a', mediaType: 'text/markdown' }]);
    expect(parseSnapshot(snapshot).resources).toHaveLength(1);
    const duplicated = {
      ...snapshot,
      manifest: {
        ...snapshot.manifest,
        resources: [snapshot.resources[0], snapshot.resources[0]],
      },
    };
    expect(() => parseSnapshot(duplicated)).toThrow(/重复/);
    expect(() => parseSnapshot({ ...snapshot, manifestDigest: 'x' })).toThrow(/manifestDigest/);
  });
});

describe('materializeSnapshot', () => {
  const fixtures: ResourceFixture[] = [
    { refId: 'candidate:revision-a', body: '# 需求\n', mediaType: 'text/markdown' },
    { refId: 'knowledge:doc-b', body: '{"a":1}\n', mediaType: 'application/json' },
  ];

  it('全部 bytes 校验后原子落盘，并写 current.json 与安全文件名', async () => {
    const dir = await workspace();
    const snapshot = await buildSnapshot(fixtures);
    const result = await materializeSnapshot({
      client: makeClient(snapshot, bodyMap(fixtures)),
      workspaceDir: dir,
      snapshot,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(result.reused).toBe(false);
    expect(result.path).toBe(join(dir, '.workmesh', 'context', SNAPSHOT));
    const names = await readdir(result.path);
    expect(names.sort()).toEqual([
      '001-candidate_revision-a.md',
      '002-knowledge_doc-b.json',
      'input-receipt.json',
      'manifest.json',
    ]);
    for (const name of names) {
      expect(name).not.toContain('/');
      expect(name).not.toContain('..');
    }
    const current = JSON.parse(
      await readFile(join(dir, '.workmesh', 'context', 'current.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(current.snapshotId).toBe(SNAPSHOT);
    expect(current.manifestDigest).toBe(snapshot.manifestDigest);
    const receipt = JSON.parse(await readFile(join(result.path, 'input-receipt.json'), 'utf8')) as {
      files: Array<{ name: string; refId: string; sha256: string }>;
    };
    expect(receipt.files.map((file) => file.refId)).toEqual(['candidate:revision-a', 'knowledge:doc-b', 'manifest']);
    const info = await stat(join(result.path, 'manifest.json'));
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('资源摘要与 manifest 不一致时失败，且不切 current.json', async () => {
    const dir = await workspace();
    const snapshot = await buildSnapshot(fixtures);
    const overrides = new Map([['candidate:revision-a', '# 被篡改\n']]);
    await expect(
      materializeSnapshot({
        client: makeClient(snapshot, bodyMap(fixtures), overrides),
        workspaceDir: dir,
        snapshot,
      }),
    ).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILED', exitCode: 8 });
    await expect(
      readFile(join(dir, '.workmesh', 'context', 'current.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readdir(join(dir, '.workmesh', 'context', SNAPSHOT)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('已有受管副本被本地修改时拒绝覆盖，本地文件保持不变', async () => {
    const dir = await workspace();
    const snapshot = await buildSnapshot(fixtures);
    const first = await materializeSnapshot({
      client: makeClient(snapshot, bodyMap(fixtures)),
      workspaceDir: dir,
      snapshot,
    });
    const edited = join(first.path, '001-candidate_revision-a.md');
    await writeFile(edited, '# 本地编辑\n', 'utf8');
    await expect(
      materializeSnapshot({
        client: makeClient(snapshot, bodyMap(fixtures)),
        workspaceDir: dir,
        snapshot,
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_MANAGED_FILE_MODIFIED', exitCode: 8 });
    expect(await readFile(edited, 'utf8')).toBe('# 本地编辑\n');
  });

  it('存在非受管文件时拒绝覆盖，不覆盖草稿或用户文件', async () => {
    const dir = await workspace();
    const snapshot = await buildSnapshot(fixtures);
    const first = await materializeSnapshot({
      client: makeClient(snapshot, bodyMap(fixtures)),
      workspaceDir: dir,
      snapshot,
    });
    await writeFile(join(first.path, 'notes.md'), '我的草稿', 'utf8');
    await mkdir(join(dir, '.workmesh', 'drafts'), { recursive: true });
    await writeFile(join(dir, '.workmesh', 'drafts', 'draft.md'), '草稿', 'utf8');
    await expect(
      materializeSnapshot({
        client: makeClient(snapshot, bodyMap(fixtures)),
        workspaceDir: dir,
        snapshot,
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_MANAGED_FILE_MODIFIED' });
    expect(await readFile(join(dir, '.workmesh', 'drafts', 'draft.md'), 'utf8')).toBe('草稿');
  });

  it('重复物化同一快照且摘要一致时返回 reused，不重写文件', async () => {
    const dir = await workspace();
    const snapshot = await buildSnapshot(fixtures);
    const first = await materializeSnapshot({
      client: makeClient(snapshot, bodyMap(fixtures)),
      workspaceDir: dir,
      snapshot,
    });
    const before = await stat(join(first.path, 'manifest.json'));
    const second = await materializeSnapshot({
      client: makeClient(snapshot, bodyMap(fixtures)),
      workspaceDir: dir,
      snapshot,
    });
    expect(second.reused).toBe(true);
    const after = await stat(join(second.path, 'manifest.json'));
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('manifest 与 manifestDigest 不一致时不落盘', async () => {
    const dir = await workspace();
    const snapshot = await buildSnapshot(fixtures);
    const tampered = { ...snapshot, manifestDigest: 'b'.repeat(64) };
    await expect(
      materializeSnapshot({
        client: makeClient(tampered, bodyMap(fixtures)),
        workspaceDir: dir,
        snapshot: tampered,
      }),
    ).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILED' });
  });
});
