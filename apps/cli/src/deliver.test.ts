import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDeliver } from './deliver';

const UUID = '2f6c1c4b-6b0e-4f5d-9c2d-2b1b4b0f9b4a';
const COMMIT = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);
const temporaryDirs: string[] = [];

async function manifestWithCheck(check: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'workmesh-deliver-'));
  temporaryDirs.push(dir);
  const manifestPath = join(dir, 'deliver.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      workflowDefinitionRevisionId: UUID,
      localRunId: 'run-local-1',
      items: [
        {
          kind: 'IMPL',
          schemaVersion: '1.0',
          storage: 'GIT_REF',
          mediaType: 'text/x-source',
          sha256: DIGEST,
          byteLength: 0,
          projectRepositoryId: UUID,
          commitSha: COMMIT,
          repoPath: 'src/main.ts',
          checks: [check],
        },
      ],
    }),
    'utf8',
  );
  return manifestPath;
}

afterEach(async () => {
  const dirs = temporaryDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true })));
});

describe('buildDeliver check provenance', () => {
  it('preserves external evidence references and defaults legacy checks to Agent-reported', async () => {
    const path = await manifestWithCheck({
      code: 'ci-tests',
      passed: true,
      evidence: {
        kind: 'CI_RUN',
        provider: 'GitHub Actions',
        url: 'https://github.com/acme/app/actions/runs/42',
        runId: '42',
        commitSha: COMMIT,
      },
    });

    const { payload } = await buildDeliver(path);
    expect(payload.items[0]?.checks[0]).toEqual({
      code: 'ci-tests',
      passed: true,
      source: 'EXTERNAL_REFERENCE',
      evidence: {
        kind: 'CI_RUN',
        provider: 'GitHub Actions',
        url: 'https://github.com/acme/app/actions/runs/42',
        runId: '42',
        commitSha: COMMIT,
      },
    });

    const legacy = await manifestWithCheck({ code: 'unit-tests', passed: true });
    const legacyResult = await buildDeliver(legacy);
    expect(legacyResult.payload.items[0]?.checks[0]?.source).toBe('AGENT_REPORTED');
  });

  it('rejects an unsupported verified claim or mismatched provenance', async () => {
    const untrusted = await manifestWithCheck({ code: 'ci-tests', passed: true, verified: true });
    await expect(buildDeliver(untrusted)).rejects.toMatchObject({ code: 'LOCAL_INPUT_INVALID' });

    const nestedVerified = await manifestWithCheck({
      code: 'ci-tests',
      passed: true,
      evidence: {
        kind: 'CI_RUN',
        provider: 'CI',
        url: 'https://ci.example.com/runs/42',
        verified: true,
      },
    });
    await expect(buildDeliver(nestedVerified)).rejects.toMatchObject({ code: 'LOCAL_INPUT_INVALID' });

    const mismatch = await manifestWithCheck({
      code: 'ci-tests',
      passed: true,
      source: 'AGENT_REPORTED',
      evidence: {
        kind: 'CI_RUN',
        provider: 'CI',
        url: 'https://ci.example.com/runs/42',
      },
    });
    await expect(buildDeliver(mismatch)).rejects.toMatchObject({ code: 'LOCAL_INPUT_INVALID' });
  });
});
