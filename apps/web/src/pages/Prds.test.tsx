import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prds } from './Prds';

const api = vi.hoisted(() => ({
  prd: {
    list: vi.fn(),
    versions: vi.fn(),
    templates: vi.fn(),
    createTemplate: vi.fn(),
    specs: vi.fn(),
    decisions: vi.fn(),
    updateSpecContent: vi.fn(),
    updateDecisionContent: vi.fn(),
    restore: vi.fn(),
    approvals: vi.fn(),
  },
  project: { list: vi.fn(), members: vi.fn() },
  requirement: { list: vi.fn() },
  knowledge: { list: vi.fn() },
}));

vi.mock('../api/resources', () => ({
  prdApi: api.prd,
  projectApi: api.project,
  requirementApi: api.requirement,
  knowledgeApi: api.knowledge,
}));

function renderPrds() {
  return render(
    <MemoryRouter>
      <Prds />
    </MemoryRouter>,
  );
}

async function selectProjectAndRequirement() {
  renderPrds();
  const row = (await screen.findByText('Login flow')).closest('tr');
  if (!row) throw new Error('Requirement row was not rendered');
  fireEvent.click(within(row).getByRole('button', { name: '选择' }));
  await screen.findByText('current');
}

describe('Prds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.project.list.mockResolvedValue([{ id: 'project-1', name: 'Demo', key: 'DEMO' }]);
    api.project.members.mockResolvedValue([]);
    api.prd.approvals.mockResolvedValue([]);
    api.requirement.list.mockResolvedValue({
      items: [{ id: 'requirement-1', title: 'Login flow', status: 'NEW' }],
      total: 1,
      page: 1,
      limit: 50,
    });
    api.knowledge.list.mockResolvedValue({ items: [] });
    api.prd.list.mockResolvedValue([
      { id: 'prd-1', title: 'Checkout', version: 2, content: 'current' },
    ]);
    api.prd.versions.mockResolvedValue([
      { version: 2, content: 'current', current: true },
      { version: 1, content: 'previous', current: false },
    ]);
    api.prd.templates.mockResolvedValue([{ id: 'template-1', name: 'Product template' }]);
    api.prd.specs.mockResolvedValue([
      { id: 'spec-1', title: 'API', content: 'REST', status: 'DRAFT' },
    ]);
    api.prd.decisions.mockResolvedValue([
      {
        id: 'decision-1',
        title: 'Database',
        context: 'Current scale',
        decision: 'Use PostgreSQL',
        consequences: 'Simple operations',
        status: 'PROPOSED',
      },
    ]);
    api.prd.createTemplate.mockResolvedValue({ id: 'template-2' });
    api.prd.updateSpecContent.mockResolvedValue(undefined);
    api.prd.updateDecisionContent.mockResolvedValue(undefined);
    api.prd.restore.mockResolvedValue({
      id: 'prd-1',
      title: 'Checkout',
      version: 3,
      content: 'previous',
    });
  });

  it('creates a project template in a modal', async () => {
    renderPrds();
    expect(await screen.findByText('Product template')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新建模板' }));
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: 'Release template' } });
    fireEvent.change(screen.getByLabelText('模板内容'), { target: { value: '# Overview' } });
    fireEvent.click(screen.getByRole('button', { name: '创建模板' }));

    await waitFor(() =>
      expect(api.prd.createTemplate).toHaveBeenCalledWith('project-1', {
        name: 'Release template',
        content: '# Overview',
        isDefault: false,
      }),
    );
  });

  it('previews and restores a selected PRD version', async () => {
    await selectProjectAndRequirement();

    fireEvent.click(screen.getByRole('button', { name: '预览版本 1' }));
    expect(await screen.findByText('previous')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '恢复版本 1' }));

    await waitFor(() => expect(api.prd.restore).toHaveBeenCalledWith('prd-1', 1));
  });

  it('saves edits to existing technical specifications and decisions in modals', async () => {
    await selectProjectAndRequirement();
    expect(await screen.findByText('API')).toBeInTheDocument();

    const specRow = screen.getByText('API').closest('tr');
    if (!specRow) throw new Error('Technical specification row was not rendered');
    fireEvent.click(within(specRow).getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('编辑规格标题'), { target: { value: 'Public API' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(api.prd.updateSpecContent).toHaveBeenCalledWith('spec-1', {
        title: 'Public API',
        content: 'REST',
      }),
    );

    const decisionRow = screen.getByText('Database').closest('tr');
    if (!decisionRow) throw new Error('Technical decision row was not rendered');
    fireEvent.click(within(decisionRow).getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('编辑决策内容'), {
      target: { value: 'Keep PostgreSQL' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(api.prd.updateDecisionContent).toHaveBeenCalledWith('decision-1', {
        title: 'Database',
        context: 'Current scale',
        decision: 'Keep PostgreSQL',
        consequences: 'Simple operations',
      }),
    );
  });
});
