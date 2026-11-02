import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCandidate, parseCandidateJson } from './candidate';

const PROJECT = '2f6c1c4b-6b0e-4f5d-9c2d-2b1b4b0f9b4a';
const KB = '5c77a3a1-2df0-4c7a-9d0e-10f5b8e11c01';
const REQUIREMENT = '6f9e6f20-8ab9-4b65-bd1d-7c0c4c6d3b02';
const BASIS = '7e6cc4f3-72fc-4b43-a8c5-faf8f2e7f103';
const DOCUMENT = '8f5ab4c2-98f5-43d1-b665-b55f5ef0b204';

const scope = {
  participatingRoleIds: ['role-product', 'role-backend'],
  requiredOutputKinds: ['PRD', 'IMPL'],
  excludedRoles: [],
};
const acceptance = [{ key: 'invite-works', text: '管理员可以邀请成员', verification: 'TEST' }];

async function candidateFile(content = '# PRD\n'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wm-candidate-'));
  const path = join(dir, 'prd.md');
  await writeFile(path, content, 'utf8');
  return path;
}

describe('buildCandidate', () => {
  it('keeps non-PRD candidates compatible and excludes PRD binding fields', async () => {
    const file = await candidateFile('理解文档');
    const result = await buildCandidate(PROJECT, {
      knowledgeBaseId: KB,
      kind: 'UNDERSTANDING',
      requirementId: REQUIREMENT,
      file,
    });
    expect(result.relativeRoute).toBe(`/projects/${PROJECT}/documents`);
    expect(result.body).toMatchObject({ knowledgeBaseId: KB, kind: 'UNDERSTANDING', requirementId: REQUIREMENT });
    expect(result.body).not.toHaveProperty('basisUnderstandingRevisionId');
    expect(result.body).not.toHaveProperty('deliveryScope');
    expect(result.body).not.toHaveProperty('acceptance');
  });

  it('builds a PRD candidate with the required structured binding', async () => {
    const file = await candidateFile();
    const result = await buildCandidate(PROJECT, {
      knowledgeBaseId: KB,
      kind: 'PRD',
      requirementId: REQUIREMENT,
      basisUnderstandingRevisionId: BASIS,
      deliveryScope: scope,
      acceptance,
      file,
    });
    expect(result.body).toMatchObject({
      knowledgeBaseId: KB,
      kind: 'PRD',
      requirementId: REQUIREMENT,
      basisUnderstandingRevisionId: BASIS,
      deliveryScope: scope,
      acceptance,
    });
  });

  it.each([
    ['basisUnderstandingRevisionId', { deliveryScope: scope, acceptance }],
    ['deliveryScope', { basisUnderstandingRevisionId: BASIS, acceptance }],
    ['acceptance', { basisUnderstandingRevisionId: BASIS, deliveryScope: scope }],
  ])('rejects a PRD candidate missing %s', async (_name, extra) => {
    const file = await candidateFile();
    await expect(
      buildCandidate(PROJECT, {
        knowledgeBaseId: KB,
        kind: 'PRD',
        requirementId: REQUIREMENT,
        file,
        ...extra,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects PRD-only binding fields on non-PRD candidates', async () => {
    const file = await candidateFile('理解文档');
    await expect(
      buildCandidate(PROJECT, {
        knowledgeBaseId: KB,
        kind: 'UNDERSTANDING',
        requirementId: REQUIREMENT,
        basisUnderstandingRevisionId: BASIS,
        file,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('does not send requirementId on an existing document revision route', async () => {
    const file = await candidateFile();
    const result = await buildCandidate(PROJECT, {
      kind: 'PRD',
      documentId: DOCUMENT,
      basisUnderstandingRevisionId: BASIS,
      deliveryScope: scope,
      acceptance,
      file,
    });
    expect(result.relativeRoute).toBe(`/documents/${DOCUMENT}/revisions`);
    expect(result.body).not.toHaveProperty('knowledgeBaseId');
    expect(result.body).not.toHaveProperty('kind');
    expect(result.body).not.toHaveProperty('requirementId');
  });

  it('parses inline JSON and @file JSON inputs', async () => {
    expect(await parseCandidateJson(JSON.stringify(scope), '--delivery-scope')).toEqual(scope);
    const dir = await mkdtemp(join(tmpdir(), 'wm-binding-'));
    const path = join(dir, 'acceptance.json');
    await writeFile(path, JSON.stringify(acceptance), 'utf8');
    expect(await parseCandidateJson(`@${path}`, '--acceptance')).toEqual(acceptance);
  });

  it('rejects malformed JSON input', async () => {
    await expect(parseCandidateJson('{', '--acceptance')).rejects.toMatchObject({ code: 'LOCAL_INPUT_INVALID' });
  });
});
