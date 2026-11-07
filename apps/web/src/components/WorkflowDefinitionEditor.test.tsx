import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkflowDefinitionEditor } from './WorkflowDefinitionEditor';

const roles = [
  { key: 'product', title: '产品' },
  { key: 'ops', title: '运维' },
];

function definition() {
  return {
    schemaVersion: '1.0',
    protocolVersion: '1.0',
    workflowKey: 'demo',
    title: 'Demo',
    baseRevisionId: null,
    roleExclusions: [],
    stepRemovals: [],
    roleSlots: [{ key: 'approve', roleKey: 'product', kind: 'TASK_ACCEPTANCE' }],
    steps: [
      {
        key: 'build',
        roleKey: 'product',
        kind: 'DELIVERY',
        displayName: '服务交付',
        deps: [],
        outputKinds: ['IMPL'],
        gates: [{ mode: 'ALL', reviewerSlots: ['approve'] }],
        vendorConfig: { keep: 'nested' },
      },
      {
        key: 'release',
        roleKey: 'ops',
        kind: 'RELEASE',
        deps: ['build'],
        outputKinds: ['RELEASE'],
        gates: [],
      },
    ],
    unknownConfig: { preserved: true },
  };
}

describe('WorkflowDefinitionEditor', () => {
  it('用中文显示步骤类型，同时保留服务端枚举值', () => {
    render(
      <WorkflowDefinitionEditor
        value={JSON.stringify(definition())}
        roles={roles}
        onChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));
    const kind = screen.getByLabelText('步骤 1 类型');
    expect(within(kind).getByRole('option', { name: '产品' })).toHaveValue('PRODUCT');
    expect(within(kind).getByRole('option', { name: '交付' })).toHaveValue('DELIVERY');
    expect(within(kind).getByRole('option', { name: '验证' })).toHaveValue('VERIFY');
    expect(within(kind).getByRole('option', { name: '发布' })).toHaveValue('RELEASE');
    expect(kind).toHaveValue('DELIVERY');

    const slotKind = screen.getByLabelText('评审槽位 1 用途');
    expect(
      within(slotKind).getByRole('option', { name: '任务验收（TASK_ACCEPTANCE）' }),
    ).toHaveValue('TASK_ACCEPTANCE');
    expect(
      within(slotKind).getByRole('option', { name: '发布验收（RELEASE_ACCEPTANCE）' }),
    ).toHaveValue('RELEASE_ACCEPTANCE');
    expect(
      within(screen.getByLabelText('步骤 1 评审门槛 1')).getByRole('option', {
        name: '任一通过（ANY，当前服务端不支持）',
      }),
    ).toHaveValue('ANY');
  });

  it('switches to structured mode and edits fields while preserving unknown configuration', () => {
    let value = JSON.stringify(definition(), null, 2);
    const { rerender } = render(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));
    fireEvent.change(screen.getByLabelText('流程名称'), { target: { value: '改名后的流程' } });
    rerender(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText('步骤 1 显示名称'), {
      target: { value: '  新的交付名称  ' },
    });
    rerender(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );

    const parsed = JSON.parse(value);
    expect(parsed.title).toBe('改名后的流程');
    expect(parsed.steps[0].displayName).toBe('  新的交付名称  ');
    expect(parsed.unknownConfig).toEqual({ preserved: true });
    expect(parsed.steps[0].vendorConfig).toEqual({ keep: 'nested' });
    expect(screen.getByDisplayValue('改名后的流程')).toBeInTheDocument();
    expect(screen.getByLabelText('步骤 1 显示名称')).toHaveValue('  新的交付名称  ');
  });

  it('clear of optional display name removes the field while leaving stable key intact', () => {
    let value = JSON.stringify(definition(), null, 2);
    const { rerender } = render(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));
    fireEvent.change(screen.getByLabelText('步骤 1 显示名称'), { target: { value: '   ' } });
    rerender(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );
    const parsed = JSON.parse(value);
    expect(parsed.steps[0].key).toBe('build');
    fireEvent.blur(screen.getByLabelText('步骤 1 显示名称'));
    expect(JSON.parse(value).steps[0]).not.toHaveProperty('displayName');
  });

  it('keeps unsupported array members while editing a later structured item', () => {
    const base = definition();
    let value = JSON.stringify({ ...base, steps: [null, ...base.steps] });
    const { rerender } = render(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));
    fireEvent.change(screen.getByLabelText('步骤 1 key'), { target: { value: 'build-renamed' } });
    rerender(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );

    const parsed = JSON.parse(value);
    expect(parsed.steps[0]).toBeNull();
    expect(parsed.steps[1].key).toBe('build-renamed');
  });

  it('retains unsupported dependency members when a checkbox edits the array', () => {
    const base = JSON.parse(JSON.stringify(definition())) as {
      steps: Array<{ deps: unknown[] }>;
    };
    base.steps[1].deps = ['build', 42, { futureDependency: true }];
    let value = JSON.stringify(base, null, 2);
    const { rerender } = render(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'build' }));
    rerender(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );

    expect(JSON.parse(value).steps[1].deps).toEqual([42, { futureDependency: true }]);
  });

  it('round trips structured role, output, slot, and gate edits without dropping nested fields', () => {
    const complex = JSON.parse(JSON.stringify(definition())) as {
      steps: Array<Record<string, unknown>>;
      roleSlots: Array<Record<string, unknown>>;
    };
    complex.steps[0].outputKinds = ['IMPL', { futureOutput: { keep: true } }];
    complex.steps[0].gates = [
      {
        mode: 'ANY',
        reviewerSlots: ['approve', { futureReviewer: { keep: true } }],
        gateMetadata: { keep: true },
      },
    ];
    complex.steps[0].stepMetadata = { keep: true };
    complex.roleSlots[0] = {
      ...complex.roleSlots[0],
      slotMetadata: { keep: true },
    };

    let value = JSON.stringify(complex, null, 2);
    const { rerender } = render(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));

    const refresh = () =>
      rerender(
        <WorkflowDefinitionEditor
          value={value}
          roles={roles}
          onChange={(next) => {
            value = next;
          }}
        />,
      );

    fireEvent.change(screen.getByLabelText('步骤 1 责任角色'), { target: { value: 'ops' } });
    refresh();
    fireEvent.change(screen.getByLabelText('步骤 1 输出工件类型'), {
      target: { value: 'IMPL\nCUSTOM' },
    });
    refresh();
    fireEvent.change(screen.getByLabelText('步骤 1 评审门槛 1'), { target: { value: 'ALL' } });
    refresh();
    fireEvent.click(screen.getByRole('checkbox', { name: 'approve' }));
    refresh();
    fireEvent.click(screen.getByRole('checkbox', { name: 'approve' }));
    refresh();
    fireEvent.change(screen.getByLabelText('评审槽位 1 key'), {
      target: { value: 'approve-renamed' },
    });
    refresh();
    fireEvent.change(screen.getByLabelText('评审槽位 1 责任角色'), { target: { value: 'ops' } });
    refresh();

    const parsed = JSON.parse(value) as {
      steps: Array<Record<string, unknown>>;
      roleSlots: Array<Record<string, unknown>>;
    };
    const step = parsed.steps[0];
    const gate = (step.gates as Array<Record<string, unknown>>)[0];
    const slot = parsed.roleSlots[0];
    expect(step.roleKey).toBe('ops');
    expect(step.outputKinds).toEqual(['IMPL', 'CUSTOM', { futureOutput: { keep: true } }]);
    expect(step.stepMetadata).toEqual({ keep: true });
    expect(gate.mode).toBe('ALL');
    expect(gate.reviewerSlots).toEqual(['approve', { futureReviewer: { keep: true } }]);
    expect(gate.gateMetadata).toEqual({ keep: true });
    expect(slot.key).toBe('approve-renamed');
    expect(slot.roleKey).toBe('ops');
    expect(slot.slotMetadata).toEqual({ keep: true });

    // Feed the edited JSON back through the component and confirm structured controls recover it.
    const recovered = JSON.parse(value) as {
      steps: Array<Record<string, unknown>>;
      roleSlots: Array<Record<string, unknown>>;
    };
    recovered.steps[0].roleKey = 'product';
    recovered.roleSlots[0].roleKey = 'product';
    value = JSON.stringify(recovered, null, 2);
    refresh();
    expect(screen.getByLabelText('步骤 1 责任角色')).toHaveValue('product');
    expect(screen.getByLabelText('步骤 1 输出工件类型')).toHaveValue('IMPL\nCUSTOM');
    expect(screen.getByLabelText('评审槽位 1 key')).toHaveValue('approve-renamed');
    expect(screen.getByLabelText('评审槽位 1 责任角色')).toHaveValue('product');
  });

  it('maps server validation issues to structured fields', () => {
    render(
      <WorkflowDefinitionEditor
        value={JSON.stringify(definition())}
        roles={roles}
        issues={[
          {
            path: '/steps/1/roleKey',
            code: 'WORKFLOW_ROLE_UNKNOWN',
            message: 'step references an unknown role',
          },
        ]}
        onChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));
    const role = screen.getByLabelText('步骤 2 责任角色');
    expect(role).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('WORKFLOW_ROLE_UNKNOWN');
    expect(screen.getByRole('alert')).toHaveTextContent(
      '所选责任角色不存在或已不可用，请重新选择。',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('step references an unknown role');
  });

  it('explains the server-supported approval mode in Chinese at the gate field', () => {
    render(
      <WorkflowDefinitionEditor
        value={JSON.stringify(definition())}
        roles={roles}
        issues={[
          {
            path: '/steps/0/gates/0/mode',
            code: 'WORKFLOW_APPROVAL_MODE_UNSUPPORTED',
            message: 'only ALL approval mode is supported',
          },
        ]}
        onChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));
    const mode = screen.getByLabelText('步骤 1 评审门槛 1');
    expect(mode).toHaveAttribute('aria-invalid', 'true');
    expect(mode).toHaveAttribute('aria-describedby');
    expect(screen.getByRole('alert')).toHaveTextContent('当前服务端只支持“全部通过（ALL）”门槛。');
    expect(screen.getByRole('alert')).not.toHaveTextContent('only ALL approval mode');
  });

  it('distinguishes a missing release step from a missing release acceptance gate', () => {
    const withoutRelease = definition();
    withoutRelease.steps = withoutRelease.steps.filter((step) => step.kind !== 'RELEASE');
    render(
      <WorkflowDefinitionEditor
        value={JSON.stringify(withoutRelease)}
        roles={roles}
        issues={[
          {
            path: '/steps',
            code: 'WORKFLOW_RELEASE_GATE_REQUIRED',
            message: 'workflow must contain a release step',
          },
        ]}
        onChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));
    expect(screen.getByRole('alert')).toHaveTextContent('流程定义必须包含至少一个发布步骤。');
    expect(screen.getByRole('alert')).not.toHaveTextContent('发布步骤必须配置发布验收门槛。');
  });

  it('exposes existing cycle errors while keeping the existing dependency removable', () => {
    const cyclic = definition();
    cyclic.steps[0].deps = ['release'];
    let value = JSON.stringify(cyclic, null, 2);
    const { rerender } = render(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));
    expect(screen.getByRole('checkbox', { name: 'release' })).toBeChecked();
    rerender(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );
    expect(screen.getAllByRole('alert').some((item) => item.textContent?.includes('循环'))).toBe(
      true,
    );
  });

  it('disables a dependency checkbox when adding it would create a cycle', () => {
    let value = JSON.stringify(definition(), null, 2);
    render(
      <WorkflowDefinitionEditor
        value={value}
        roles={roles}
        onChange={(next) => {
          value = next;
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));
    const releaseDependencies = screen.getAllByRole('checkbox', { name: 'release' });
    expect(releaseDependencies[0]).toBeDisabled();
  });

  it('keeps JSON mode available for invalid or advanced definitions', () => {
    const onChange = () => undefined;
    render(<WorkflowDefinitionEditor value="not-json" roles={roles} onChange={onChange} />);
    expect(screen.getByRole('button', { name: '高级 JSON' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '高级 JSON' }));
    expect(screen.getByLabelText('流程定义 JSON')).toHaveValue('not-json');
  });
});
