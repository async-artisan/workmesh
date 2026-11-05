import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatApiError } from '../api/client';
import { authApi } from '../api/auth';
import { projectApi, type ProjectView, type RoleView } from '../api/resources';
import { ConfirmDialog } from '../components/Modal';
import { PageState, toPageLoadState, type PageLoadState } from '../components/PageState';
import { StaleDataBanner } from '../components/StaleDataBanner';
import { useAuthStore } from '../store/auth';

export interface CredentialView {
  id: string;
  name: string;
  projectId: string;
  roleId: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
}

export const CREDENTIAL_EXPIRING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CredentialStatusKind = 'revoked' | 'expired' | 'expiring' | 'valid' | 'unknown';

const STATUS_LABELS: Record<CredentialStatusKind, string> = {
  revoked: '已吊销',
  expired: '已过期',
  expiring: '即将过期',
  valid: '有效',
  unknown: '状态待确认',
};

const STATUS_TONES: Record<CredentialStatusKind, string> = {
  revoked: 'is-danger',
  expired: 'is-danger',
  expiring: 'is-review',
  valid: 'is-done',
  unknown: '',
};

/** 状态优先级固定为：已吊销 → 已过期 → 即将过期 → 有效。 */
export function credentialStatus(
  credential: Pick<CredentialView, 'expiresAt' | 'revokedAt'>,
  now: Date = new Date(),
): CredentialStatusKind {
  if (credential.revokedAt) return 'revoked';
  const expiresAt = new Date(credential.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return 'unknown';
  const nowMs = now.getTime();
  if (expiresAt <= nowMs) return 'expired';
  if (expiresAt <= nowMs + CREDENTIAL_EXPIRING_DAYS * DAY_MS) return 'expiring';
  return 'valid';
}

export function formatCredentialTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function shortCredentialId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

interface ScopeGroupDefinition {
  key: string;
  label: string;
  scopes: ReadonlyArray<{ value: string; label: string }>;
}

const SCOPE_GROUPS: ScopeGroupDefinition[] = [
  {
    key: 'read',
    label: '只读',
    scopes: [
      { value: 'project:read', label: '项目读取' },
      { value: 'workflow:read', label: '流程读取' },
      { value: 'requirement:read', label: '需求读取' },
      { value: 'knowledge:read', label: '知识读取' },
      { value: 'task:read', label: '任务读取' },
      { value: 'context:read', label: '上下文读取' },
      { value: 'review:read', label: '评审读取' },
      { value: 'change:read', label: '变更读取' },
    ],
  },
  {
    key: 'proposal',
    label: '写入与提案',
    scopes: [
      { value: 'workflow:propose', label: '流程提案' },
      { value: 'requirement:propose', label: '需求提案' },
      { value: 'clarification:write', label: '澄清写入' },
      { value: 'knowledge:propose', label: '知识提案' },
    ],
  },
  {
    key: 'task',
    label: '任务执行',
    scopes: [
      { value: 'task:claim', label: '领取任务' },
      { value: 'task:release', label: '释放任务' },
      { value: 'task:deliver', label: '交付任务' },
      { value: 'context:create', label: '创建上下文' },
    ],
  },
  {
    key: 'review',
    label: '评审与变更',
    scopes: [
      { value: 'review:request', label: '发起评审' },
      { value: 'change:ack', label: '确认变更' },
    ],
  },
  {
    key: 'integration',
    label: '集成协作',
    scopes: [
      { value: 'integrations:receive', label: '接收集成' },
      { value: 'integrations:prepare', label: '准备集成' },
    ],
  },
];

export interface ScopeGroupView {
  key: string;
  label: string;
  items: Array<{ value: string; label: string }>;
}

export interface ScopeGrouping {
  groups: ScopeGroupView[];
  unknown: string[];
}

/** 按项目定义的 scope 中文语义分组；未知 scope 保留，不猜测含义。 */
export function groupCredentialScopes(scopes: readonly string[]): ScopeGrouping {
  const knownValues = new Set(
    SCOPE_GROUPS.flatMap((group) => group.scopes.map((scope) => scope.value)),
  );
  const groups = SCOPE_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    items: group.scopes
      .filter((scope) => scopes.includes(scope.value))
      .map((scope) => ({ value: scope.value, label: scope.label })),
  })).filter((group) => group.items.length > 0);
  return {
    groups,
    unknown: scopes.filter((scope) => !knownValues.has(scope)),
  };
}

