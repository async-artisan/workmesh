import { ApprovalStatus, DecisionStatus, PrdStatus, SpecStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrdWorkflowService } from './prd-workflow.service';

const approval = {
  id: 'approval-1',
  prdId: 'prd-1',
  approverId: 'approver-1',
  prd: { requirement: { projectId: 'project-1' } },
};

describe('PrdWorkflowService approvals', () => {
  it('requires the assigned approver to decide', async () => {
    const update = vi.fn();
    const service = new PrdWorkflowService(
      { prdApproval: { findUnique: vi.fn().mockResolvedValue(approval), update } } as never,
      { assertMember: vi.fn() } as never,
    );

    await expect(
      service.decideApproval('another-member', 'approval-1', ApprovalStatus.APPROVED),
    ).rejects.toMatchObject({ status: 403 });
    expect(update).not.toHaveBeenCalled();
  });

  it('approves a PRD only after every assigned approval is approved', async () => {
    const count = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const updatePrd = vi.fn();
    const service = new PrdWorkflowService(
      {
        prdApproval: {
          findUnique: vi.fn().mockResolvedValue(approval),
          update: vi.fn().mockResolvedValue({ id: 'approval-1' }),
          count,
        },
        prd: { update: updatePrd },
      } as never,
      { assertMember: vi.fn() } as never,
    );

    await service.decideApproval('approver-1', 'approval-1', ApprovalStatus.APPROVED);
    expect(updatePrd).not.toHaveBeenCalled();
    await service.decideApproval('approver-1', 'approval-1', ApprovalStatus.APPROVED);
    expect(updatePrd).toHaveBeenCalledOnce();
  });

  it('requires assigned approvers to be project members', async () => {
    const assertMember = vi.fn().mockResolvedValue(undefined);
    const upsert = vi.fn().mockResolvedValue({ id: 'approval-1' });
    const service = new PrdWorkflowService(
      {
        prd: { findUnique: vi.fn().mockResolvedValue({ requirement: { projectId: 'project-1' } }) },
        prdApproval: { upsert },
      } as never,
      { assertMember } as never,
    );

    await service.submitApproval('member-1', 'prd-1', 'approver-1');
    expect(assertMember).toHaveBeenNthCalledWith(1, 'member-1', 'project-1');
    expect(assertMember).toHaveBeenNthCalledWith(2, 'approver-1', 'project-1');
  });
});

