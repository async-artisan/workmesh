import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectApi, type ProjectView } from '../api/resources';
import { getWorkbenchSnapshot } from '../lib/workbenchSnapshot';
import { formatApiError } from '../api/client';
import { ConfirmDialog, Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { PageState } from '../components/PageState';
import { StaleDataBanner } from '../components/StaleDataBanner';
import { invalidateProjects, useProjectStore } from '../store/project';
import { toast } from '../store/toast';

const emptyForm = { name: '', key: '', description: '' };
const KEY_PATTERN = /^[A-Z]{2,6}$/;

export function Projects() {
  const navigate = useNavigate();
  // 行内跳转先切换项目上下文，避免多项目时串项目。
  function openWithProject(projectId: string, path: string) {
    useProjectStore.getState().setProjectId(projectId);
    navigate(path);
  }
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<ProjectView | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);
  const [todoCounts, setTodoCounts] = useState<Record<string, number>>({});

  async function load() {
    setLoading(true);
    try {
      setProjects(await projectApi.list());
      setError('');
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setForm(emptyForm);
    setModalError('');
    setCreateOpen(true);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    getWorkbenchSnapshot()
      .then((snapshot) => {
        const counts: Record<string, number> = {};
        const add = (projectId: string) => {
          counts[projectId] = (counts[projectId] ?? 0) + 1;
        };
        for (const review of snapshot.reviews) add(review.projectId);
        for (const change of snapshot.changes) add(change.projectId);
        for (const task of snapshot.readyTasks) add(task.projectId);
        setTodoCounts(counts);
      })
      .catch(() => setTodoCounts({}));
  }, []);

  async function create() {
    if (!form.name.trim() || !KEY_PATTERN.test(form.key)) {
      setModalError('项目名称不能为空，Key 必须为 2–6 位大写字母。');
      return;
    }
    setBusy(true);
    try {
      await projectApi.create({
        name: form.name.trim(),
        key: form.key,
        description: form.description.trim() || undefined,
      });
      setCreateOpen(false);
      setForm(emptyForm);
      invalidateProjects();
      await load();
      toast.success(`项目「${form.name.trim()}」已创建`);
    } catch (caught) {
      setModalError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!pendingArchive) return;
    setBusy(true);
    try {
      await projectApi.archive(pendingArchive.id);
      invalidateProjects();
      await load();
      toast.success('项目已归档');
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
      setPendingArchive(null);
    }
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>项目列表</h2>
          <p className="page-sub">项目 key 创建后不可修改；成员、角色与知识库访问由服务端授权。</p>
        </div>
        <div className="page-actions">
          <button className="primary" onClick={openCreate}>
            新建项目
          </button>
        </div>
      </header>

      {loading && projects.length === 0 ? (
        <PageState state={{ kind: 'loading' }} title="正在加载项目…" />
      ) : error && projects.length === 0 ? (
        <ErrorState
          title="项目列表加载失败"
          message="暂时无法读取项目列表，请稍后重试。"
          detail={error}
          onRetry={() => void load()}
          retryAriaLabel="重试加载项目列表"
        />
      ) : (
        <>
          {error && (
            <StaleDataBanner
              message="本次刷新失败，显示的是上次成功加载的项目。"
              onRetry={() => void load()}
              retryAriaLabel="重新加载项目列表"
            />
          )}
          {projects.length === 0 ? (
            <EmptyState
              title="还没有可访问的项目"
              description="创建第一个项目后，需求、看板、知识与文档都会挂在这个项目下。"
              hint="如果你应该能访问某个项目，请联系项目管理员把你加入成员。"
              actionLabel="新建项目"
              onAction={openCreate}
            />
          ) : (
      <div className="table-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>项目名称</th>
                <th>Key</th>
                <th>描述</th>
                <th>版本</th>
                <th>待办</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <button
                      type="button"
                      className="link-btn"
                      aria-label={`进入项目 ${project.name}`}
                      onClick={() => openWithProject(project.id, `/projects/${project.id}`)}
                    >
                      {project.name}
                    </button>
                  </td>
                  <td>
                    <span className="status-tag">{project.key}</span>
                  </td>
                  <td>
                    <span className="cell-truncate" title={project.description ?? ''}>
                      {project.description || '—'}
                    </span>
                  </td>
                  <td className="cell-num">v{project.version}</td>
                  <td className="cell-num">
                    <button
                      className="link-btn"
                      aria-label={`查看 ${project.name} 的待办`}
                      onClick={() => navigate(`/?project=${encodeURIComponent(project.id)}`)}
                    >
                      {todoCounts[project.id] ?? 0}
                    </button>
                  </td>
                  <td className="col-actions">
                    <div className="cell-actions row-actions">
                      <button
                        className="ghost"
                        onClick={() => openWithProject(project.id, `/projects/${project.id}`)}
                      >
                        进入项目
                      </button>
                      <button
                        className="ghost"
                        onClick={() => openWithProject(project.id, '/roles')}
                      >
                        角色 / ACL
                      </button>
                      <button className="ghost" onClick={() => openWithProject(project.id, '/prd')}>
                        文档
                      </button>
                      <button className="danger" onClick={() => setPendingArchive(project)}>
                        归档
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
          )}
        </>
      )}

      <Modal
        open={createOpen}
        title="新建项目"
        description="创建时会生成默认知识库与六个业务角色，创建者获得 OWNER 管理身份。"
        size="md"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button className="primary" disabled={busy} onClick={() => void create()}>
              {busy ? '创建中…' : '创建项目'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>项目名称</span>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              aria-label="项目名称"
            />
          </div>
          <div className="field">
            <span>项目 Key</span>
            <input
              value={form.key}
              onChange={(event) => setForm({ ...form, key: event.target.value.toUpperCase() })}
              aria-label="项目 Key"
              placeholder="YFF"
            />
            <small>2–6 位大写字母，组织内唯一，创建后不可修改。</small>
          </div>
          <div className="field">
            <span>项目描述</span>
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              aria-label="项目描述"
            />
          </div>
          {modalError && (
            <p className="modal-error" role="alert">
              {modalError}
            </p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingArchive)}
        title="归档项目"
        description={
          pendingArchive
            ? `「${pendingArchive.name}」归档后将停止新建需求与任务，项目会从项目列表与项目选择器隐藏。`
            : ''
        }
        note="历史需求、工件、评审与审计记录都会保留，不会删除；归档不可在页面内撤销。"
        confirmLabel="归档项目"
        busy={busy}
        onCancel={() => setPendingArchive(null)}
        onConfirm={() => void archive()}
      />
    </section>
  );
}
