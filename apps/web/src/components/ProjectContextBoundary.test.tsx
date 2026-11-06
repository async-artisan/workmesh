import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectContextBoundary } from './ProjectContextBoundary';
import { ProjectSelect } from './ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';
import { useProjectStore } from '../store/project';
import { envelope, mockFetch, pathOf, useProject } from '../test-utils';

const projects = [
  { id: 'p1', key: 'ONE', name: '项目一', version: 1 },
  { id: 'p2', key: 'TWO', name: '项目二', version: 1 },
];
function Location() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="地址">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate(-1)}>后退</button>
    </>
  );
}
function Page({ pending }: { pending?: (id: string) => Promise<string> }) {
  const { projectId } = useProjectContext();
  const [filter, setFilter] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => {
    void pending?.(projectId).then(setBody);
  }, [pending, projectId]);
  return (
    <>
      <ProjectSelect onCreateProject={() => undefined} />
      <input aria-label="筛选" value={filter} onChange={(event) => setFilter(event.target.value)} />
      <output aria-label="正文">{body}</output>
    </>
  );
}
function setup(
  entry = '/requirements?projectId=p2&req=legacy',
  pending?: (id: string) => Promise<string>,
) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Location />
      <ProjectContextBoundary>
        <Page pending={pending} />
      </ProjectContextBoundary>
    </MemoryRouter>,
  );
}
describe('URL 项目上下文', () => {
  beforeEach(() => {
    useProject('p1');
    mockFetch((url) =>
      pathOf(url) === '/api/v1/projects' ? { status: 200, body: envelope(projects) } : undefined,
    );
  });
  afterEach(() => {
    cleanup();
    useProjectStore.setState({ requestedProjectId: null });
  });
  it('URL 优先于本地记忆，刷新后仍恢复同一项目并保留深链接', async () => {
    const view = setup();
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('p2'));
    expect(screen.getByLabelText('当前项目')).toHaveTextContent('项目二（TWO）');
    expect(localStorage.getItem('workmesh.projectId')).toBe('p2');
    view.unmount();
    useProjectStore.getState().setProjectId('p1');
    setup();
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('p2'));
    expect(screen.getByLabelText('地址')).toHaveTextContent('req=legacy');
  });
  it('切换同步 URL、清理本地筛选，后退恢复 URL 项目', async () => {
    setup();
    await screen.findByRole('option', { name: '项目一（ONE）' });
    fireEvent.change(screen.getByLabelText('筛选'), { target: { value: '旧筛选' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p1' } });
    expect(screen.getByLabelText('地址')).toHaveTextContent('projectId=p1');
    expect(screen.getByLabelText('地址')).toHaveTextContent('req=legacy');
    expect(screen.getByLabelText('筛选')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '后退' }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('p2'));
  });
  it('未指定 URL 时使用记忆并写入 URL', async () => {
    setup('/requirements?phase=ACTIVE');
    await waitFor(() => expect(screen.getByLabelText('地址')).toHaveTextContent('projectId=p1'));
    expect(screen.getByLabelText('地址')).toHaveTextContent('phase=ACTIVE');
  });
  it('需求编号深链接在项目列表返回后恢复其项目，不被旧记忆提前固定', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockFetch((url) =>
      pathOf(url) === '/api/v1/projects'
        ? pending.then(() => ({ status: 200, body: envelope(projects) }))
        : undefined,
    );
    setup('/requirements/TWO-001?tab=tasks&taskId=task-2');
    expect(screen.getByLabelText('地址')).not.toHaveTextContent('projectId=p1');
    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.getByLabelText('地址')).toHaveTextContent('projectId=p2'));
    expect(screen.getByLabelText('地址')).toHaveTextContent('taskId=task-2');
    expect(screen.getByRole('combobox')).toHaveValue('p2');
  });
  it('不可访问的显式项目不被旧记忆或首个项目静默覆盖', async () => {
    setup('/requirements?projectId=missing');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'URL 指定的项目未在当前项目列表中找到',
    );
    expect(screen.getByRole('combobox')).toHaveValue('missing');
    expect(useProjectStore.getState().projectId).toBe('missing');
    expect(screen.getByLabelText('地址')).toHaveTextContent('projectId=missing');
  });
  it('旧项目正文迟到不能写回新项目，旧正文立即清空', async () => {
    let resolveOld!: (value: string) => void;
    const old = new Promise<string>((resolve) => {
      resolveOld = resolve;
    });
    setup('/requirements?projectId=p1', (id) =>
      id === 'p1' ? old : Promise.resolve('项目二正文'),
    );
    await screen.findByRole('option', { name: '项目二（TWO）' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p2' } });
    await waitFor(() => expect(screen.getByLabelText('正文')).toHaveTextContent('项目二正文'));
    await act(async () => {
      resolveOld('旧项目正文');
    });
    expect(screen.getByLabelText('正文')).toHaveTextContent('项目二正文');
    expect(screen.queryByText('旧项目正文')).not.toBeInTheDocument();
  });
});
