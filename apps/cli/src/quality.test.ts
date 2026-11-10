import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkQualityFile } from './quality';
import { main } from './index';
import { buildCandidate } from './candidate';

const plan = {
  schemaVersion: '1.0',
  stage: 'PLAN',
  requirementId: 'WM-001',
  basis: { prdRevisionId: 'r1', snapshotId: 's1' },
  acceptance: [{ key: 'import-works', text: '导入成功', verification: 'TEST' }],
  tasks: [{ id: 't1', acceptanceKeys: ['import-works'], dependsOn: [], files: ['src/import.ts'] }],
  cases: [{ id: 'c1', covers: ['import-works'], kind: 'TEST' }],
  evidence: [],
};

describe('local quality command', () => {
  it('submits the shipped acceptance JSON through the real candidate builder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wm-quality-'));
    const file = join(root, 'prd.md');
    await writeFile(file, '# PRD\n');
    const acceptance = JSON.parse(
      await readFile(
        new URL(
          '../../../packages/role-packages/roles/product/assets/templates/acceptance.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const id = '11111111-1111-4111-8111-111111111111';
    const candidate = await buildCandidate(id, {
      file,
      kind: 'PRD',
      knowledgeBaseId: id,
      requirementId: id,
      basisUnderstandingRevisionId: id,
      deliveryScope: {
        participatingRoleIds: ['backend'],
        requiredOutputKinds: ['IMPL'],
        excludedRoles: [],
      },
      acceptance,
    });
    expect(candidate.body.acceptance).toEqual(acceptance);
  });
  it('emits the success envelope without requiring a configured workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wm-quality-'));
    await writeFile(join(root, 'plan.json'), JSON.stringify(plan));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await main(['quality', '--file', 'plan.json', '--dir', root, '--json'])).toBe(0);
      expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
        data: { status: 'CONSISTENT', authority: 'LOCAL_REPORTED' },
        meta: { requestId: expect.any(String) },
      });
    } finally {
      log.mockRestore();
    }
  });
  it('checks a selected local file without credentials or network access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wm-quality-'));
    await writeFile(join(root, 'plan.json'), JSON.stringify(plan));
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    try {
      expect((await checkQualityFile('plan.json', root)).status).toBe('CONSISTENT');
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
  it('rejects duplicate JSON keys instead of silently choosing the last value', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wm-quality-'));
    await writeFile(join(root, 'bad.json'), '{"stage":"PLAN","stage":"DELIVERY"}');
    await expect(checkQualityFile('bad.json', root)).rejects.toMatchObject({
      code: 'LOCAL_INPUT_INVALID',
    });
  });
  it('refuses oversized input and directories before parsing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wm-quality-'));
    await writeFile(join(root, 'large.json'), Buffer.alloc(4 * 1024 * 1024 + 1, 32));
    await expect(checkQualityFile('large.json', root)).rejects.toMatchObject({
      code: 'LOCAL_INPUT_INVALID',
    });
    await expect(checkQualityFile('.', root)).rejects.toMatchObject({
      code: 'LOCAL_INPUT_INVALID',
    });
  });
  it('emits a report with a nonzero CLI exit when delivery evidence is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wm-quality-'));
    await writeFile(
      join(root, 'plan.json'),
      JSON.stringify({
        ...plan,
        stage: 'DELIVERY',
        basis: { ...plan.basis, commitSha: 'a'.repeat(40) },
      }),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await main(['quality', '--file', 'plan.json', '--dir', root, '--json'])).toBe(2);
      const result = JSON.parse(String(log.mock.calls[0][0]));
      expect(result.error.details.report.status).toBe('INCOMPLETE');
    } finally {
      log.mockRestore();
      stderr.mockRestore();
    }
  });
});
