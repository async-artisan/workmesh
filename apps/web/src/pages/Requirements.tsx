import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatApiError } from '../api/client';
import {
  projectApi,
  requirementApi,
  workflowApi,
  type MemberView,
  type RequirementView,
  type RoleView,
  type WorkflowDefinitionView,
} from '../api/resources';
import { ConfirmDialog } from '../components/Modal';
import { ProjectSelect } from '../components/ProjectSelect';
import { WorkflowInstanceDialog } from '../components/WorkflowInstanceDialog';
import { useProjectContext } from '../hooks/useProjectContext';
import { useAuthStore } from '../store/auth';
import { PHASE_LABELS, labelFor } from '../lib/labels';

/**
 * 需求页只收集最小产品意图并展示服务端状态；PRD、知识和实现产物由本地 Agent 生成。
 * 流程实例只允许项目管理员初始化，且必须显式绑定责任人与审批人，不默认绑成当前用户。
 */
export function Requirements() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const user = useAuthStore((state) => state.user);
  const [items, setItems] = useState<RequirementView[]>([]);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [definitions, setDefinitions] = useState<WorkflowDefinitionView[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [workflowTarget, setWorkflowTarget] = useState<RequirementView | null>(null);

  const currentMember = members.find((member) => member.id === user?.id);
  const isAdmin = currentMember?.role === 'OWNER' || currentMember?.role === 'ADMIN';

  async function load() {
    if (!projectId) {
      setItems([]);
      setRoles([]);
      setMembers([]);
      setDefinitions([]);
      return;
    }
    try {
      const [page, memberList, roleList, definitionPage] = await Promise.all([
        requirementApi.list(projectId),
        projectApi.members(projectId),
        projectApi.roles(projectId),
        workflowApi.listDefinitions(projectId),
      ]);
      setItems(page.items);
      setMembers(memberList);
      setRoles(roleList);
      setDefinitions(definitionPage.items);
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

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>需求</h2>
          <p className="page-sub">
            这里提交最小产品意图并查看状态；PRD、知识和实现产物由本地 Agent 生成后送入 Web
            评审。流程实例由项目管理员初始化。
          </p>
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
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="需求标题"
            />
          </div>
          <div className="field">
            <span>描述</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-label="需求描述"
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
                  <td>{labelFor(PHASE_LABELS, item.phase)}</td>
                  <td className="col-actions">
                    <div className="cell-actions row-actions">
                      <button
                        className="ghost"
                        onClick={() => navigate(`/requirements/${encodeURIComponent(item.code)}`)}
                      >
                        详情
                      </button>
                      {isAdmin && (
                        <button className="ghost" onClick={() => setWorkflowTarget(item)}>
                          初始化流程
                        </button>
                      )}
                    </div>
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

      <WorkflowInstanceDialog
        open={Boolean(workflowTarget)}
        requirement={workflowTarget}
        definitions={definitions}
        roles={roles}
        members={members}
        onClose={() => setWorkflowTarget(null)}
        onCreated={(message) => {
          setWorkflowTarget(null);
          setNotice(message);
          setError('');
          void load();
        }}
      />
    </section>
  );
}
