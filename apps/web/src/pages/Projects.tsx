import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectApi, workbenchApi, type ProjectView } from '../api/resources';
import { formatApiError } from '../api/client';
import { ConfirmDialog, Modal } from '../components/Modal';
import { invalidateProjects } from '../store/project';
import { toast } from '../store/toast';

const emptyForm = { name: '', key: '', description: '' };
const KEY_PATTERN = /^[A-Z]{2,6}$/;

export function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<ProjectView | null>(null);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);
  const [todoCounts, setTodoCounts] = useState<Record<string, number>>({});

  async function load() {
    try {
      setProjects(await projectApi.list());
      setError('');
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    workbenchApi
      .get()
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
          <button
            className="primary"
            onClick={() => {
              setForm(emptyForm);
              setModalError('');
              setCreateOpen(true);
            }}
          >
            新建项目
          </button>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

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
                    <strong>{project.name}</strong>
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
                      <button className="ghost" onClick={() => navigate('/roles')}>
                        角色 / ACL
                      </button>
                      <button className="ghost" onClick={() => navigate('/prd')}>
                        文档
                      </button>
                      <button className="danger" onClick={() => setPendingArchive(project)}>
                        归档
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={6}>还没有可访问的项目，点右上角「新建项目」创建。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
          pendingArchive ? `「${pendingArchive.name}」归档后停止新业务写入，历史仍可读取。` : ''
        }
        confirmLabel="归档"
        busy={busy}
        onCancel={() => setPendingArchive(null)}
        onConfirm={() => void archive()}
      />
    </section>
  );
}