describe('PrdWorkflowService lifecycle', () => {
  it('creates default and regular templates and lists project templates', async () => {
    const updateMany = vi.fn();
    const create = vi.fn().mockResolvedValue({ id: 'template-1' });
    const findMany = vi.fn().mockResolvedValue([{ id: 'template-1' }]);
    const access = { assertMember: vi.fn() };
    const service = new PrdWorkflowService(
      { prdTemplate: { updateMany, create, findMany } } as never,
      access as never,
    );

    await service.createTemplate('user-1', 'project-1', {
      name: 'Default',
      content: 'content',
      isDefault: true,
    });
    await service.createTemplate('user-1', 'project-1', {
      name: 'Regular',
      content: 'content',
    });
    await expect(service.templates('user-1', 'project-1')).resolves.toEqual([{ id: 'template-1' }]);

    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      data: { isDefault: false },
    });
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ variables: [], isDefault: false }),
      }),
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      orderBy: { updatedAt: 'desc' },
    });
    expect(access.assertMember).toHaveBeenCalledTimes(3);
  });

  it('rejects missing PRDs and pending approval decisions', async () => {
    const service = new PrdWorkflowService(
      {
        prd: { findUnique: vi.fn().mockResolvedValue(null) },
        prdApproval: { findUnique: vi.fn().mockResolvedValue(null) },
      } as never,
      { assertMember: vi.fn().mockResolvedValue(undefined) } as never,
    );
    await expect(service.submitApproval('user-1', 'missing', 'approver-1')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.decideApproval('user-1', 'missing', ApprovalStatus.APPROVED),
    ).rejects.toMatchObject({ status: 404 });

    const pending = new PrdWorkflowService(
      { prdApproval: { findUnique: vi.fn().mockResolvedValue(approval) } } as never,
      { assertMember: vi.fn() } as never,
    );
    await expect(
      pending.decideApproval('approver-1', 'approval-1', ApprovalStatus.PENDING),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects PRDs when an approver rejects or requests changes', async () => {
    const updatePrd = vi.fn();
    const service = new PrdWorkflowService(
      {
        prdApproval: {
          findUnique: vi.fn().mockResolvedValue(approval),
          update: vi.fn().mockResolvedValue({ id: 'approval-1' }),
        },
        prd: { update: updatePrd },
      } as never,
      { assertMember: vi.fn() } as never,
    );

    await service.decideApproval('approver-1', 'approval-1', ApprovalStatus.REJECTED);
    await service.decideApproval('approver-1', 'approval-1', ApprovalStatus.CHANGES_REQUESTED);
    expect(updatePrd).toHaveBeenCalledTimes(2);
    expect(updatePrd).toHaveBeenCalledWith({
      where: { id: 'prd-1' },
      data: { status: PrdStatus.REJECTED },
    });
  });

  it('revises and restores PRDs transactionally and returns version history', async () => {
    const prd = {
      id: 'prd-1',
      version: 2,
      content: 'current',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      requirement: { projectId: 'project-1' },
    };
    const createVersion = vi.fn();
    const updatePrd = vi.fn().mockResolvedValue({ id: 'prd-1', version: 3 });
    const history = [{ version: 1, content: 'initial' }];
    const tx = { prdVersion: { create: createVersion }, prd: { update: updatePrd } };
    const prisma = {
      prd: { findUnique: vi.fn().mockResolvedValue(prd), update: updatePrd },
      prdVersion: {
        findMany: vi.fn().mockResolvedValue(history),
        findUnique: vi.fn().mockResolvedValue({ content: 'restored' }),
        create: createVersion,
      },
      $transaction: vi.fn((callback: (tx: any) => unknown) => callback(tx)),
    };
    const service = new PrdWorkflowService(prisma as never, { assertMember: vi.fn() } as never);

    await service.revise('user-1', 'prd-1', 'revised');
    await expect(service.versions('user-1', 'prd-1')).resolves.toEqual([
      { version: 2, content: 'current', createdAt: prd.createdAt, current: true },
      { ...history[0], current: false },
    ]);
    await expect(service.restoreVersion('user-1', 'prd-1', 0)).rejects.toMatchObject({
      status: 400,
    });
    await service.restoreVersion('user-1', 'prd-1', 1);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(createVersion).toHaveBeenCalledTimes(2);
    expect(updatePrd).toHaveBeenCalledWith({
      where: { id: 'prd-1' },
      data: { version: 3, content: 'restored', status: PrdStatus.DRAFT },
    });
  });

  it('exports escaped Markdown as safe HTML', async () => {
    const prd = {
      title: '标题 <unsafe> & name',
      content: '## Section\n### Detail\n- item\nplain <unsafe>\n\n',
      version: 4,
      requirement: { projectId: 'project-1' },
    };
    const service = new PrdWorkflowService(
      { prd: { findUnique: vi.fn().mockResolvedValue(prd) } } as never,
      { assertMember: vi.fn() } as never,
    );

    const markdown = await service.exportMarkdown('user-1', 'prd-1');
    expect(markdown.content).toContain('# 标题 <unsafe> & name');
    expect(markdown.filename).toContain('-v4.md');
    const html = await service.exportHtml('user-1', 'prd-1');
    expect(html.filename).toContain('.html');
    expect(html.content).toContain('<h1>标题 &lt;unsafe&gt; &amp; name</h1>');
    expect(html.content).toContain('<h2>Section</h2>');
    expect(html.content).toContain('<h3>Detail</h3>');
    expect(html.content).toContain('<li>item</li>');
    expect(html.content).toContain('<p>plain &lt;unsafe&gt;</p>');
  });

  it('creates and lists specs and decisions', async () => {
    const createdSpec = { id: 'spec-1' };
    const createdDecision = { id: 'decision-1' };
    const createSpec = vi.fn().mockResolvedValue(createdSpec);
    const findSpecs = vi.fn().mockResolvedValue([createdSpec]);
    const createDecision = vi.fn().mockResolvedValue(createdDecision);
    const findDecisions = vi.fn().mockResolvedValue([createdDecision]);
    const service = new PrdWorkflowService(
      {
        technicalSpec: {
          create: createSpec,
          findMany: findSpecs,
          findUnique: vi.fn().mockResolvedValue({ id: 'spec-1', projectId: 'project-1' }),
          update: vi.fn().mockResolvedValue({ status: SpecStatus.APPROVED }),
        },
        technicalDecision: {
          create: createDecision,
          findMany: findDecisions,
          findUnique: vi.fn().mockResolvedValue({ id: 'decision-1', projectId: 'project-1' }),
          update: vi.fn().mockResolvedValue({ status: DecisionStatus.ACCEPTED }),
        },
      } as never,
      { assertMember: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await service.createSpec('user-1', 'project-1', 'Manual', 'content', 'prd-1');
    await expect(service.specs('user-1', 'project-1')).resolves.toEqual([createdSpec]);
    await service.setSpecStatus('user-1', 'spec-1', SpecStatus.APPROVED);
    await service.updateSpec('user-1', 'spec-1', { title: 'Revised', content: 'Updated content' });
    await service.createDecision('user-1', 'project-1', 'Title', 'Context', 'Choice', 'Impact');
    await expect(service.decisions('user-1', 'project-1')).resolves.toEqual([createdDecision]);
    await service.setDecisionStatus('user-1', 'decision-1', DecisionStatus.ACCEPTED);
    await service.updateDecision('user-1', 'decision-1', { decision: 'Revised choice' });

    expect(createSpec).toHaveBeenCalledTimes(1);
    expect(findSpecs).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      orderBy: { updatedAt: 'desc' },
    });
    expect(createDecision).toHaveBeenCalledWith({
      data: {
        projectId: 'project-1',
        title: 'Title',
        context: 'Context',
        decision: 'Choice',
        consequences: 'Impact',
        createdById: 'user-1',
      },
    });
    expect(findDecisions).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      orderBy: { updatedAt: 'desc' },
    });
  });
});
