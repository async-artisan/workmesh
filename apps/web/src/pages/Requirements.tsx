import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { requirementApi, type RequirementItem } from '../api/resources';
import { ConfirmDialog, Modal } from '../components/Modal';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';
import { toast } from '../store/toast';

const transitions: Record<string, string[]> = {
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED: ['IN_PROGRESS', 'DRAFT'],
  IN_PROGRESS: ['DONE', 'APPROVED'],
  DONE: ['ARCHIVED'],
  ARCHIVED: [],
};

const STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'IN_PROGRESS', 'DONE', 'ARCHIVED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  IN_REVIEW: '评审中',
  APPROVED: '已批准',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
  ARCHIVED: '已归档',
};

const STATUS_TONES: Record<string, string> = {
  IN_REVIEW: 'is-review',
  IN_PROGRESS: 'is-active',
  APPROVED: 'is-active',
  DONE: 'is-done',
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  URGENT: '紧急',
};

const emptyForm = { title: '', description: '', stories: '', criteria: '' };

export function Requirements() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projects, projectId, setProjectId } = useProjectContext();
  const [items, setItems] = useState<RequirementItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RequirementItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RequirementItem | null>(null);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  const pageCount = Math.max(1, Math.ceil(total / 20));

  useEffect(() => {
    if (!projectId) return;
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, status]);

  useEffect(() => {
    const target = searchParams.get('req');
    if (!target || items.length === 0) return;
    const found = items.find((item) => item.id === target);
    if (found) {
      setModalError('');
      setEditing(found);
      setSearchParams({}, { replace: true });
    }
  }, [items, searchParams, setSearchParams]);

  async function load(targetPage = 1) {
    if (!projectId) return;
    try {
      setPage(targetPage);
      const result = await requirementApi.list(projectId, targetPage, 20, status || undefined);
      setItems(result.items);
      setTotal(result.total);
      setError('');
    } catch {
      setError('无法加载需求，请检查项目访问权限。');
    }
  }

  function openCreate() {
    setForm(emptyForm);
    setModalError('');
    setCreateOpen(true);
  }

  async function create() {
    if (!projectId || !form.title.trim()) {
      setModalError('请填写需求标题。');
      return;
    }
    setBusy(true);
    try {
      await requirementApi.create({
        projectId,
        title: form.title.trim(),
        description: form.description,
        userStories: form.stories
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
        acceptanceCriteria: form.criteria
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setCreateOpen(false);
      setForm(emptyForm);
      await load(1);
      toast.success('需求已创建');
    } catch {
      setModalError('创建失败，请检查输入和项目访问权限。');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editing.title.trim()) {
      setModalError('需求标题不能为空。');
      return;
    }
    setBusy(true);
    try {
      await requirementApi.update(editing.id, {
        title: editing.title,
        description: editing.description,
        priority: editing.priority,
        status: editing.status,
        userStories: editing.userStories,
        acceptanceCriteria: editing.acceptanceCriteria,
      });
      setEditing(null);
      await load(page);
      toast.success('需求已更新');
    } catch {
      setModalError('更新失败，请检查状态流转是否合法。');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await requirementApi.remove(pendingDelete.id);
      await load(page);
      toast.success('需求已删除');
    } catch {
      setError('删除失败，请检查权限。');
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>需求管理</h2>
          <p className="page-sub">按项目维护需求条目与状态流转</p>
        </div>
        <div className="page-actions">
          <button
            className="ghost"
            disabled={!projectId}
            onClick={() => navigate(`/runs?projectId=${encodeURIComponent(projectId)}`)}
          >
            AI 需求发现
          </button>
          <button className="primary" disabled={!projectId} onClick={openCreate}>
            新建需求
          </button>
        </div>
      </header>

      <div className="toolbar">
        <ProjectSelect />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="需求状态筛选"
        >
          <option value="">全部状态</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value] ?? value}
            </option>
          ))}
        </select>
        <button className="ghost" onClick={() => void load(1)}>
          刷新
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="table-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>优先级</th>
                <th>状态</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                  </td>
                  <td>{PRIORITY_LABELS[item.priority ?? 'MEDIUM'] ?? item.priority ?? '中'}</td>
                  <td>
                    <span className={`status-tag ${STATUS_TONES[item.status] ?? ''}`}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </td>
                  <td className="col-actions">
                    <div className="cell-actions row-actions">
                      <button className="ghost" onClick={() => {
                        setModalError('');
                        setEditing(item);
                      }}>
                        编辑
                      </button>
                      <button className="danger" onClick={() => setPendingDelete(item)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={4}>
                    {projectId ? '该项目还没有需求。' : '先选择项目。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="table-foot">
            <span>
              共 {total} 条 · 第 {page} / {pageCount} 页
            </span>
            <div className="pager">
              <button className="ghost" disabled={page === 1} onClick={() => void load(page - 1)}>
                上一页
              </button>
              <button
                className="ghost"
                disabled={page >= pageCount}
                onClick={() => void load(page + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={createOpen}
        title="新建需求"
        description="用户故事与验收标准每行一条。"
        size="lg"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button className="primary" disabled={busy} onClick={() => void create()}>
              {busy ? '创建中…' : '创建需求'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>需求标题</span>
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              maxLength={200}
              placeholder="一句话描述要解决的问题"
              aria-label="需求标题"
            />
          </div>
          <div className="field">
            <span>需求描述</span>
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="背景、目标与范围"
              aria-label="需求描述"
            />
          </div>
          <div className="field-row">
            <div className="field">
              <span>用户故事（每行一条）</span>
              <textarea
                value={form.stories}
                onChange={(event) => setForm({ ...form, stories: event.target.value })}
                aria-label="用户故事"
              />
            </div>
            <div className="field">
              <span>验收标准（每行一条）</span>
              <textarea
                value={form.criteria}
                onChange={(event) => setForm({ ...form, criteria: event.target.value })}
                aria-label="验收标准"
              />
            </div>
          </div>
          {modalError && <p className="modal-error">{modalError}</p>}
        </div>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title="编辑需求"
        description={editing?.title}
        size="lg"
        onClose={() => setEditing(null)}
        footer={
          <>
            <button className="ghost" onClick={() => setEditing(null)}>
              取消
            </button>
            <button className="primary" disabled={busy} onClick={() => void saveEdit()}>
              {busy ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        {editing && (
          <div className="form-grid">
            <div className="field">
              <span>需求标题</span>
              <input
                value={editing.title}
                onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                aria-label="编辑需求标题"
              />
            </div>
            <div className="field">
              <span>需求描述</span>
              <textarea
                value={editing.description ?? ''}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                aria-label="编辑需求描述"
              />
            </div>
            <div className="field-row">
              <div className="field">
                <span>状态</span>
                <select
                  value={editing.status}
                  onChange={(event) => setEditing({ ...editing, status: event.target.value })}
                  aria-label="编辑需求状态"
                >
                  {[editing.status, ...(transitions[editing.status] ?? [])].map((value) => (
                    <option key={value} value={value}>
                      {STATUS_LABELS[value] ?? value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <span>优先级</span>
                <select
                  value={editing.priority ?? 'MEDIUM'}
                  onChange={(event) => setEditing({ ...editing, priority: event.target.value })}
                  aria-label="编辑需求优先级"
                >
                  {PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {PRIORITY_LABELS[value] ?? value}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <span>用户故事（每行一条）</span>
                <textarea
                  value={(editing.userStories ?? []).join('\n')}
                  onChange={(event) =>
                    setEditing({ ...editing, userStories: event.target.value.split('\n') })
                  }
                  aria-label="编辑用户故事"
                />
              </div>
              <div className="field">
                <span>验收标准（每行一条）</span>
                <textarea
                  value={(editing.acceptanceCriteria ?? []).join('\n')}
                  onChange={(event) =>
                    setEditing({ ...editing, acceptanceCriteria: event.target.value.split('\n') })
                  }
                  aria-label="编辑验收标准"
                />
              </div>
            </div>
            {modalError && <p className="modal-error">{modalError}</p>}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除需求"
        description={
          pendingDelete ? `「${pendingDelete.title}」及其关联 PRD、审批记录会一并删除。` : ''
        }
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
    </section>
  );
}
