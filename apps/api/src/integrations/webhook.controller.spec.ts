import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookController } from './webhook.controller';

describe('WebhookController', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('verifies the raw body and reports that repository ownership is unconfigured', async () => {
    vi.stubEnv('GIT_WEBHOOK_SECRET', 'local-test-secret');
    const rawBody = Buffer.from('{ "repository": { "full_name": "owner/repo" }, "commits": [] }');
    const signature = `sha256=${createHmac('sha256', 'local-test-secret').update(rawBody).digest('hex')}`;
    const git = {
      handlePush: vi.fn().mockResolvedValue({
        provider: 'github',
        accepted: false,
        linked: false,
        skipped: 'project_repository_binding_unconfigured',
      }),
    };
    const controller = new WebhookController(git as never);

    await expect(
      controller.receive(
        {
          rawBody,
          body: { repository: { full_name: 'owner/repo' }, commits: [] },
          headers: { 'x-github-event': 'push' },
        } as never,
        signature,
      ),
    ).resolves.toMatchObject({
      accepted: false,
      provider: 'github',
      skipped: 'project_repository_binding_unconfigured',
    });
    expect(git.handlePush).toHaveBeenCalledOnce();
  });

  it('rejects missing secrets and invalid signatures', async () => {
    const controller = new WebhookController({} as never);
    await expect(controller.receive({ headers: {} } as never)).rejects.toMatchObject({
      status: 503,
    });

    vi.stubEnv('GIT_WEBHOOK_SECRET', 'local-test-secret');
    await expect(
      controller.receive(
        { rawBody: Buffer.from('{}'), body: {}, headers: { 'x-github-event': 'push' } } as never,
        'sha256=invalid',
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('authenticates GitLab and ignores unsupported event types', async () => {
    vi.stubEnv('GIT_WEBHOOK_SECRET', 'local-test-secret');
    const git = { handlePush: vi.fn() };
    const controller = new WebhookController(git as never);
    await expect(
      controller.receive(
        { body: {}, headers: { 'x-gitlab-event': 'Tag Push Hook' } } as never,
        undefined,
        'local-test-secret',
      ),
    ).resolves.toMatchObject({ accepted: false, provider: 'gitlab' });
    expect(git.handlePush).not.toHaveBeenCalled();
  });
});
