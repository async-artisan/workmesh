import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import { Modal } from '../components/Modal';
import { ProjectSelect } from '../components/ProjectSelect';
import { InlineLoading, SkeletonLines, TableSkeletonRows } from '../components/Skeleton';
import { WorkflowInstanceDialog } from '../components/WorkflowInstanceDialog';
import { useProjectContext } from '../hooks/useProjectContext';
import { useAuthStore } from '../store/auth';
import { describeRequirementState, phaseLabelOf } from '../lib/pipelineStatus';
import { publishedWorkflowDefinitions } from '../lib/workflowInitState';

/**
 * 窄屏（≤720px）列表用卡片替代表格：断点与 mobile-lists.css 保持一致。
 * jsdom 没有 matchMedia 时按桌面表格渲染，既有交互与读屏结构完全不变。
 */
const NARROW_LIST_QUERY = '(max-width: 720px)';

function subscribeNarrowList(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mediaQuery = window.matchMedia(NARROW_LIST_QUERY);
  mediaQuery.addEventListener?.('change', onChange);
  return () => mediaQuery.removeEventListener?.('change', onChange);
}

function getNarrowListSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(NARROW_LIST_QUERY).matches;
}

function useNarrowList(): boolean {
  return useSyncExternalStore(subscribeNarrowList, getNarrowListSnapshot, () => false);
}

/**
 * 需求页只收集最小产品意图并展示服务端状态；PRD、知识和实现产物由本地 Agent 生成。
 * 流程实例只允许项目管理员初始化，且必须显式绑定责任人与审批人，不默认绑成当前用户。
 */