function ScopeDetails({ scopes }: { scopes: string[] }) {
  if (scopes.length === 0) return <span className="muted">未返回权限范围</span>;
  const grouping = groupCredentialScopes(scopes);
  const summary = [
    ...grouping.groups.map((group) => group.label),
    ...(grouping.unknown.length > 0 ? ['未识别权限'] : []),
  ];
  return (
    <div className="profile-scopes">
      <span className="profile-scopes__summary">
        {summary.join(' · ')} <span className="muted">（{scopes.length} 项）</span>
      </span>
      <details className="profile-scopes__details">
        <summary>查看权限明细</summary>
        {grouping.groups.map((group) => (
          <div className="profile-scope-group" key={group.key}>
            <strong>{group.label}</strong>
            <span className="profile-scope-tags">
              {group.items.map((item) => (
                <span className="status-tag" key={item.value} title={item.value}>
                  {item.label}
                </span>
              ))}
            </span>
          </div>
        ))}
        {grouping.unknown.length > 0 && (
          <div className="profile-scope-group">
            <strong>未识别权限</strong>
            <span className="profile-scope-tags">
              {grouping.unknown.map((scope) => (
                <span className="status-tag is-danger" key={scope}>
                  {scope}
                </span>
              ))}
            </span>
            <p className="profile-scope-note">
              服务端返回了当前前端未登记的权限码，保留显示但不解释其含义。
            </p>
          </div>
        )}
        <p className="profile-scope-note cell-mono">技术值：{scopes.join(', ')}</p>
      </details>
    </div>
  );
}

type SortKey = 'expiry-asc' | 'expiry-desc' | 'name';
type StatusFilter = 'all' | CredentialStatusKind;

const css = `
.profile-credential-toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:end; padding:12px 16px; border-bottom:1px solid var(--border, #e2e8f0); }
.profile-credential-toolbar label { display:grid; gap:4px; font-size:12px; color:var(--text-secondary,#475569); }
.profile-credential-toolbar select { min-width:130px; height:32px; border:1px solid var(--border-strong,#cbd5e1); border-radius:7px; background:var(--surface,#fff); color:var(--text-primary,#0f172a); font:inherit; font-size:13px; padding:0 8px; }
.profile-credential-toolbar .ghost { min-height:32px; }
.profile-credentials-table { display:block; }
.profile-credentials-cards { display:none; }
.profile-credential-card { border:1px solid var(--border,#e2e8f0); border-radius:10px; background:var(--surface,#fff); padding:14px; display:grid; gap:8px; }
.profile-credential-card[data-inactive='true'] { background:var(--surface-hover,#f8fafc); }
.profile-credential-card__head { display:flex; gap:10px; justify-content:space-between; align-items:flex-start; }
.profile-credential-card__head strong { overflow-wrap:anywhere; }
.profile-credential-meta { color:var(--text-secondary,#64748b); font-size:12px; overflow-wrap:anywhere; }
.profile-credential-id { color:var(--text-muted,#7b8aa0); font-family:var(--wm-font-mono, ui-monospace, monospace); font-size:11px; }
.profile-scopes { display:grid; gap:4px; min-width:0; max-width:360px; }
.profile-scopes__summary { color:var(--text-secondary,#475569); font-size:12px; overflow-wrap:anywhere; }
.profile-scopes__details > summary { color:var(--accent-hover,#0e7490); font-size:12px; cursor:pointer; }
.profile-scope-group { display:flex; flex-wrap:wrap; gap:5px; align-items:baseline; margin-top:6px; font-size:12px; }
.profile-scope-group strong { color:var(--text-primary,#0f172a); font-size:12px; }
.profile-scope-tags { display:flex; flex-wrap:wrap; gap:4px; }
.profile-scope-note { color:var(--text-muted,#7b8aa0); font-size:11px; margin:4px 0 0; overflow-wrap:anywhere; }
.profile-credential-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.profile-empty-credentials { padding:18px; display:grid; gap:10px; max-width:620px; }
.profile-empty-credentials h3 { margin:0; font-size:16px; }
.profile-empty-credentials p { margin:0; color:var(--text-secondary,#475569); font-size:13px; }
.profile-empty-credentials code { padding:2px 6px; border-radius:4px; background:var(--surface-hover,#f1f5f9); font-family:var(--wm-font-mono,ui-monospace,monospace); }
@media (max-width: 720px) {
  .profile-credentials-table { display:none; }
  .profile-credentials-cards { display:grid; gap:10px; padding:12px; }
  .profile-credential-toolbar { align-items:stretch; flex-direction:column; }
  .profile-credential-toolbar label, .profile-credential-toolbar select { width:100%; }
  .profile-scopes { max-width:none; }
}
`;

