import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAccessService } from '../projects/project-access.service';

@Injectable()
export class TraceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}
  async list(userId: string, requirementId: string) {
    await this.access.assertRequirementMember(userId, requirementId);
    return this.prisma.trace.findMany({ where: { requirementId }, include: { prd: true } });
  }
  async create(
    userId: string,
    requirementId: string,
    kind: string,
    targetId: string,
    prdId?: string,
    metadata?: object,
  ) {
    await this.access.assertRequirementMember(userId, requirementId);
    return this.prisma.trace.create({ data: { requirementId, kind, targetId, prdId, metadata } });
  }
  async graph(userId: string, projectId: string) {
    await this.access.assertMember(userId, projectId);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    const requirements = await this.prisma.requirement.findMany({
      where: { projectId },
      include: { prds: true, traces: true },
    });
    if (!requirements.length) return [];
    if (!project?.repositoryUrl) {
      return requirements.map((item) => ({ ...item, commits: [], pullRequests: [] }));
    }

    const requirementIds = requirements.map((item) => item.id);
    const prdIds = requirements.flatMap((item) => item.prds.map((prd) => prd.id));
    const sourceIds = [...requirementIds, ...prdIds];
    const links = sourceIds.length
      ? await this.prisma.traceLink.findMany({
          where: {
            sourceType: { in: ['requirement', 'prd'] },
            sourceId: { in: sourceIds },
            targetType: { in: ['commit', 'pull_request'] },
          },
        })
      : [];
    const commitIds = links
      .filter((link) => link.targetType === 'commit')
      .map((link) => link.targetId);
    const pullRequestIds = links
      .filter((link) => link.targetType === 'pull_request')
      .map((link) => link.targetId);
    const [commits, pullRequests] = await Promise.all([
      commitIds.length
        ? this.prisma.gitCommit.findMany({
            where: { id: { in: commitIds }, repositoryUrl: project.repositoryUrl },
          })
        : [],
      pullRequestIds.length
        ? this.prisma.pullRequest.findMany({
            where: { id: { in: pullRequestIds }, repositoryUrl: project.repositoryUrl },
          })
        : [],
    ]);
    const targetIds = [...commits.map((commit) => commit.id), ...pullRequests.map((pr) => pr.id)];
    const fileLinks = targetIds.length
      ? await this.prisma.traceLink.findMany({
          where: {
            sourceType: { in: ['commit', 'pull_request'] },
            sourceId: { in: targetIds },
            targetType: 'file',
          },
        })
      : [];
    const filesBySource = new Map<string, Array<{ path: string; linkType: string }>>();
    for (const link of fileLinks) {
      const files = filesBySource.get(link.sourceId) ?? [];
      files.push({ path: link.targetId, linkType: link.linkType });
      filesBySource.set(link.sourceId, files);
    }
    const commitsById = new Map(
      commits.map((commit) => [
        commit.id,
        { ...commit, files: filesBySource.get(commit.id) ?? [] },
      ]),
    );
    const pullRequestsById = new Map(
      pullRequests.map((pullRequest) => [
        pullRequest.id,
        { ...pullRequest, files: filesBySource.get(pullRequest.id) ?? [] },
      ]),
    );
    const linkedTargets = (itemId: string, targetType: 'commit' | 'pull_request') =>
      links
        .filter((link) => link.sourceId === itemId && link.targetType === targetType)
        .map((link) =>
          targetType === 'commit'
            ? commitsById.get(link.targetId)
            : pullRequestsById.get(link.targetId),
        )
        .filter((target): target is NonNullable<typeof target> => Boolean(target));
    const targetsFor = (
      item: (typeof requirements)[number],
      targetType: 'commit' | 'pull_request',
    ) => {
      const targets = [
        ...linkedTargets(item.id, targetType),
        ...item.prds.flatMap((prd) => linkedTargets(prd.id, targetType)),
      ];
      return targets.filter(
        (target, index) => targets.findIndex((candidate) => candidate.id === target.id) === index,
      );
    };

    return requirements.map((item) => ({
      ...item,
      commits: targetsFor(item, 'commit'),
      pullRequests: targetsFor(item, 'pull_request'),
    }));
  }
}
