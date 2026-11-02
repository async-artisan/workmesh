import { useEffect, useState } from 'react';
import { formatApiError } from '../api/client';
import { projectApi, requirementApi, workflowApi, type RequirementView, type RoleView } from '../api/resources';
import { ConfirmDialog } from '../components/Modal';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';
import { useAuthStore } from '../store/auth';

interface StepShape {
  key: string;
  roleKey: string;
}

interface SlotShape {
  key: string;
  roleKey: string;
}

/**
 * 需求页只收集最小产品意图并展示服务端状态；PRD、知识和实现产物由本地 Agent 生成。
 * 创建需求和流程实例都是人类确认后的写操作，所有写入仍由服务端校验项目成员、scope 与版本。
 */
export function Requirements() {
  const { projectId } = useProjectContext();
  const user = useAuthStore((state) => state.user);
  const [items, setItems] = useState<RequirementView[]>([]);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [revisionId, setRevisionId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [workflowTarget, setWorkflowTarget] = useState<RequirementView | null>(null);

  async function load() {
    if (!projectId) {
      setItems([]);
      setRoles([]);
      return;
    }
    try {
      const [page, roleList] = await Promise.all([
        requirementApi.list(projectId),
        projectApi.roles(projectId),
      ]);
      setItems(page.items);
      setRoles(roleList);
      setError('');
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function create() {
    if (!projectId || !title.trim()) {
      setError('需求标题不能为空。');
      return;
    }
    setBusy(true);
    try {
      await requirementApi.create(projectId, {
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setTitle('');
      setDescription('');
      setCreateOpen(false);
      setNotice('需求已创建。');
      setError('');
      await load();
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createWorkflow(requirement: RequirementView) {
    if (!revisionId.trim() || !user) {
      setError('请填写已发布的 workflow 修订 ID。');
      return;
    }
    setBusy(true);
    try {
      const revision = await workflowApi.revision(revisionId.trim());
      const definition = revision.definition;
      const steps = Array.isArray(definition.steps) ? (definition.steps as StepShape[]) : [];
      const slots = Array.isArray(definition.roleSlots) ? (definition.roleSlots as SlotShape[]) : [];
      const roleIdsByKey = new Map(roles.filter((role) => role.isActive !== false).map((role) => [role.key, role.id]));
      const stepBindings = steps.map((step) => {
        const roleId = roleIdsByKey.get(step.roleKey);
        if (!roleId) throw new Error(`workflow 步骤 ${step.key} 的 roleKey ${step.roleKey} 未找到活动角色。`);
        return { stepKey: step.key, roleId, responsibleUserId: user.id, repositoryIds: [] };
      });
      const roleSlotBindings = slots.map((slot) => {
        const roleId = roleIdsByKey.get(slot.roleKey);
        if (!roleId) throw new Error(`审批槽 ${slot.key} 的 roleKey ${slot.roleKey} 未找到活动角色。`);
        return { slotKey: slot.key, roleId, userId: user.id };
      });
      await workflowApi.createInstance(requirement.id, {
        definitionRevisionId: revision.id,
        expectedRequirementVersion: requirement.version,
        stepBindings,
        roleSlotBindings,
      });
      setNotice(`需求 ${requirement.code} 的流程实例已创建。`);
      setError('');
      await load();
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>需求</h2>
          <p className="page-sub">这里提交最小产品意图并查看状态；PRD、知识和实现产物由本地 Agent 生成后送入 Web 评审。</p>
        </div>
        <div className="page-actions">
          <ProjectSelect onChange={() => setItems([])} />
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="kb-notice">{notice}</p>}

      <div className="table-card">
        <div className="card-head">
          <h3>新建需求</h3>
        </div>
        <div className="form-grid">
          <div className="field">
            <span>标题</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="需求标题" />
          </div>
          <div className="field">
            <span>描述</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-label="需求描述"
            />
          </div>
          <div className="field">
            <span>已发布 workflow 修订 ID</span>
            <input
              value={revisionId}
              onChange={(event) => setRevisionId(event.target.value)}
              aria-label="workflow 修订 ID"
              placeholder="创建流程实例时使用"
            />
          </div>
        </div>
        <div className="toolbar">
          <button
            className="primary"
            disabled={busy || !projectId || !title.trim()}
            onClick={() => setCreateOpen(true)}
          >
            {busy ? '提交中…' : '创建需求'}
          </button>
        </div>
      </div>

      <div className="table-card">
        <div className="card-head">
          <h3>
            需求列表<small>{items.length}</small>
          </h3>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>编号</th>
                <th>标题</th>
                <th>描述</th>
                <th>版本</th>
                <th>阶段</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="status-tag">{item.code}</span>
                  </td>
                  <td>{item.title}</td>
                  <td>
                    <span className="cell-truncate" title={item.description ?? ''}>
                      {item.description || '—'}
                    </span>
                  </td>
                  <td className="cell-num">v{item.version}</td>
                  <td>{item.phase}</td>
                  <td className="col-actions">
                    <button
                      className="ghost"
                      disabled={busy || !revisionId.trim() || !user}
                      onClick={() => setWorkflowTarget(item)}
                    >
                      创建流程实例
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={6}>{projectId ? '还没有需求，先在上方创建。' : '先选择项目。'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={createOpen}
        title="确认提交产品意图"
        description={`将创建需求「${title.trim()}」${description.trim() ? `：${description.trim()}` : ''}。后续 PRD 由本地 Product Agent 生成。`}
        confirmLabel="确认创建需求"
        busy={busy}
        onCancel={() => {
          if (!busy) setCreateOpen(false);
        }}
        onConfirm={() => void create()}
      />

      <ConfirmDialog
        open={Boolean(workflowTarget)}
        title="确认创建流程实例"
        description={
          workflowTarget
            ? `需求 ${workflowTarget.code} 将绑定已填写的 workflow 修订，并按当前页面派生的角色和责任人创建实例。`
            : ''
        }
        confirmLabel="确认创建流程"
        busy={busy}
        onCancel={() => {
          if (!busy) setWorkflowTarget(null);
        }}
        onConfirm={() => {
          if (workflowTarget) {
            const target = workflowTarget;
            setWorkflowTarget(null);
            void createWorkflow(target);
          }
        }}
      />
    </section>
  );
}
