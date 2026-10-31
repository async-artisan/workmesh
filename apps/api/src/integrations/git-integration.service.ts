import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeRepositoryUrl } from '../projects/repository-url';
import { CommitParserService } from './commit-parser.service';

type Provider = 'github' | 'gitlab';
type TraceTarget = 'commit' | 'pull_request';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class GitIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: CommitParserService,
  ) {}

  async handlePush(payload: unknown, provider: Provider) {
    const repositoryUrl = this.repositoryUrl(payload, provider, false);
    if (!repositoryUrl) return this.skipped(provider, 'repository_identity_invalid');
    const project = await this.prisma.project.findUnique({ where: { repositoryUrl } });
    if (!project) return this.skipped(provider, 'repository_not_mapped');

    const body = object(payload);
    const commits = Array.isArray(body.commits) ? body.commits : [];
    const saved: string[] = [];
    let links = 0;
    for (const value of commits) {
      const commit = object(value);
      const sha = string(commit.id);
      const message = string(commit.message);
      if (!sha || !message) continue;
      const row = await this.prisma.gitCommit.upsert({
        where: { repositoryUrl_sha: { repositoryUrl, sha } },
        create: {
          repositoryUrl,
          sha,
          message,
          author:
            string(object(commit.author).name) ??
            string(object(commit.author).username) ??
            'unknown',
          url: string(commit.url) ?? string(commit.web_url) ?? '',
          committedAt: new Date(string(commit.timestamp) ?? Date.now()),
        },
        update: {
          message,
          url: string(commit.url) ?? string(commit.web_url) ?? '',
        },
      });
      links += await this.linkIdentifiers(
        `${message}\n${string(object(payload).ref) ?? ''}`,
        project.id,
        'commit',
        row.id,
      );
      for (const file of this.files(commit)) {
        await this.link(
          'commit',
          row.id,
          'file',
          file,
          this.isTestFile(file) ? 'tests' : 'changes',
        );
        links += 1;
      }
      saved.push(row.id);
    }
    return { provider, accepted: true, commits: saved.length, commitIds: saved, linked: links > 0 };
  }

  async handlePullRequest(payload: unknown, provider: Provider) {
    const body = object(payload);
    const pr = object(body.pull_request ?? body.object_attributes);
    if (!Object.keys(pr).length) return this.skipped(provider, 'pull_request_missing');
    const repositoryUrl = this.repositoryUrl(payload, provider, true);
    if (!repositoryUrl) return this.skipped(provider, 'repository_identity_invalid');
    const project = await this.prisma.project.findUnique({ where: { repositoryUrl } });
    if (!project) return this.skipped(provider, 'repository_not_mapped');

    const number = Number(pr.number ?? pr.iid);
    const url = string(pr.html_url) ?? string(pr.web_url) ?? string(pr.url);
    if (!Number.isInteger(number) || number < 1 || !url)
      return this.skipped(provider, 'pull_request_invalid');

    const row = await this.prisma.pullRequest.upsert({
      where: { provider_number_url: { provider, number, url } },
      create: {
        provider,
        number,
        repositoryUrl,
        title: string(pr.title) ?? '',
        url,
        state: string(pr.state) ?? 'open',
        author: string(object(pr.user).login) ?? string(object(body.user).username) ?? '',
      },
      update: {
        repositoryUrl,
        title: string(pr.title) ?? '',
        state: string(pr.state) ?? 'open',
        author: string(object(pr.user).login) ?? string(object(body.user).username) ?? '',
      },
    });
    const identifiers = [pr.title, pr.body, pr.description, pr.source_branch, pr.target_branch]
      .map(string)
      .filter((value): value is string => value !== null)
      .join('\n');
    let links = await this.linkIdentifiers(identifiers, project.id, 'pull_request', row.id);
    for (const file of this.files(pr)) {
      await this.link(
        'pull_request',
        row.id,
        'file',
        file,
        this.isTestFile(file) ? 'tests' : 'changes',
      );
      links += 1;
    }
    return { provider, accepted: true, pullRequestId: row.id, linked: links > 0 };
  }

  private skipped(provider: Provider, reason: string) {
    return { provider, accepted: false, linked: false, skipped: reason };
  }

  private repositoryUrl(
    payload: unknown,
    provider: Provider,
    isPullRequest: boolean,
  ): string | null {
    const body = object(payload);
    let value: unknown;
    if (provider === 'github') {
      const repositoryUrl = object(body.repository).html_url;
      if (isPullRequest) {
        const baseUrl = object(object(object(body.pull_request).base).repo).html_url;
        const targetUrl = this.normalizeIdentity(baseUrl);
        const payloadUrl = this.normalizeIdentity(repositoryUrl);
        return targetUrl && (!payloadUrl || payloadUrl === targetUrl) ? targetUrl : null;
      }
      value = repositoryUrl;
    } else {
      const project = object(body.project);
      value = project.web_url;
      if (isPullRequest) {
        const targetProjectId = object(body.object_attributes).target_project_id;
        if (
          project.id == null ||
          targetProjectId == null ||
          String(project.id) !== String(targetProjectId)
        )
          return null;
      }
    }
    return this.normalizeIdentity(value);
  }

  private normalizeIdentity(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
      return normalizeRepositoryUrl(value);
    } catch {
      return null;
    }
  }

  private files(payload: unknown): string[] {
    const body = object(payload);
    const nestedChanges = object(body.changes).changes;
    const values = [
      body.files,
      body.changed_files,
      body.added,
      body.modified,
      body.removed,
      Array.isArray(body.changes) ? body.changes : nestedChanges,
    ];
    return values
      .flatMap((value) => (Array.isArray(value) ? value : []))
      .map((value) => {
        if (typeof value === 'string') return value;
        const file = object(value);
        return (
          string(file.filename) ??
          string(file.new_path) ??
          string(file.path) ??
          string(file.file) ??
          ''
        );
      })
      .filter((file, index, files) => file.length > 0 && files.indexOf(file) === index);
  }

  private isTestFile(file: string) {
    return /(^|\/)(__tests__|test|tests)(\/|$)|\.(spec|test)\.[^.]+$/i.test(file);
  }

  private async linkIdentifiers(
    text: string,
    projectId: string,
    targetType: TraceTarget,
    targetId: string,
  ) {
    const parsed = this.parser.parse(text);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    // 开发者只会把人类可读的编号写进 commit，不会写 uuid
    const codes = parsed.requirementIds;
    const prdIds = parsed.prdIds.filter((id) => uuid.test(id));
    const [requirements, prds] = await Promise.all([
      codes.length
        ? this.prisma.requirement.findMany({
            where: { code: { in: codes }, projectId },
            select: { id: true },
          })
        : [],
      prdIds.length
        ? this.prisma.prd.findMany({
            where: { id: { in: prdIds }, requirement: { projectId } },
            select: { id: true },
          })
        : [],
    ]);
    for (const requirement of requirements)
      await this.link('requirement', requirement.id, targetType, targetId, 'implements');
    for (const prd of prds) await this.link('prd', prd.id, targetType, targetId, 'implements');
    return requirements.length + prds.length;
  }

  private link(
    sourceType: string,
    sourceId: string,
    targetType: string,
    targetId: string,
    linkType: string,
  ) {
    return this.prisma.traceLink.upsert({
      where: {
        sourceType_sourceId_targetType_targetId: { sourceType, sourceId, targetType, targetId },
      },
      create: { sourceType, sourceId, targetType, targetId, linkType },
      update: { linkType },
    });
  }
}
