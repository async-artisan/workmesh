import {
  Controller,
  Headers,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { GitIntegrationService } from './git-integration.service';

@Controller('integrations/git')
export class WebhookController {
  constructor(private readonly git: GitIntegrationService) {}
  @Post('webhook') async receive(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature?: string,
    @Headers('x-gitlab-token') token?: string,
  ): Promise<Record<string, unknown>> {
    const secret = process.env.GIT_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException('Webhook 尚未配置共享密钥');
    const githubEvent = request.headers['x-github-event'];
    const gitlabEvent = request.headers['x-gitlab-event'];
    const provider = githubEvent ? 'github' : 'gitlab';
    if (githubEvent) {
      const expected = `sha256=${createHmac('sha256', secret)
        .update(request.rawBody ?? Buffer.alloc(0))
        .digest('hex')}`;
      const actual = Buffer.from(signature ?? '');
      const expectedBuffer = Buffer.from(expected);
      if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer))
        throw new UnauthorizedException('Webhook 签名无效');
    } else {
      const actual = Buffer.from(token ?? '');
      const expected = Buffer.from(secret);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new UnauthorizedException('Webhook 令牌无效');
    }
    const event = String(githubEvent ?? gitlabEvent ?? '');
    const isPush = event === 'push' || event === 'Push Hook';
    const isPullRequest = ['pull_request', 'merge_request', 'Merge Request Hook'].includes(event);
    if (!isPush && !isPullRequest) return { accepted: false, event, provider };
    const result = isPullRequest
      ? await this.git.handlePullRequest(request.body, provider)
      : await this.git.handlePush(request.body, provider);
    return { event, ...result };
  }
}