/**
 * 用户中心只展示 cookie 会话账号与 Agent 凭据列表。
 * 凭据状态、筛选和吊销入口均以服务端返回字段推导；页面不保存任何 token 或密钥。
 */
export function Profile() {
  const user = useAuthStore((state) => state.user);
  const [credentials, setCredentials] = useState<CredentialView[]>([]);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'stale'>('loading');
  const [loadError, setLoadError] = useState<PageLoadState | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionErrorDetail, setActionErrorDetail] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('expiry-asc');
  const [revokeTarget, setRevokeTarget] = useState<CredentialView | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const requestRef = useRef(0);
  const now = new Date();

  async function load(refresh = false) {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (refresh) setRefreshing(true);
    else {
      setLoadState('loading');
      setLoadError(null);
    }
    try {
      const [credentialRows, projectRows] = await Promise.all([
        authApi.credentials(),
        projectApi.list().catch(() => []),
      ]);
      if (requestRef.current !== requestId) return;
      setCredentials(credentialRows);
      setProjects(projectRows);

      const projectIds = [...new Set(credentialRows.map((item) => item.projectId))];
      const rolePages = await Promise.all(
        projectIds.map((id) => projectApi.roles(id).catch(() => [])),
      );
      if (requestRef.current !== requestId) return;
      setRoles(rolePages.flat());
      setUpdatedAt(new Date());
      setLoadState('ready');
      setLoadError(null);
    } catch (caught) {
      if (requestRef.current !== requestId) return;
      const failure = toPageLoadState(caught, '暂时无法读取 Agent 凭据。请稍后重试。');
      setLoadError(failure);
      setLoadState(credentials.length > 0 ? 'stale' : 'error');
    } finally {
      if (requestRef.current === requestId) setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const roleTitleById = useMemo(() => new Map(roles.map((role) => [role.id, role.title])), [roles]);

  function projectLabel(projectId: string): string {
    return projectNameById.get(projectId) ?? `项目 ID ${shortCredentialId(projectId)}`;
  }

  function roleLabel(roleId: string): string {
    return roleTitleById.get(roleId) ?? `角色 ID ${shortCredentialId(roleId)}`;
  }

  const projectOptions = useMemo(() => {
    const ids = [...new Set(credentials.map((item) => item.projectId))];
    return ids.map((id) => ({
      id,
      label: projectNameById.get(id) ?? `项目 ID ${shortCredentialId(id)}`,
    }));
  }, [credentials, projectNameById]);

  const roleOptions = useMemo(() => {
    const ids = [...new Set(credentials.map((item) => item.roleId))];
    return ids.map((id) => {
      const role = roles.find((item) => item.id === id);
      const title = roleTitleById.get(id) ?? `角色 ID ${shortCredentialId(id)}`;
      return { id, label: role?.projectId ? `${title} · ${projectLabel(role.projectId)}` : title };
    });
  }, [credentials, projectLabel, roleTitleById, roles]);

  const hasActiveFilters =
    projectFilter !== 'all' || roleFilter !== 'all' || statusFilter !== 'all';

  function clearFilters() {
    setProjectFilter('all');
    setRoleFilter('all');
    setStatusFilter('all');
    setSortBy('expiry-asc');
  }

  const filteredCredentials = useMemo(() => {
    return credentials
      .filter((credential) => {
        if (projectFilter !== 'all' && credential.projectId !== projectFilter) return false;
        if (roleFilter !== 'all' && credential.roleId !== roleFilter) return false;
        if (statusFilter !== 'all' && credentialStatus(credential, now) !== statusFilter)
          return false;
        return true;
      })
      .sort((left, right) => {
        if (sortBy === 'name') return left.name.localeCompare(right.name, 'zh-CN');
        const leftExpiry = new Date(left.expiresAt).getTime();
        const rightExpiry = new Date(right.expiresAt).getTime();
        const leftValue = Number.isFinite(leftExpiry) ? leftExpiry : Number.MAX_SAFE_INTEGER;
        const rightValue = Number.isFinite(rightExpiry) ? rightExpiry : Number.MAX_SAFE_INTEGER;
        return sortBy === 'expiry-desc' ? rightValue - leftValue : leftValue - rightValue;
      });
    // now 只用于状态筛选；当前渲染时间改变时由状态派生重新计算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials, projectFilter, roleFilter, statusFilter, sortBy]);

  async function revoke(credential: CredentialView) {
    if (!['valid', 'expiring'].includes(credentialStatus(credential, now))) {
      setActionError('该凭据已失效，不能再次吊销。');
      setActionErrorDetail('');
      setRevokeTarget(null);
      return;
    }
    setRevokeBusy(true);
    setActionError('');
    setActionErrorDetail('');
    try {
      await authApi.revokeCredential(credential.id);
      setCredentials((current) =>
        current.map((item) =>
          item.id === credential.id ? { ...item, revokedAt: new Date().toISOString() } : item,
        ),
      );
      setNotice('凭据已吊销，立即失效。');
      setRevokeTarget(null);
      await load(true);
    } catch (caught) {
      setActionError('撤销凭据失败，请稍后重试。');
      setActionErrorDetail(formatApiError(caught));
    } finally {
      setRevokeBusy(false);
    }
  }

  function revokeControl(credential: CredentialView) {
    const status = credentialStatus(credential, now);
    if (status === 'revoked') {
      return (
        <button type="button" className="ghost" disabled>
          已吊销，不可撤销
        </button>
      );
    }
    if (status === 'expired') {
      return (
        <button type="button" className="ghost" disabled>
          已过期，不可撤销
        </button>
      );
    }
    if (status === 'unknown') {
      return (
        <button type="button" className="ghost" disabled>
          状态待确认，不可撤销
        </button>
      );
    }
    return (
      <button type="button" className="danger" onClick={() => setRevokeTarget(credential)}>
        吊销凭据
      </button>
    );
  }

  const loaded = loadState === 'ready' || loadState === 'stale';

  return (
    <section className="profile-page">
      <style>{css}</style>
      <header className="page-head">
        <div>
          <h2>用户中心</h2>
          <p className="page-sub">
            当前会话来自 HttpOnly Cookie；凭据列表只展示 Agent 凭据元数据。
          </p>
        </div>
      </header>

      <div className="page-card">
        <div className="profile-grid">
          <div>
            <small>邮箱</small>
            <strong>{user?.email ?? '未登录'}</strong>
          </div>
          <div>
            <small>用户 ID</small>
            <span className="cell-mono" title={user?.id ?? undefined}>
              {user?.id ? shortCredentialId(user.id) : '—'}
            </span>
          </div>
        </div>
      </div>

      {notice && <p className="kb-notice">{notice}</p>}
      {actionError && (
        <div className="error" role="alert">
          <p>{actionError}</p>
          {actionErrorDetail && (
            <details className="wm-error-state__details">
              <summary className="wm-error-state__summary">查看详细信息</summary>
              <pre className="wm-error-state__detail">{actionErrorDetail}</pre>
            </details>
          )}
        </div>
      )}

      <div className="table-card">
        <div className="card-head">
          <h3>
            Agent 凭据
            <small>{loaded ? `${filteredCredentials.length} / ${credentials.length}` : ''}</small>
          </h3>
          <div className="card-head-actions">
            {loaded && (
              <button
                type="button"
                className="ghost"
                onClick={() => void load(true)}
                disabled={refreshing}
              >
                {refreshing ? '刷新中…' : '刷新凭据'}
              </button>
            )}
          </div>
        </div>

        {loadState === 'loading' && (
          <PageState state={{ kind: 'loading' }} title="正在读取 Agent 凭据…" />
        )}
        {loadState === 'error' && loadError && (
          <PageState
            state={loadError}
            title="无法读取 Agent 凭据"
            onRetry={() => void load()}
            retryLabel="重试加载"
            retryAriaLabel="重试加载 Agent 凭据"
          />
        )}
        {loadState === 'stale' && (
          <>
            <StaleDataBanner
              updatedAt={updatedAt ?? undefined}
              message="本次刷新失败，数据可能已过期。"
              onRetry={() => void load(true)}
              retryLabel="重试刷新"
              retryAriaLabel="重试刷新 Agent 凭据"
            />
            {loadError?.kind === 'error' && loadError.detail && (
              <details className="wm-error-state__details" style={{ margin: '8px 16px' }}>
                <summary className="wm-error-state__summary">查看详细信息</summary>
                <pre className="wm-error-state__detail">{loadError.detail}</pre>
              </details>
            )}
          </>
        )}

        {loaded && credentials.length === 0 && (
          <div className="profile-empty-credentials" data-testid="profile-empty-credentials">
            <h3>还没有 Agent 凭据</h3>
            <p>当前账号还没有 Agent 凭据。凭据由 CLI 设备授权创建，Web 不直接签发凭据。</p>
            <p>
              在 CLI 运行 <code>workmesh auth login</code>，然后在浏览器中完成设备授权。
            </p>
            <div className="profile-credential-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText('workmesh auth login')
                    .then(() => setCommandCopied(true))
                    .catch(() => setCommandCopied(false));
                }}
              >
                {commandCopied ? '已复制命令' : '复制 CLI 命令'}
              </button>
              <Link className="primary" to="/authorization">
                打开设备授权
              </Link>
            </div>
          </div>
        )}

        {loaded && credentials.length > 0 && (
          <>
            <div className="profile-credential-toolbar" aria-label="凭据筛选与排序">
              <label>
                按项目筛选
                <select
                  aria-label="按项目筛选"
                  value={projectFilter}
                  onChange={(event) => setProjectFilter(event.target.value)}
                >
                  <option value="all">全部项目</option>
                  {projectOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                按角色筛选
                <select
                  aria-label="按角色筛选"
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value)}
                >
                  <option value="all">全部角色</option>
                  {roleOptions.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                按状态筛选
                <select
                  aria-label="按状态筛选"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                >
                  <option value="all">全部状态</option>
                  <option value="valid">有效</option>
                  <option value="expiring">即将过期</option>
                  <option value="expired">已过期</option>
                  <option value="revoked">已吊销</option>
                  <option value="unknown">状态待确认</option>
                </select>
              </label>
              <label>
                排序
                <select
                  aria-label="凭据排序"
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortKey)}
                >
                  <option value="expiry-asc">到期时间（最近优先）</option>
                  <option value="expiry-desc">到期时间（最远优先）</option>
                  <option value="name">名称 A–Z</option>
                </select>
              </label>
              {hasActiveFilters && (
                <button type="button" className="ghost" onClick={clearFilters}>
                  清除筛选
                </button>
              )}
            </div>

            {filteredCredentials.length === 0 ? (
              <PageState
                state={{ kind: 'empty' }}
                title="当前筛选没有匹配的凭据"
                description="调整项目、角色或状态筛选，或清除筛选查看全部凭据。"
                action={{ label: '清除筛选', onClick: clearFilters }}
              />
            ) : (
              <>
                <div className="table-scroll profile-credentials-table">
                  <table className="data-table" data-testid="credentials-table">
                    <thead>
                      <tr>
                        <th>凭据</th>
                        <th>项目</th>
                        <th>角色</th>
                        <th>状态</th>
                        <th>权限</th>
                        <th>到期时间</th>
                        <th className="col-actions">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCredentials.map((credential) => {
                        const status = credentialStatus(credential, now);
                        return (
                          <tr
                            key={credential.id}
                            data-credential-id={credential.id}
                            data-inactive={status === 'revoked' || status === 'expired'}
                          >
                            <td>
                              <strong>{credential.name}</strong>
                              <div className="profile-credential-id" title={credential.id}>
                                凭据 ID {shortCredentialId(credential.id)}
                              </div>
                            </td>
                            <td>{projectLabel(credential.projectId)}</td>
                            <td>{roleLabel(credential.roleId)}</td>
                            <td>
                              <span className={`status-tag ${STATUS_TONES[status]}`.trim()}>
                                {STATUS_LABELS[status]}
                              </span>
                            </td>
                            <td>
                              <ScopeDetails scopes={credential.scopes} />
                            </td>
                            <td>
                              <span>{formatCredentialTime(credential.expiresAt)}</span>
                              {credential.revokedAt && (
                                <div className="profile-credential-meta">
                                  吊销于 {formatCredentialTime(credential.revokedAt)}
                                </div>
                              )}
                            </td>
                            <td className="col-actions">
                              <div className="profile-credential-actions">
                                {revokeControl(credential)}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="profile-credentials-cards" data-testid="credentials-cards">
                  {filteredCredentials.map((credential) => {
                    const status = credentialStatus(credential, now);
                    return (
                      <article
                        className="profile-credential-card"
                        key={credential.id}
                        data-credential-id={credential.id}
                        data-inactive={status === 'revoked' || status === 'expired'}
                        aria-label={`凭据 ${credential.name}，${projectLabel(credential.projectId)}，${roleLabel(credential.roleId)}，状态${STATUS_LABELS[status]}`}
                      >
                        <div className="profile-credential-card__head">
                          <strong>{credential.name}</strong>
                          <span className={`status-tag ${STATUS_TONES[status]}`.trim()}>
                            {STATUS_LABELS[status]}
                          </span>
                        </div>
                        <p className="profile-credential-meta">
                          {projectLabel(credential.projectId)} · {roleLabel(credential.roleId)}
                        </p>
                        <p className="profile-credential-id" title={credential.id}>
                          凭据 ID {shortCredentialId(credential.id)}
                        </p>
                        <p className="profile-credential-meta">
                          到期：{formatCredentialTime(credential.expiresAt)}
                        </p>
                        {credential.revokedAt && (
                          <p className="profile-credential-meta">
                            吊销于：{formatCredentialTime(credential.revokedAt)}
                          </p>
                        )}
                        <ScopeDetails scopes={credential.scopes} />
                        <div className="profile-credential-actions">
                          {revokeControl(credential)}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="吊销 Agent 凭据"
        description={
          revokeTarget
            ? `吊销后，这个 Agent 凭据会立即失效，不能继续访问项目「${projectLabel(revokeTarget.projectId)}」；如需继续使用，必须重新通过 CLI 设备授权。`
            : ''
        }
        note="凭据记录会保留，项目数据不会被删除。"
        tone="danger"
        confirmLabel="确认吊销凭据"
        busy={revokeBusy}
        onCancel={() => {
          if (!revokeBusy) setRevokeTarget(null);
        }}
        onConfirm={() => {
          if (revokeTarget) void revoke(revokeTarget);
        }}
      />
    </section>
  );
}
