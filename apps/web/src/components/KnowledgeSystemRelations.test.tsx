import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  KnowledgeSystemRelations,
  type KnowledgeSystemDependency,
  type KnowledgeSystemUnit,
} from './KnowledgeSystemRelations';

const units: KnowledgeSystemUnit[] = [
  { id: 'unit-api', key: 'api', name: '支付 API', status: 'ACTIVE' },
  { id: 'unit-ledger', key: 'ledger', name: '账务服务', status: 'ACTIVE' },
];

const dependencies: KnowledgeSystemDependency[] = [
  {
    id: 'dep-1',
    fromUnitId: 'unit-api',
    toUnitId: 'unit-ledger',
    edgeKind: 'CALLS',
    protocol: 'HTTP',
    source: 'DECLARED',
    confidence: 'HIGH',
    evidence: '支付 API 运行手册',
  },
];

function renderRelations(
  overrides: Partial<React.ComponentProps<typeof KnowledgeSystemRelations>> = {},
) {
  return render(
    <KnowledgeSystemRelations
      projectId="p1"
      loadUnits={vi.fn().mockResolvedValue(units)}
      loadDependencies={vi.fn().mockResolvedValue(dependencies)}
      {...overrides}
    />,
  );
}

describe('KnowledgeSystemRelations', () => {
  it('按 fromUnit 到 toUnit 展示真实方向和关系来源', async () => {
    renderRelations();

    const panel = await screen.findByTestId('knowledge-system-relations');
    expect(await within(panel).findByText('支付 API（api）')).toBeInTheDocument();
    expect(within(panel).getByText('账务服务（ledger）')).toBeInTheDocument();
    expect(within(panel).getByText('CALLS')).toBeInTheDocument();
    expect(within(panel).getByText('DECLARED')).toBeInTheDocument();
    expect(within(panel).getByText(/fromUnit → toUnit/)).toBeInTheDocument();
  });

  it('加载期间提供可读状态，完成后显示空关系态', async () => {
    let resolveUnits!: (value: KnowledgeSystemUnit[]) => void;
    let resolveDependencies!: (value: KnowledgeSystemDependency[]) => void;
    const unitsPromise = new Promise<KnowledgeSystemUnit[]>((resolve) => {
      resolveUnits = resolve;
    });
    const dependenciesPromise = new Promise<KnowledgeSystemDependency[]>((resolve) => {
      resolveDependencies = resolve;
    });
    renderRelations({
      loadUnits: vi.fn().mockReturnValue(unitsPromise),
      loadDependencies: vi.fn().mockReturnValue(dependenciesPromise),
    });
    expect(screen.getByText('正在读取系统关系…')).toBeInTheDocument();
    resolveUnits([]);
    resolveDependencies([]);
    expect(await screen.findByText('当前项目还没有已声明的系统上下游关系。')).toBeInTheDocument();
  });

  it('读取失败时保留错误和重试入口', async () => {
    const loadUnits = vi.fn().mockRejectedValue(new Error('服务暂不可用'));
    renderRelations({ loadUnits });
    expect(await screen.findByRole('alert')).toHaveTextContent('服务暂不可用');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('没有项目时不调用 API 并提示先选择项目', async () => {
    const loadUnits = vi.fn();
    const loadDependencies = vi.fn();
    render(
      <KnowledgeSystemRelations
        projectId={null}
        loadUnits={loadUnits}
        loadDependencies={loadDependencies}
      />,
    );
    expect(screen.getByText('先选择项目，再查看系统单元之间的已声明关系。')).toBeInTheDocument();
    await waitFor(() => {
      expect(loadUnits).not.toHaveBeenCalled();
      expect(loadDependencies).not.toHaveBeenCalled();
    });
  });
});
