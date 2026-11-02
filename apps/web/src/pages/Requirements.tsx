import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();
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
  const [query, setQuery] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;

  useEffect(() => {
    const legacy = searchParams.get('req');
    if (legacy) {
      navigate(`/requirements/${encodeURIComponent(legacy)}`, { replace: true });
    }
  }, [navigate, searchParams]);

  const currentMember = members.find((member) => member.id === user?.id);
  const isAdmin = currentMember?.role === 'OWNER' || currentMember?.role === 'ADMIN';

  const phaseOptions = useMemo(
    () => [...new Set(items.map((item) => item.phase))].sort(),
    [items],
  );

  const filteredRequirements = useMemo(() => {
    const text = query.trim().toLowerCase();
    return items.filter((item) => {
      if (phaseFilter && item.phase !== phaseFilter) return false;
      if (!text) return true;
      return [item.code, item.title, item.description ?? '']
        .join(' ')
        .toLowerCase()
        .includes(text);
    });
  }, [items, phaseFilter, query]);

  const pageCount = Math.max(1, Math.ceil(filteredRequirements.length / PAGE_SIZE));
  const visibleRequirements = filteredRequirements.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [projectId, phaseFilter, query]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  async function load() {
    if (!projectId) {
      setItems([]);
      setRoles([]);
      setMembers([]);
      setDefinitions([]);
      return;
    }
    try {
      const [requirementPage, memberList, roleList, definitionPage] = await Promise.all([
        requirementApi.list(projectId),
        projectApi.members(projectId),
        projectApi.roles(projectId),
        workflowApi.listDefinitions(projectId),
      ]);
      setItems(requirementPage.items);
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
        <div className="form-grid req-create-grid">
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
            需求列表<small>{filteredRequirements.length} / {items.length}</small>
          </h3>
          <div className="card-head-actions req-list-tools">
            <input
              aria-label="搜索需求"
              placeholder="搜索编号 / 标题 / 描述"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="阶段筛选"
              value={phaseFilter}
              onChange={(event) => setPhaseFilter(event.target.value)}
            >
              <option value="">全部阶段</option>
              {phaseOptions.map((phase) => (
                <option key={phase} value={phase}>
                  {labelFor(PHASE_LABELS, phase)}
                </option>
              ))}
            </select>
          </div>
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
              {visibleRequirements.map((item) => (
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
                      {isAdmin && item.phase === 'DISCOVERY' && (
                        <button className="ghost" onClick={() => setWorkflowTarget(item)}>
                          初始化流程
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visibleRequirements.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={6}>
                    {projectId
                      ? items.length === 0
                        ? '还没有需求，先在上方创建。'
                        : '没有匹配的需求，清空搜索或阶段筛选。'
                      : '先选择项目。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredRequirements.length > PAGE_SIZE && (
          <div className="table-pagination">
            <span>
              第 {page} / {pageCount} 页 · 共 {filteredRequirements.length} 条
            </span>
            <div>
              <button
                className="ghost"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                上一页
              </button>
              <button
                className="ghost"
                disabled={page >= pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        )}
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
