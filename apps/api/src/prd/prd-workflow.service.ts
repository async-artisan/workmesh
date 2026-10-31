import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalStatus, DecisionStatus, PrdStatus, SpecStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAccessService } from '../projects/project-access.service';

@Injectable()
export class PrdWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}
  async createTemplate(
    userId: string,
    projectId: string,
    data: {
      name: string;
      content: string;
      description?: string;
      variables?: unknown[];
      isDefault?: boolean;
    },
  ) {
    await this.access.assertMember(userId, projectId);
    if (data.isDefault)
      await this.prisma.prdTemplate.updateMany({
        where: { projectId },
        data: { isDefault: false },
      });
    return this.prisma.prdTemplate.create({
      data: {
        projectId,
        createdById: userId,
        name: data.name,
        content: data.content,
        description: data.description,
        variables: (data.variables ?? []) as any,
        isDefault: data.isDefault ?? false,
      },
    });
  }
  async templates(userId: string, projectId: string) {
    await this.access.assertMember(userId, projectId);
    return this.prisma.prdTemplate.findMany({
      where: { projectId },
      orderBy: { updatedAt: 'desc' },
    });
  }
  async approvals(userId: string, prdId: string) {
    const prd = await this.prisma.prd.findUnique({
      where: { id: prdId },
      select: { requirement: { select: { projectId: true } } },
    });
    if (!prd) throw new NotFoundException('PRD 不存在');
    await this.access.assertMember(userId, prd.requirement.projectId);
    return this.prisma.prdApproval.findMany({
      where: { prdId },
      orderBy: { createdAt: 'desc' },
      include: { approver: { select: { id: true, name: true, email: true } } },
    });
  }
  async submitApproval(userId: string, prdId: string, approverId: string, comment?: string) {
    const prd = await this.prisma.prd.findUnique({
      where: { id: prdId },
      select: { requirement: { select: { projectId: true } } },
    });
    if (!prd) throw new NotFoundException('PRD 不存在');
    await this.access.assertMember(userId, prd.requirement.projectId);
    await this.access.assertMember(approverId, prd.requirement.projectId);
    return this.prisma.prdApproval.upsert({
      where: { prdId_approverId: { prdId, approverId } },
      create: { prdId, approverId, comment },
      update: { comment, status: ApprovalStatus.PENDING },
    });
  }
  async decideApproval(
    userId: string,
    approvalId: string,
    status: ApprovalStatus,
    comment?: string,
  ) {
    const approval = await this.prisma.prdApproval.findUnique({
      where: { id: approvalId },
      include: { prd: { include: { requirement: true } } },
    });
    if (!approval) throw new NotFoundException('审批记录不存在');
    await this.access.assertMember(userId, approval.prd.requirement.projectId);
    if (approval.approverId !== userId) throw new ForbiddenException('仅指定审批人可处理此审批');
    if (status === ApprovalStatus.PENDING)
      throw new BadRequestException('审批决定不能设置为待处理');
    const result = await this.prisma.prdApproval.update({
      where: { id: approvalId },
      data: { status, comment },
    });
    if (
      status === ApprovalStatus.APPROVED &&
      (await this.prisma.prdApproval.count({
        where: { prdId: approval.prdId, status: { not: ApprovalStatus.APPROVED } },
      })) === 0
    )
      await this.prisma.prd.update({
        where: { id: approval.prdId },
        data: { status: PrdStatus.APPROVED },
      });
    if (status === ApprovalStatus.REJECTED || status === ApprovalStatus.CHANGES_REQUESTED)
      await this.prisma.prd.update({
        where: { id: approval.prdId },
        data: { status: PrdStatus.REJECTED },
      });
    return result;
  }
  async revise(userId: string, prdId: string, content: string) {
    const prd = await this.prisma.prd.findUnique({
      where: { id: prdId },
      include: { requirement: true },
    });
    if (!prd) throw new NotFoundException('PRD 不存在');
    await this.access.assertMember(userId, prd.requirement.projectId);
    const next = prd.version + 1;
    return this.prisma.$transaction(async (tx) => {
      await tx.prdVersion.create({
        data: { prdId, version: prd.version, content: prd.content, createdById: userId },
      });
      return tx.prd.update({
        where: { id: prdId },
        data: { version: next, content, status: PrdStatus.DRAFT },
      });
    });
  }
  async versions(userId: string, prdId: string) {
    const prd = await this.prisma.prd.findUnique({
      where: { id: prdId },
      include: { requirement: true },
    });
    if (!prd) throw new NotFoundException('PRD 不存在');
    await this.access.assertMember(userId, prd.requirement.projectId);
    const history = await this.prisma.prdVersion.findMany({
      where: { prdId },
      orderBy: { version: 'desc' },
    });
    return [
      { version: prd.version, content: prd.content, createdAt: prd.createdAt, current: true },
      ...history.map((item) => ({ ...item, current: false })),
    ];
  }
  async restoreVersion(userId: string, prdId: string, version: number) {
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException('PRD 版本号无效');
    const prd = await this.prisma.prd.findUnique({
      where: { id: prdId },
      include: { requirement: true },
    });
    if (!prd) throw new NotFoundException('PRD 不存在');
    await this.access.assertMember(userId, prd.requirement.projectId);
    const historical = await this.prisma.prdVersion.findUnique({
      where: { prdId_version: { prdId, version } },
    });
    if (!historical) throw new NotFoundException('PRD 历史版本不存在');
    const next = prd.version + 1;
    return this.prisma.$transaction(async (tx) => {
      await tx.prdVersion.create({
        data: { prdId, version: prd.version, content: prd.content, createdById: userId },
      });
      return tx.prd.update({
        where: { id: prdId },
        data: { version: next, content: historical.content, status: PrdStatus.DRAFT },
      });
    });
  }
  async exportMarkdown(userId: string, prdId: string) {
    const prd = await this.prisma.prd.findUnique({
      where: { id: prdId },
      include: { requirement: true },
    });
    if (!prd) throw new NotFoundException('PRD 不存在');
    await this.access.assertMember(userId, prd.requirement.projectId);
    return {
      filename: `${prd.title.replace(/[^\w\u4e00-\u9fa5-]+/g, '-')}-v${prd.version}.md`,
      content: `# ${prd.title}\n\n${prd.content}`,
    };
  }
  async exportHtml(userId: string, prdId: string) {
    const file = await this.exportMarkdown(userId, prdId);
    const escape = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = file.content
      .split(/\r?\n/)
      .map((line) => {
        if (line.startsWith('### ')) return `<h3>${escape(line.slice(4))}</h3>`;
        if (line.startsWith('## ')) return `<h2>${escape(line.slice(3))}</h2>`;
        if (line.startsWith('# ')) return `<h1>${escape(line.slice(2))}</h1>`;
        if (line.startsWith('- ')) return `<li>${escape(line.slice(2))}</li>`;
        return line.trim() ? `<p>${escape(line)}</p>` : '';
      })
      .join('\n');
    return {
      filename: file.filename.replace(/\.md$/, '.html'),
      content: `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ReqFlow PRD</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 24px;color:#26324a}h1,h2,h3{line-height:1.3;margin-top:1.8em}li{margin-left:1.4em}p{white-space:pre-wrap}@media print{body{margin:0 auto}}</style><article>${body}</article></html>`,
    };
  }
  async createSpec(
    userId: string,
    projectId: string,
    title: string,
    content: string,
    prdId?: string,
  ) {
    await this.access.assertMember(userId, projectId);
    return this.prisma.technicalSpec.create({
      data: { projectId, prdId, title, content, createdById: userId },
    });
  }
  specs(userId: string, projectId: string) {
    return this.access.assertMember(userId, projectId).then(() =>
      this.prisma.technicalSpec.findMany({
        where: { projectId },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  }
  async setSpecStatus(userId: string, id: string, status: SpecStatus) {
    return this.updateSpec(userId, id, { status });
  }
  async updateSpec(
    userId: string,
    id: string,
    data: { title?: string; content?: string; status?: SpecStatus },
  ) {
    const spec = await this.prisma.technicalSpec.findUnique({ where: { id } });
    if (!spec) throw new NotFoundException('技术规格不存在');
    await this.access.assertMember(userId, spec.projectId);
    return this.prisma.technicalSpec.update({ where: { id }, data });
  }
  async createDecision(
    userId: string,
    projectId: string,
    title: string,
    context: string,
    decision: string,
    consequences?: string,
  ) {
    await this.access.assertMember(userId, projectId);
    return this.prisma.technicalDecision.create({
      data: { projectId, title, context, decision, consequences, createdById: userId },
    });
  }
  decisions(userId: string, projectId: string) {
    return this.access.assertMember(userId, projectId).then(() =>
      this.prisma.technicalDecision.findMany({
        where: { projectId },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  }
  async setDecisionStatus(userId: string, id: string, status: DecisionStatus) {
    return this.updateDecision(userId, id, { status });
  }
  async updateDecision(
    userId: string,
    id: string,
    data: {
      title?: string;
      context?: string;
      decision?: string;
      consequences?: string;
      status?: DecisionStatus;
    },
  ) {
    const decision = await this.prisma.technicalDecision.findUnique({ where: { id } });
    if (!decision) throw new NotFoundException('技术决策不存在');
    await this.access.assertMember(userId, decision.projectId);
    return this.prisma.technicalDecision.update({ where: { id }, data });
  }
}
