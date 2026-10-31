import { useEffect, useState } from 'react';
import { projectApi } from '../api/resources';
import { ConfirmDialog, Modal } from '../components/Modal';
import { invalidateProjects } from '../store/project';
import { toast } from '../store/toast';

interface ProjectRow {
  id: string;
  name: string;
  key: string;
  description?: string;
  repositoryUrl?: string | null;
}

const emptyForm = { name: '', key: '', description: '', repositoryUrl: '' };

export function Projects() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [editForm, setEditForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProjectRow | null>(null);

  async function load() {
    try {
      setProjects(await projectApi.list());
      setError('');
    } catch {
      setError('无法加载项目。');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setForm(emptyForm);
    setModalError('');
    setCreateOpen(true);
  }

  async function create() {
    if (!form.name.trim() || !/^[A-Z][A-Z0-9_-]{1,15}$/.test(form.key)) {
      setModalError('项目名称不能为空，Key 需为大写字母开头的 2-16 位标识。');
      return;
    }
    setBusy(true);
    try {
      await projectApi.create({
        name: form.name.trim(),
        key: form.key,
        description: form.description,
        repositoryUrl: form.repositoryUrl.trim(),
      });
      setCreateOpen(false);
      setForm(emptyForm);
      invalidateProjects();
      await load();
      toast.success(`项目「${form.name.trim()}」已创建`);
    } catch {
      setModalError('创建项目失败，请检查 Key 是否重复。');
    } finally {
      setBusy(false);
    }
  }

  function openEdit(project: ProjectRow) {
    setEditingId(project.id);
    setEditForm({
      name: project.name,
      key: project.key,
      description: project.description ?? '',
      repositoryUrl: project.repositoryUrl ?? '',
    });
    setModalError('');
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.name.trim()) {
      setModalError('项目名称不能为空。');
      return;
    }
    setBusy(true);
    try {
      await projectApi.update(editingId, {
        name: editForm.name.trim(),
        description: editForm.description,
        repositoryUrl: editForm.repositoryUrl.trim(),
      });
      setEditingId('');
      invalidateProjects();
      await load();
      toast.success('项目已更新');
    } catch {
      setModalError('更新项目失败。');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await projectApi.remove(pendingDelete.id);
      invalidateProjects();
      await load();
      toast.success('项目已删除');
    } catch {
      setError('删除项目失败。');
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>项目列表</h2>
          <p className="page-sub">按项目隔离需求、PRD 与知识库</p>
        </div>
        <div className="page-actions">
          <button className="primary" onClick={openCreate}>
            新建项目
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="table-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>项目名称</th>
                <th>Key</th>
                <th>描述</th>
                <th>仓库</th>
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
                  <td>
                    <span
                      className="cell-truncate cell-mono"
                      title={project.repositoryUrl ?? ''}
                    >
                      {project.repositoryUrl || '—'}
                    </span>
                  </td>
                  <td className="col-actions">
                    <div className="cell-actions row-actions">
                      <button className="ghost" onClick={() => openEdit(project)}>
                        编辑
                      </button>
                      <button className="danger" onClick={() => setPendingDelete(project)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={5}>还没有项目，点右上角「新建项目」创建。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={createOpen}
        title="新建项目"
        description="Key 创建后不可修改，用于标识项目下的资源。"
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
              placeholder="例如：易番番电商后台"
              aria-label="项目名称"
            />
          </div>
          <div className="field">
            <span>项目 Key</span>
            <input
              value={form.key}
              onChange={(event) => setForm({ ...form, key: event.target.value.toUpperCase() })}
              placeholder="例如：YFF"
              aria-label="项目 Key"
            />
            <small>大写字母开头，2-16 位，可含数字、下划线与短横线。</small>
          </div>
          <div className="field">
            <span>项目描述</span>
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="一句话说明项目范围"
              aria-label="项目描述"
            />
          </div>
          <div className="field">
            <span>仓库 URL</span>
            <input
              value={form.repositoryUrl}
              onChange={(event) => setForm({ ...form, repositoryUrl: event.target.value })}
              placeholder="可选"
              aria-label="仓库 URL"
            />
          </div>
          {modalError && <p className="modal-error">{modalError}</p>}
        </div>
      </Modal>

      <Modal
        open={Boolean(editingId)}
        title="编辑项目"
        description={editForm.name}
        size="md"
        onClose={() => setEditingId('')}
        footer={
          <>
            <button className="ghost" onClick={() => setEditingId('')}>
              取消
            </button>
            <button className="primary" disabled={busy} onClick={() => void saveEdit()}>
              {busy ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>项目名称</span>
            <input
              value={editForm.name}
              onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
              aria-label="编辑项目名称"
            />
          </div>
          <div className="field">
            <span>项目描述</span>
            <textarea
              value={editForm.description}
              onChange={(event) => setEditForm({ ...editForm, description: event.target.value })}
              aria-label="编辑项目描述"
            />
          </div>
          <div className="field">
            <span>仓库 URL</span>
            <input
              value={editForm.repositoryUrl}
              onChange={(event) =>
                setEditForm({ ...editForm, repositoryUrl: event.target.value })
              }
              aria-label="编辑仓库 URL"
            />
          </div>
          {modalError && <p className="modal-error">{modalError}</p>}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除项目"
        description={
          pendingDelete
            ? `「${pendingDelete.name}」下的需求、PRD 与知识库关联会一并删除。`
            : ''
        }
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
    </section>
  );
}