export function Requirements() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { projectId, loading: projectListLoading } = useProjectContext();
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
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [workflowTarget, setWorkflowTarget] = useState<RequirementView | null>(null);
  const [query, setQuery] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [page, setPage] = useState(1);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  // 记录列表已加载完成的项目：换了项目但还没拿到数据时，必须显示骨架而不是空态。
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const PAGE_SIZE = 12;
  // 项目列表还在加载、尚未选出当前项目时，列表同样属于“首屏加载中”，不能先闪空态。
  const awaitingProject = !projectId && projectListLoading;
  const firstLoad = Boolean(projectId) && loadedProjectId !== projectId;
  const listPending = firstLoad || awaitingProject;
  const showListLoading = listPending || listLoading;

  useEffect(() => {
    const legacy = searchParams.get('req');
    if (legacy) {
      navigate(`/requirements/${encodeURIComponent(legacy)}`, { replace: true });
    }
  }, [navigate, searchParams]);

  const currentMember = members.find((member) => member.id === user?.id);
  const isAdmin = currentMember?.role === 'OWNER' || currentMember?.role === 'ADMIN';
  const adminNames = members
    .filter((member) => member.role === 'OWNER' || member.role === 'ADMIN')
    .map((member) => member.name?.trim() || member.email);
  const publishedDefinitions = publishedWorkflowDefinitions(definitions);
  const narrowList = useNarrowList();

  const emptyListText = error
    ? '加载失败，请重试。'
    : projectId
      ? items.length === 0
        ? '还没有需求，点右上角「新建需求」创建。'
        : '没有匹配的需求，清空搜索或阶段筛选。'
      : '先选择项目。';

  /** 表格与卡片共用同一套行内操作，避免窄屏丢失「详情 / 初始化流程」入口。 */
  function requirementActions(item: RequirementView) {
    return (
      <>
        <button
          className="ghost"
          onClick={() => navigate(`/requirements/${encodeURIComponent(item.code)}`)}
        >
          详情
        </button>
        {isAdmin && item.phase === 'DISCOVERY' && (
          <>
            {publishedDefinitions.length > 0 ? (
              <button className="ghost" onClick={() => setWorkflowTarget(item)}>
                初始化流程
              </button>
            ) : (
              <button className="ghost" disabled title="流程定义尚未发布：先到「流程」页发布">
                流程定义未发布
              </button>
            )}
          </>
        )}
        {!isAdmin && item.phase === 'DISCOVERY' && (
          <span
            className="status-tag"
            title={
              adminNames.length > 0
                ? `项目管理员：${adminNames.join('、')}`
                : '请联系项目管理员初始化流程实例'
            }
          >
            等待管理员初始化
          </span>
        )}
      </>
    );
  }

  const phaseOptions = useMemo(() => [...new Set(items.map((item) => item.phase))].sort(), [items]);

  const filteredRequirements = useMemo(() => {
    const text = query.trim().toLowerCase();
    return items.filter((item) => {
      if (phaseFilter && item.phase !== phaseFilter) return false;
      if (!text) return true;
      return [item.code, item.title, item.description ?? ''].join(' ').toLowerCase().includes(text);
    });
  }, [items, phaseFilter, query]);

  const pageCount = Math.max(1, Math.ceil(filteredRequirements.length / PAGE_SIZE));
  const visibleRequirements = filteredRequirements.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [projectId, phaseFilter, query]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  async function load() {
    // 切项目 / 并发刷新时，旧请求的响应不允许覆盖新一轮列表与首屏状态。
    const requestId = ++loadRequestRef.current;
    if (!projectId) {
      setItems([]);
      setRoles([]);
      setMembers([]);
      setDefinitions([]);
      setNextCursor(null);
      setListLoading(false);
      return;
    }
    setListLoading(true);
    try {
      const [requirementPage, memberList, roleList, definitionPage] = await Promise.all([
        requirementApi.list(projectId),
        projectApi.members(projectId),
        projectApi.roles(projectId),
        workflowApi.listDefinitions(projectId),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setItems(requirementPage.items);
      setNextCursor(requirementPage.nextCursor ?? null);
      setMembers(memberList);
      setRoles(roleList);
      setDefinitions(definitionPage.items);
      setError('');
      setLoadedProjectId(projectId);
    } catch (caught) {
      if (requestId !== loadRequestRef.current) return;
      setError(formatApiError(caught));
      // 失败也要结束首屏骨架：显示错误提示而不是无限转圈或空态文案。
      setLoadedProjectId(projectId);
    } finally {
      if (requestId === loadRequestRef.current) setListLoading(false);
    }
  }

  /** 服务端游标分页：首屏只取第一页，列表底部明确提供「加载更多」，不静默丢掉 >limit 的需求。 */
  async function loadMore() {
    if (!projectId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await requirementApi.list(projectId, nextCursor);
      setItems((previous) => {
        const byId = new Map(previous.map((item) => [item.id, item]));
        for (const item of page.items) byId.set(item.id, item);
        return [...byId.values()];
      });
      setNextCursor(page.nextCursor ?? null);
      setError('');
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function create() {
    if (!projectId || !title.trim()) {
      setCreateError('需求标题不能为空。');
      return;
    }
    setBusy(true);
    setCreateError('');
    try {
      await requirementApi.create(projectId, {
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setTitle('');
      setDescription('');
      setCreateFormOpen(false);
      setNotice('需求已创建。');
      setError('');
      await load();
    } catch (caught) {
      setCreateError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="requirements-page">
      <header className="page-head">
        <div>
          <h2>需求</h2>
          <p className="page-sub">
            这里提交最小产品意图并查看状态；PRD、知识和实现产物由本地 Agent 生成后送入 Web
            评审。流程实例由项目管理员初始化。
          </p>
          {!listPending && !error && definitions.length === 0 && (
            <p className="page-sub wm-definition-hint">当前项目还没有已发布的流程定义。</p>
          )}
        </div>
        <div className="page-actions">
          <ProjectSelect
            onChange={() => setItems([])}
            onCreateProject={() => navigate('/projects')}
          />
          <button
            className="primary"
            disabled={!projectId}
            onClick={() => {
              setCreateError('');
              setCreateFormOpen(true);
            }}
          >
            新建需求
          </button>
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
          <h3>
            需求列表
            {!listPending && (
              <small>
                {filteredRequirements.length} / {items.length}
              </small>
            )}
          </h3>
          {showListLoading && (
            <InlineLoading label={listPending ? '正在加载需求列表…' : '正在刷新需求列表…'} />
          )}
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
                  {phaseLabelOf(phase)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {narrowList ? (
          <ul
            className="wm-mobile-card-list"
            data-testid="requirements-card-list"
            aria-busy={showListLoading || undefined}
          >
            {listPending ? (
              Array.from({ length: 4 }, (_, index) => (
                <li className="wm-mobile-card" key={index} aria-hidden="true">
                  <SkeletonLines lines={2} />
                </li>
              ))
            ) : (
              <>
                {visibleRequirements.map((item) => {
                  const state = describeRequirementState(item);
                  return (
                    <li key={item.id} className="wm-mobile-card" data-testid="requirement-card">
                      <div className="wm-mobile-card-head">
                        <span className="status-tag wm-mobile-card-code">{item.code}</span>
                        <span className="wm-mobile-card-tags">
                          <span className="status-tag">{state.phase.label}</span>
                          <span className={`status-tag is-${state.execution.tone}`}>
                            {state.execution.label}
                          </span>
                        </span>
                      </div>
                      <p className="wm-mobile-card-title" title={item.title}>
                        {item.title}
                      </p>
                      <p className="wm-mobile-card-meta">负责人：服务端未提供负责人</p>
                      <p className="wm-mobile-card-meta">下一步：状态待确认</p>
                      <details className="wm-mobile-card-details">
                        <summary>查看说明与版本</summary>
                        <p className="wm-mobile-card-meta">
                          说明：{item.description?.trim() || '服务端未提供说明'}
                        </p>
                        <p className="wm-mobile-card-meta">版本：v{item.version}</p>
                      </details>
                      <div className="wm-mobile-card-actions">{requirementActions(item)}</div>
                    </li>
                  );
                })}
                {visibleRequirements.length === 0 && (
                  <li className="wm-mobile-empty">{emptyListText}</li>
                )}
              </>
            )}
          </ul>
        ) : (
          <div
            className="table-scroll"
            data-testid="requirements-table"
            aria-busy={showListLoading || undefined}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>标题</th>
                  <th>描述</th>
                  <th>版本</th>
                  <th>阶段</th>
                  <th>执行状态</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {listPending ? (
                  <TableSkeletonRows rows={5} columns={7} />
                ) : (
                  <>
                    {visibleRequirements.map((item) => {
                      const state = describeRequirementState(item);
                      return (
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
                          <td>{state.phase.label}</td>
                          <td>
                            <span className={`status-tag is-${state.execution.tone}`}>
                              {state.execution.label}
                            </span>
                          </td>
                          <td className="col-actions">
                            <div className="cell-actions row-actions">
                              {requirementActions(item)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {visibleRequirements.length === 0 && (
                      <tr className="table-empty">
                        <td colSpan={7}>{emptyListText}</td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
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
        {nextCursor && (
          <div className="table-pagination">
            <span>已加载 {items.length} 条，服务端还有更多需求</span>
            <button className="ghost" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          </div>
        )}
      </div>

      <Modal
        open={createFormOpen}
        title="新建需求"
        description="提交最小产品意图：标题必填、描述可选。创建后由本地 Product Agent 生成 PRD，流程实例仍由项目管理员初始化。"
        size="md"
        busy={busy}
        onClose={() => {
          if (!busy) setCreateFormOpen(false);
        }}
        footer={
          <>
            <button className="ghost" onClick={() => setCreateFormOpen(false)} disabled={busy}>
              取消
            </button>
            <button
              className="primary"
              disabled={busy || !projectId || !title.trim()}
              onClick={() => void create()}
            >
              {busy ? '创建中…' : '创建需求'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>标题</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="需求标题"
              placeholder="例如：客户询价单"
            />
          </div>
          <div className="field">
            <span>描述</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-label="需求描述"
              rows={4}
              placeholder="可选：业务背景、目标用户、验收要点"
            />
          </div>
          {createError && (
            <p className="modal-error" role="alert">
              {createError}
            </p>
          )}
        </div>
      </Modal>

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
