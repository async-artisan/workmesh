import { describe, expect, it, vi } from 'vitest';
import { readCodeEvidenceDiagnosticsInTransaction } from './v1-code-evidence-diagnostics.reader';

describe('bounded project-scoped code evidence reads', () => {
  it('keeps an over-limit ticket history incomplete and strips stored hashes from diagnostics', async () => {
    const readTickets = vi
      .fn()
      .mockResolvedValue([])
      .mockResolvedValueOnce(
        Array.from({ length: 1001 }, (_, index) => ({
          id: `ticket-${index}`,
          repositoryId: '42',
          changeRequestId: '10',
          headSha: 'a'.repeat(40),
          ticketGeneration: 1,
          preparedEvidenceId: 'evidence',
          preparedSecretHash: 'private-hash',
          preparedExpiresAt: null,
        })),
      )
      .mockResolvedValueOnce([]);
    const setRead = vi.fn().mockResolvedValue({
      taskGeneration: 1,
      artifacts: [
        {
          id: 'artifact',
          storage: 'GIT_REF',
          commitSha: 'a'.repeat(40),
          projectRepositoryId: 'registered',
        },
      ],
      task: {
        generation: 1,
        currentArtifactSetId: 'set',
        workStatus: 'ACTIVE',
        instance: { retiredAt: null },
      },
    });
    const receiptsRead = vi.fn().mockResolvedValue([]);
    const tx = {
      artifactSet: { findFirst: setRead },
      projectRepository: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'registered',
            owner: 'team',
            name: 'repo',
            externalId: '42',
            adapter: 'GITHUB',
            identityMode: 'PROVIDER',
            archivedAt: null,
          },
        ]),
      },
      codeReviewEvidence: { findMany: readTickets },
      webhookReceipt: { findMany: receiptsRead },
    };
    const result = await readCodeEvidenceDiagnosticsInTransaction(
      tx as any,
      'project',
      'set',
      'task',
    );
    expect(result).toMatchObject({ complete: false, references: [{ status: 'INCOMPLETE' }] });
    expect(result?.references[0].tickets).toHaveLength(1000);
    expect(JSON.stringify(result)).not.toContain('private-hash');
    expect(setRead).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'set', projectId: 'project', taskId: 'task' } }),
    );
    expect(readTickets.mock.calls[0][0]).toMatchObject({
      where: { projectId: 'project', artifactSetId: 'set', preparedSecretHash: { not: null } },
      take: 1001,
    });
    expect(receiptsRead).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'project', source: 'GITHUB', id: { in: [] } },
      }),
    );
  });
});
