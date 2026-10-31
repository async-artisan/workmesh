import 'reflect-metadata';
import { ApprovalStatus, DecisionStatus, SpecStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth/auth.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { KnowledgeController } from './knowledge/knowledge.controller';
import { PrdController } from './prd/prd.controller';
import { PrdWorkflowController } from './prd/prd-workflow.controller';
import { ProjectsController } from './projects/projects.controller';
import { DependencyController } from './requirements/dependency.controller';
import { RequirementsController } from './requirements/requirements.controller';
import { TraceController } from './trace/trace.controller';
import { AppController } from './app.controller';
import { MetricsService } from './common/metrics.service';

const request = { user: { sub: 'user-1' } } as never;

describe('API controllers', () => {
  it('returns health and metric snapshots', () => {
    const metrics = new MetricsService();
    const app = new AppController(metrics);
    metrics.record(12);
    metrics.record(8, true);
    expect(app.health()).toEqual({ status: 'ok' });
    expect(app.metricsSnapshot()).toEqual({
      requests: 2,
      failures: 1,
      averageDurationMs: 10,
      p95DurationMs: 12,
      p99DurationMs: 12,
    });
  });

  it('delegates auth operations and validates avatar content', async () => {
    const auth = Object.fromEntries(
      [
        'register',
        'login',
        'refresh',
        'logout',
        'logoutAll',
        'getProfile',
        'updateProfile',
        'changePassword',
        'updateAvatar',
        'getAvatar',
      ].map((method) => [method, vi.fn().mockResolvedValue(undefined)]),
    ) as Record<string, ReturnType<typeof vi.fn>>;
    auth.getAvatar.mockResolvedValueOnce(null).mockResolvedValueOnce({
      avatarMimeType: 'image/png',
      avatarData: Buffer.from('image'),
    });
    const controller = new AuthController(auth as never);
    const dto = { value: true };
    controller.register(dto as never);
    controller.login(dto as never);
    controller.refresh(dto as never);
    controller.logout({ refreshToken: 'refresh-1' } as never);
    controller.logoutAll(request);
    controller.profile(request);
    controller.updateProfile(request, dto as never);
    controller.changePassword(request, dto as never);
    expect(auth.register).toHaveBeenCalledWith(dto);
    expect(auth.login).toHaveBeenCalledWith(dto);
    expect(auth.refresh).toHaveBeenCalledWith(dto);
    expect(auth.logout).toHaveBeenCalledWith('refresh-1');
    expect(auth.logoutAll).toHaveBeenCalledWith('user-1');
    expect(auth.getProfile).toHaveBeenCalledWith('user-1');
    expect(auth.updateProfile).toHaveBeenCalledWith('user-1', dto);
    expect(auth.changePassword).toHaveBeenCalledWith('user-1', dto);

    await expect(controller.updateAvatar(request, undefined)).rejects.toMatchObject({
      status: 400,
    });
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await controller.updateAvatar(request, {
      mimetype: 'image/png',
      buffer: png,
    } as never);
    expect(auth.updateAvatar).toHaveBeenCalledWith('user-1', 'image/png', png);

    const response = { sendStatus: vi.fn(), type: vi.fn(), set: vi.fn(), send: vi.fn() };
    response.type.mockReturnValue(response);
    response.set.mockReturnValue(response);
    await controller.avatar(request, response as never);
    expect(response.sendStatus).toHaveBeenCalledWith(404);
    await controller.avatar(request, response as never);
    expect(response.type).toHaveBeenCalledWith('image/png');
    expect(response.send).toHaveBeenCalledWith(Buffer.from('image'));
  });

  it('delegates project, requirement, dependency, trace, and dashboard actions', () => {
    const projects = Object.fromEntries(
      ['list', 'create', 'update', 'remove'].map((method) => [method, vi.fn()]),
    );
    const projectController = new ProjectsController(projects as never);
    projectController.list(request);
    projectController.create(request, { name: 'P' } as never);
    projectController.update(request, 'p-1', { name: 'P2' } as never);
    projectController.remove(request, 'p-1');
    expect(projects.list).toHaveBeenCalledWith('user-1');
    expect(projects.create).toHaveBeenCalledWith('user-1', { name: 'P' });
    expect(projects.update).toHaveBeenCalledWith('user-1', 'p-1', { name: 'P2' });
    expect(projects.remove).toHaveBeenCalledWith('user-1', 'p-1');

    const requirements = Object.fromEntries(
      ['list', 'get', 'create', 'update', 'remove'].map((method) => [method, vi.fn()]),
    );
    const requirementController = new RequirementsController(requirements as never);
    const query = { status: 'OPEN' };
    const create = { title: 'Requirement' };
    const update = { title: 'Updated' };
    requirementController.list(request, query as never);
    requirementController.get(request, 'r-1');
    requirementController.create(request, create as never);
    requirementController.update(request, 'r-1', update as never);
    requirementController.remove(request, 'r-1');
    expect(requirements.list).toHaveBeenCalledWith('user-1', query);
    expect(requirements.get).toHaveBeenCalledWith('user-1', 'r-1');
    expect(requirements.create).toHaveBeenCalledWith('user-1', create);
    expect(requirements.update).toHaveBeenCalledWith('user-1', 'r-1', update);
    expect(requirements.remove).toHaveBeenCalledWith('user-1', 'r-1');

    const dependencies = Object.fromEntries(
      ['list', 'create', 'remove'].map((method) => [method, vi.fn()]),
    );
    const dependencyController = new DependencyController(dependencies as never);
    dependencyController.list(request, 'r-1');
    dependencyController.create(request, 'r-1', { toId: 'r-2', type: 'blocks' } as never);
    dependencyController.remove(request, 'd-1');
    expect(dependencies.list).toHaveBeenCalledWith('user-1', 'r-1');
    expect(dependencies.create).toHaveBeenCalledWith('user-1', 'r-1', 'r-2', 'blocks');
    expect(dependencies.remove).toHaveBeenCalledWith('user-1', 'd-1');

    const traces = Object.fromEntries(
      ['list', 'create', 'graph'].map((method) => [method, vi.fn()]),
    );
    const traceController = new TraceController(traces as never);
    traceController.list(request, 'r-1');
    traceController.create(request, 'r-1', {
      kind: 'code',
      targetId: 'file-1',
      prdId: 'prd-1',
      metadata: {},
    } as never);
    traceController.graph(request, 'p-1');
    expect(traces.list).toHaveBeenCalledWith('user-1', 'r-1');
    expect(traces.create).toHaveBeenCalledWith('user-1', 'r-1', 'code', 'file-1', 'prd-1', {});
    expect(traces.graph).toHaveBeenCalledWith('user-1', 'p-1');

    const dashboard = { summary: vi.fn() };
    new DashboardController(dashboard as never).summary(request);
    expect(dashboard.summary).toHaveBeenCalledWith('user-1');
  });

  it('delegates knowledge actions and rejects missing or malformed uploads', async () => {
    const knowledge = Object.fromEntries(
      ['list', 'update', 'remove', 'create', 'addDocument', 'search', 'buildContext'].map(
        (method) => [method, vi.fn()],
      ),
    );
    const controller = new KnowledgeController(knowledge as never);
    controller.list(request, 'p-1', { page: 2, limit: 10 } as never);
    controller.update(request, 'kb-1', { name: 'Name', description: 'Description' } as never);
    controller.remove(request, 'kb-1');
    controller.create(request, 'p-1', { name: 'Name', description: 'Description' } as never);
    controller.add(request, 'kb-1', {
      filename: 'notes.md',
      mimeType: 'text/markdown',
      content: 'text',
    } as never);
    controller.search(request, 'kb-1', { query: 'text' } as never);
    controller.context(request, 'kb-1', 'text', '0');
    expect(knowledge.list).toHaveBeenCalledWith('user-1', 'p-1', 2, 10);
    expect(knowledge.update).toHaveBeenCalledWith('user-1', 'kb-1', 'Name', 'Description');
    expect(knowledge.remove).toHaveBeenCalledWith('user-1', 'kb-1');
    expect(knowledge.create).toHaveBeenCalledWith('user-1', 'p-1', 'Name', 'Description');
    expect(knowledge.addDocument).toHaveBeenCalledWith(
      'user-1',
      'kb-1',
      'notes.md',
      'text/markdown',
      'text',
    );
    expect(knowledge.search).toHaveBeenCalledWith('user-1', 'kb-1', 'text', undefined, undefined);
    expect(knowledge.buildContext).toHaveBeenCalledWith('user-1', 'kb-1', 'text', 6000);
    await expect(controller.upload(request, 'kb-1')).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.upload(request, 'kb-1', {
        originalname: 'broken.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('not a PDF'),
      } as never),
    ).rejects.toMatchObject({ status: 400 });
    await controller.upload(request, 'kb-1', {
      originalname: 'notes.md',
      mimetype: 'text/markdown',
      buffer: Buffer.from('searchable text'),
    } as never);
    expect(knowledge.addDocument).toHaveBeenLastCalledWith(
      'user-1',
      'kb-1',
      'notes.md',
      'text/markdown',
      'searchable text',
    );
  });

  it('delegates PRD operations and exports both formats', async () => {
    const prds = {
      list: vi.fn(),
      create: vi.fn(),
    };
    const prdController = new PrdController(prds as never);
    const body = { title: '登录 PRD', content: '# PRD', templateId: 't-1' };
    prdController.list(request, 'r-1');
    prdController.create(request, 'r-1', body);
    expect(prds.list).toHaveBeenCalledWith('user-1', 'r-1');
    expect(prds.create).toHaveBeenCalledWith('user-1', 'r-1', body);

    const methods = [
      'templates',
      'createTemplate',
      'submitApproval',
      'decideApproval',
      'revise',
      'versions',
      'restoreVersion',
      'exportHtml',
      'exportMarkdown',
      'specs',
      'createSpec',
      'setSpecStatus',
      'decisions',
      'createDecision',
      'setDecisionStatus',
    ];
    const workflow = Object.fromEntries(methods.map((method) => [method, vi.fn()]));
    workflow.exportHtml.mockResolvedValue({ filename: 'spec.html', content: '<h1>PRD</h1>' });
    workflow.exportMarkdown.mockResolvedValue({ filename: 'spec.md', content: '# PRD' });
    const controller = new PrdWorkflowController(workflow as never);
    const template = { name: 't', content: 'c', isDefault: true };
    controller.templates(request, 'p-1');
    controller.createTemplate(request, 'p-1', template as never);
    controller.submit(request, 'prd-1', { approverId: 'approver-1', comment: 'review' });
    controller.decide(request, 'approval-1', {
      status: ApprovalStatus.APPROVED,
      comment: 'approved',
    });
    controller.revise(request, 'prd-1', { content: 'v2' });
    controller.versions(request, 'prd-1');
    controller.restore(request, 'prd-1', 2);
    controller.specs(request, 'p-1');
    controller.createSpec(request, 'p-1', { title: 's', content: 'c', prdId: 'prd-1' });
    controller.setSpecStatus(request, 'spec-1', { status: SpecStatus.APPROVED });
    controller.decisions(request, 'p-1');
    controller.createDecision(request, 'p-1', {
      title: 'd',
      context: 'c',
      decision: 'yes',
      consequences: 'x',
    });
    controller.setDecisionStatus(request, 'decision-1', { status: DecisionStatus.ACCEPTED });
    expect(workflow.createTemplate).toHaveBeenCalledWith('user-1', 'p-1', template);
    expect(workflow.submitApproval).toHaveBeenCalledWith('user-1', 'prd-1', 'approver-1', 'review');
    expect(workflow.decideApproval).toHaveBeenCalledWith(
      'user-1',
      'approval-1',
      ApprovalStatus.APPROVED,
      'approved',
    );
    expect(workflow.restoreVersion).toHaveBeenCalledWith('user-1', 'prd-1', 2);
    expect(workflow.createDecision).toHaveBeenCalledWith('user-1', 'p-1', 'd', 'c', 'yes', 'x');

    const response = { type: vi.fn(), attachment: vi.fn(), send: vi.fn() };
    response.type.mockReturnValue(response);
    response.attachment.mockReturnValue(response);
    await controller.export(request, 'prd-1', 'html', response as never);
    expect(response.type).toHaveBeenCalledWith('text/html');
    expect(response.attachment).toHaveBeenCalledWith('spec.html');
    expect(response.send).toHaveBeenCalledWith('<h1>PRD</h1>');
    await controller.export(request, 'prd-1', undefined, response as never);
    expect(response.type).toHaveBeenLastCalledWith('text/markdown');
    expect(response.attachment).toHaveBeenLastCalledWith('spec.md');
    expect(response.send).toHaveBeenLastCalledWith('# PRD');
  });
});
