import { useEffect, useMemo, useRef, useState } from 'react';
import { SCOPE_REGISTRY, isKnownScope } from '@workmesh/shared';
import { ApiError, formatApiError } from '../api/client';
import { authApi, type CliAuthorizationView } from '../api/auth';
import { projectApi, type ProjectView, type RoleView } from '../api/resources';
import { ConfirmDialog } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { loadProjects } from '../store/project';

export const MAX_AUTHORIZATION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AuthorizationStatusKind =
  'pending' | 'approved' | 'denied' | 'issued' | 'expired' | 'unknown';

export interface AuthorizationStatusView {
  kind: AuthorizationStatusKind;
  label: string;
  raw: string;
  canApprove: boolean;
}

const STATUS_LABELS: Record<AuthorizationStatusKind, string> = {
  pending: '待处理',
  approved: '已批准，等待 CLI 领取',
  denied: '已拒绝',
  issued: '已签发',
  expired: '已过期',
  unknown: '状态待确认',
};

/** 只把服务端真实状态枚举映射成中文；未知状态保留原始值并禁止批准。 */
export function authorizationStatusOf(
  lookup: Pick<CliAuthorizationView, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): AuthorizationStatusView {
  const expiresAt = new Date(lookup.expiresAt).getTime();
  const raw = lookup.status;
  if (raw === 'PENDING') {
    // 时间不可解析时无法证明请求仍有效，必须按未知状态关闭批准/拒绝入口。
    if (!Number.isFinite(expiresAt)) {
      return { kind: 'unknown', label: STATUS_LABELS.unknown, raw, canApprove: false };
    }
    if (expiresAt <= now.getTime()) {
      return { kind: 'expired', label: STATUS_LABELS.expired, raw, canApprove: false };
    }
    return { kind: 'pending', label: STATUS_LABELS.pending, raw, canApprove: true };
  }
  if (raw === 'APPROVED') {
    return { kind: 'approved', label: STATUS_LABELS.approved, raw, canApprove: false };
  }
  if (raw === 'DENIED') {
    return { kind: 'denied', label: STATUS_LABELS.denied, raw, canApprove: false };
  }
  if (raw === 'ISSUED') {
    return { kind: 'issued', label: STATUS_LABELS.issued, raw, canApprove: false };
  }
  if (raw === 'EXPIRED') {
    return { kind: 'expired', label: STATUS_LABELS.expired, raw, canApprove: false };
  }
  return { kind: 'unknown', label: STATUS_LABELS.unknown, raw, canApprove: false };
}

interface ScopeGroupDefinition {
  key: string;
  label: string;
  scopes: Array<{ value: string; label: string }>;
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

export interface AuthorizationScopeGroupView {
  key: string;
  label: string;
  items: Array<{ value: string; label: string; selected: boolean }>;
}

export interface AuthorizationScopeGrouping {
  groups: AuthorizationScopeGroupView[];
  unknownSelected: string[];
}

/** 权限选项只来自 SCOPE_REGISTRY；选中值里的未知项保留并标记，不猜测含义。 */
export function groupAuthorizationScopes(selected: readonly string[]): AuthorizationScopeGrouping {
  const selectedSet = new Set(selected);
  const groups = SCOPE_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    items: group.scopes
      .filter((scope) => isKnownScope(scope.value))
      .map((scope) => ({ ...scope, selected: selectedSet.has(scope.value) })),
  })).filter((group) => group.items.length > 0);
  const known = new Set(SCOPE_GROUPS.flatMap((group) => group.scopes.map((scope) => scope.value)));
  return {
    groups,
    unknownSelected: selected.filter((scope) => !known.has(scope)),
  };
}

export function scopeLabelOf(scope: string): string {
  for (const group of SCOPE_GROUPS) {
    const found = group.scopes.find((item) => item.value === scope);
    if (found) return found.label;
  }
  return '未识别权限';
}

interface FailureView {
  message: string;
  detail: string;
  requestId?: string;
}

function describeFailure(
  caught: unknown,
  context: 'lookup' | 'approve' | 'deny' | 'projects' | 'roles',
): FailureView {
  const detail = formatApiError(caught);
  const requestId = caught instanceof ApiError ? caught.requestId : undefined;
  if (caught instanceof ApiError) {
    if (caught.status === 429) return { message: '请求过于频繁，请稍后再试。', detail, requestId };
    if (caught.status === 401)
      return { message: '登录状态已失效，请重新登录后重试。', detail, requestId };
    if (context === 'lookup' && caught.status === 404)
      return {
        message: '授权码不存在或已过期，请在 CLI 重新运行 workmesh auth login 获取新授权码。',
        detail,
        requestId,
      };
    if (caught.status === 410) {
      return {
        message: '授权请求已过期，请重新查询或在 CLI 重新发起。',
        detail,
        requestId,
      };
    }
    if (caught.status === 409) {
      return {
        message: '授权请求状态已变化，请重新查询后再操作。',
        detail,
        requestId,
      };
    }
    if (caught.status === 422 || caught.code === 'UNSUPPORTED_SCOPE') {
      return {
        message: '所选权限或授权信息未被服务端接受，请检查后重试。',
        detail,
        requestId,
      };
    }
    if (caught.status === 400) {
      return {
        message: '提交信息不符合要求，请检查有效期、项目、角色与权限。',
        detail,
        requestId,
      };
    }
  }
  const fallbacks: Record<typeof context, string> = {
    lookup: '暂时无法查询授权请求，请稍后重试。',
    approve: '批准授权失败，请稍后重试。',
    deny: '拒绝授权失败，请稍后重试。',
    projects: '暂时无法读取项目列表，请稍后重试。',
    roles: '暂时无法读取项目角色，请稍后重试。',
  };
  return { message: fallbacks[context], detail, requestId };
}

function isExpiryValid(value: string): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= MAX_AUTHORIZATION_DAYS;
}

function expiryError(value: string): string {
  if (!value.trim()) return '请输入有效期。';
  if (!/^\d+$/.test(value.trim())) return `有效期必须是 1–${MAX_AUTHORIZATION_DAYS} 的整数天。`;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > MAX_AUTHORIZATION_DAYS)
    return `有效期必须是 1–${MAX_AUTHORIZATION_DAYS} 的整数天。`;
  return '';
}

function formatDateTime(value: string | number): string {
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

const css = `
.authorization-page { max-width:1120px; }
.authorization-guide { margin-top:16px; }
.authorization-guide code { padding: 2px 6px; border-radius: 4px; background: var(--surface-hover, #f1f5f9); font-family: var(--wm-font-mono, ui-monospace, monospace); }
.authorization-query { max-width:640px; }
.authorization-query__row { display:flex; gap:8px; align-items:center; }
.authorization-query__row input { flex:0 1 320px; min-width:0; font-family:var(--wm-font-mono, ui-monospace, monospace); letter-spacing:0.06em; }
.authorization-query__row .primary { flex:0 0 auto; white-space:nowrap; }
.authorization-summary { margin:12px 0; padding:12px; border:1px solid var(--border,#e2e8f0); border-radius:8px; background:var(--surface-hover,#f8fafc); }
.authorization-summary__meta { display:flex; flex-wrap:wrap; gap:8px 18px; color:var(--text-secondary,#475569); font-size:12px; }
.authorization-scope-groups { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:8px; }
.authorization-scope-group { border:1px solid var(--border,#e2e8f0); border-radius:8px; padding:10px; min-width:0; }
.authorization-scope-group legend { padding:0 4px; color:var(--text-primary,#0f172a); font-size:12px; font-weight:600; }
.authorization-scope-options { display:grid; gap:6px; }
.authorization-scope-options label { display:flex; gap:7px; align-items:center; min-height:28px; font-size:12px; overflow-wrap:anywhere; }
.authorization-selected { display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; }
.authorization-selected .status-tag { white-space:normal; }
.authorization-error-detail { margin-top:6px; }
.authorization-notice { margin:8px 0; }
@media (max-width: 720px) {
  .authorization-scope-groups { grid-template-columns:1fr; }
  .authorization-query__row { flex-direction:column; align-items:stretch; }
  .authorization-query__row input { flex:0 0 auto; }
  .authorization-query__row .primary { width:100%; }
}
`;

/**
 * CLI 设备授权批准页：只处理用户主动输入的 userCode。
 * 批准时提交预期的授权请求版本；角色、项目与 scope 最终仍由服务端校验。
 * 确认弹窗只是防误点的操作确认，不代表密码、票据或第二因素认证。
 */
export function Authorization() {
  const [userCode, setUserCode] = useState('');
  const [lookup, setLookup] = useState<CliAuthorizationView | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupFailure, setLookupFailure] = useState<FailureView | null>(null);
  const [actionFailure, setActionFailure] = useState<FailureView | null>(null);
  const [notice, setNotice] = useState('');
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [projectsState, setProjectsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [projectsFailure, setProjectsFailure] = useState<FailureView | null>(null);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [rolesState, setRolesState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [rolesFailure, setRolesFailure] = useState<FailureView | null>(null);
  const [projectId, setProjectId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [scopes, setScopes] = useState<string[]>(['project:read']);
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [approveOpen, setApproveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lookupRequestRef = useRef(0);
  const rolesRequestRef = useRef(0);
  const now = new Date();
  const status = lookup ? authorizationStatusOf(lookup, now) : null;
  const expiryValidation = expiryError(expiresInDays);
  const canSubmit =
    status?.canApprove === true &&
    Boolean(projectId) &&
    Boolean(roleId) &&
    scopes.length > 0 &&
    !expiryValidation;
  const projectName = projects.find((project) => project.id === projectId)?.name ?? '';
  const roleTitle = roles.find((role) => role.id === roleId)?.title ?? '';

  const scopeGrouping = groupAuthorizationScopes(scopes);
  const selectedKnownScopes = SCOPE_REGISTRY.filter((scope) => scopes.includes(scope));

  const approveSummary = useMemo(() => {
    if (!lookup) return '';
    const days = Number(expiresInDays);
    const expectedExpiry = new Date(Date.now() + days * DAY_MS);
    const scopeDescription =
      scopes.length > 0
        ? scopes
            .map((scope) =>
              scopeLabelOf(scope) === '未识别权限'
                ? `未识别权限（${scope}）`
                : `${scopeLabelOf(scope)}（${scope}）`,
            )
            .join('、')
        : '（无）';
    const isMinimal = scopes.length === 1 && scopes[0] === 'project:read';
    return [
      `客户端：${lookup.clientName}`,
      `授权请求状态：${status?.label ?? '状态待确认'}（原始状态 ${lookup.status}，v${lookup.version}）`,
      `项目：${projectName || projectId}`,
      `角色：${roleTitle || roleId}`,
      `权限（${scopes.length} 项）：${scopeDescription}`,
      `有效期：${days} 天`,
      `预计到期：${Number.isFinite(expectedExpiry.getTime()) ? formatDateTime(expectedExpiry.getTime()) : '无法计算'}`,
      isMinimal
        ? '权限范围：默认最小权限（project:read）。'
        : '权限范围：已扩大，超出默认最小权限 project:read。',
      '授权影响：批准后，该 CLI 可在所选项目与角色范围内使用上述权限；服务端仍会校验越权操作。',
    ].join('；');
  }, [expiresInDays, lookup, projectId, projectName, roleId, roleTitle, scopes, status?.label]);

  useEffect(() => {
    let alive = true;
    setProjectsState('loading');
    loadProjects()
      .then((list) => {
        if (!alive) return;
        setProjects(list);
        setProjectsState('ready');
        setProjectsFailure(null);
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setProjectsState('error');
        setProjectsFailure(describeFailure(caught, 'projects'));
      });
    return () => {
      alive = false;
    };
  }, []);

  function clearLookupDraft() {
    setLookup(null);
    setLookupFailure(null);
    setActionFailure(null);
    setNotice('');
    setProjectId('');
    setRoleId('');
    setRoles([]);
    setRolesState('idle');
    setRolesFailure(null);
    setScopes(['project:read']);
    setExpiresInDays('30');
    setApproveOpen(false);
  }

  function handleCodeChange(value: string) {
    lookupRequestRef.current += 1;
    setUserCode(value.toUpperCase());
    setLookupBusy(false);
    clearLookupDraft();
  }

  async function doLookup() {
    const code = userCode.trim();
    if (!code) return;
    const requestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = requestId;
    setLookupBusy(true);
    clearLookupDraft();
    try {
      const value = await authApi.cliLookup(code);
      if (lookupRequestRef.current !== requestId) return;
      setLookup(value);
      setNotice('请确认客户端名称、授权范围与有效期后再批准。');
    } catch (caught) {
      if (lookupRequestRef.current !== requestId) return;
      setLookup(null);
      setLookupFailure(describeFailure(caught, 'lookup'));
    } finally {
      if (lookupRequestRef.current === requestId) setLookupBusy(false);
    }
  }

  async function loadRoles(nextProjectId: string) {
    setProjectId(nextProjectId);
    setRoleId('');
    setRoles([]);
    const requestId = rolesRequestRef.current + 1;
    rolesRequestRef.current = requestId;
    if (!nextProjectId) {
      setRolesState('idle');
      setRolesFailure(null);
      return;
    }
    setRolesState('loading');
    setRolesFailure(null);
    try {
      const value = await projectApi.roles(nextProjectId);
      if (rolesRequestRef.current !== requestId) return;
      setRoles(value);
      setRolesState('ready');
    } catch (caught) {
      if (rolesRequestRef.current !== requestId) return;
      setRoles([]);
      setRolesState('error');
      setRolesFailure(describeFailure(caught, 'roles'));
    }
  }

  function toggleScope(scope: string) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  }

  function clearScopes() {
    setScopes([]);
  }

  async function approve() {
    if (!lookup) return;
    if (!canSubmit) {
      setActionFailure({
        message: '请选择项目、业务角色、至少一个权限，并填写 1–30 的整数有效期。',
        detail: '',
      });
      return;
    }
    setBusy(true);
    setActionFailure(null);
    try {
      const result = await authApi.cliApprove({
        authorizationId: lookup.authorizationId,
        expectedVersion: lookup.version,
        projectId,
        roleId,
        scopes,
        expiresInDays: Number(expiresInDays),
      });
      const resultStatus = authorizationStatusOf({
        status: result.status,
        expiresAt: lookup.expiresAt,
      });
      setNotice(
        `授权结果：${resultStatus.label}（v${result.version}）。该确认不是密码验证或第二因素认证。`,
      );
      setLookup({ ...lookup, status: result.status, version: result.version });
      setApproveOpen(false);
    } catch (caught) {
      setActionFailure(describeFailure(caught, 'approve'));
      setApproveOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function deny() {
    if (!lookup) return;
    setBusy(true);
    setActionFailure(null);
    try {
      const result = await authApi.cliDeny(lookup.authorizationId, lookup.version);
      const resultStatus = authorizationStatusOf({
        status: result.status,
        expiresAt: lookup.expiresAt,
      });
      setNotice(`授权结果：${resultStatus.label}（v${result.version}）。`);
      setLookup({ ...lookup, status: result.status, version: result.version });
    } catch (caught) {
      setActionFailure(describeFailure(caught, 'deny'));
    } finally {
      setBusy(false);
    }
  }

  function retryLookup() {
    void doLookup();
  }

  function retryProjects() {
    setProjectsState('loading');
    setProjectsFailure(null);
    loadProjects(true)
      .then((list) => {
        setProjects(list);
        setProjectsState('ready');
      })
      .catch((caught: unknown) => {
        setProjectsState('error');
        setProjectsFailure(describeFailure(caught, 'projects'));
      });
  }

  function retryRoles() {
    if (projectId) void loadRoles(projectId);
  }

  const showPendingForm = status?.canApprove === true;

  return (
    <section className="authorization-page">
      <style>{css}</style>
      <header className="page-head">
        <div>
          <h2>设备授权</h2>
          <p className="page-sub">
            为 CLI 批准一次设备授权。页面只提交所选项目、业务角色与权限；服务端仍是最终校验方。
            这里的确认弹窗只是防误点操作确认，不是密码或第二因素认证。
          </p>
        </div>
      </header>

      {notice && (
        <p className="kb-notice authorization-notice" role="status">
          {notice}
        </p>
      )}
      {actionFailure && (
        <div className="error" role="alert">
          <p>{actionFailure.message}</p>
          {actionFailure.detail && (
            <details className="wm-error-state__details authorization-error-detail">
              <summary className="wm-error-state__summary">查看详细信息</summary>
              <pre className="wm-error-state__detail">{actionFailure.detail}</pre>
            </details>
          )}
        </div>
      )}

      <div className="page-card">
        <form
          className="form-grid authorization-query"
          onSubmit={(event) => {
            event.preventDefault();
            if (userCode.trim()) void doLookup();
          }}
        >
          <div className="field">
            <label htmlFor="authorization-code">授权码</label>
            <div className="authorization-query__row">
              <input
                id="authorization-code"
                value={userCode}
                onChange={(event) => handleCodeChange(event.target.value)}
                placeholder="例如 ABCD-EFGH"
                autoComplete="one-time-code"
                spellCheck={false}
              />
              <button className="primary" type="submit" disabled={lookupBusy || !userCode.trim()}>
                {lookupBusy ? '查询中…' : '查询授权请求'}
              </button>
            </div>
            <small className="muted">
              在 CLI 运行 <code>workmesh auth login</code> 获取授权码，再填写到这里查询；按 Enter
              可直接查询。
            </small>
          </div>
        </form>

        {!lookup && !lookupBusy && !lookupFailure && (
          <EmptyState
            className="authorization-guide"
            variant="waiting"
            title="还没有查询授权请求"
            description="在 CLI 运行 workmesh auth login，把终端显示的设备授权码填写到上方查询。"
            hint="授权码用于把 CLI 与当前登录账号关联；批准前请核对客户端名称、项目、角色与权限范围。"
          />
        )}

        {lookupFailure && (
          <ErrorState
            title="查询授权请求失败"
            message={lookupFailure.message}
            detail={lookupFailure.detail}
            requestId={lookupFailure.requestId}
            onRetry={retryLookup}
            retryLabel="重新查询"
            retryAriaLabel="重新查询设备授权请求"
          />
        )}

        {lookup && status && (
          <>
            <div className="authorization-summary">
              <div
                className="card-head"
                style={{ padding: 0, border: 0, background: 'transparent' }}
              >
                <h3>
                  {lookup.clientName}
                  <small className="status-tag" data-status={status.kind}>
                    {status.label}
                  </small>
                </h3>
                <span className="card-head-actions">
                  <small>版本 v{lookup.version}</small>
                </span>
              </div>
              <div className="authorization-summary__meta">
                <span>授权请求：{lookup.authorizationId}</span>
                <span>请求时间：{formatDateTime(lookup.createdAt)}</span>
                <span>请求有效期至：{formatDateTime(lookup.expiresAt)}</span>
              </div>
              <details className="wm-error-state__details">
                <summary className="wm-error-state__summary">查看原始状态</summary>
                <pre className="wm-error-state__detail">status: {lookup.status}</pre>
              </details>
            </div>

            {status.kind === 'unknown' && (
              <p className="error" role="alert">
                服务端返回了未识别的授权状态；页面不会批准未知状态的请求，请稍后重新查询。
              </p>
            )}
            {status.kind === 'expired' && (
              <p className="error" role="alert">
                该授权请求已过期，不能批准或拒绝；请重新在 CLI 发起授权。
              </p>
            )}
            {status.kind === 'approved' && (
              <p className="kb-notice">已批准，等待 CLI 完成凭据领取；页面不再提供批准入口。</p>
            )}
            {status.kind === 'issued' && (
              <p className="kb-notice">授权已签发；页面不再提供批准入口。</p>
            )}
            {status.kind === 'denied' && (
              <p className="kb-notice">该授权请求已被拒绝；页面不再提供批准入口。</p>
            )}

            {showPendingForm && (
              <div className="form-grid">
                <div className="field">
                  <span>项目</span>
                  <select
                    value={projectId}
                    aria-label="授权项目"
                    disabled={projectsState === 'loading'}
                    onChange={(event) => void loadRoles(event.target.value)}
                  >
                    <option value="">
                      {projectsState === 'loading' ? '正在读取项目…' : '选择项目'}
                    </option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}（{project.key}）
                      </option>
                    ))}
                  </select>
                  {projectsState === 'error' && projectsFailure && (
                    <div className="error" role="alert">
                      <p>{projectsFailure.message}</p>
                      <button type="button" className="ghost" onClick={retryProjects}>
                        重试加载项目
                      </button>
                      {projectsFailure.detail && (
                        <details className="wm-error-state__details authorization-error-detail">
                          <summary className="wm-error-state__summary">查看详细信息</summary>
                          <pre className="wm-error-state__detail">{projectsFailure.detail}</pre>
                        </details>
                      )}
                    </div>
                  )}
                  {projectsState === 'ready' && projects.length === 0 && (
                    <small className="muted">当前账号没有可授权的项目。</small>
                  )}
                </div>

                <div className="field">
                  <span>业务角色</span>
                  <select
                    value={roleId}
                    aria-label="授权角色"
                    disabled={!projectId || rolesState === 'loading' || rolesState === 'error'}
                    onChange={(event) => setRoleId(event.target.value)}
                  >
                    <option value="">
                      {!projectId
                        ? '先选择项目'
                        : rolesState === 'loading'
                          ? '正在读取角色…'
                          : rolesState === 'error'
                            ? '角色读取失败'
                            : '选择角色'}
                    </option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.title}
                      </option>
                    ))}
                  </select>
                  {rolesState === 'loading' && <small className="muted">正在读取角色…</small>}
                  {rolesState === 'error' && rolesFailure && (
                    <div className="error" role="alert">
                      <p>{rolesFailure.message}</p>
                      <button type="button" className="ghost" onClick={retryRoles}>
                        重试加载角色
                      </button>
                      {rolesFailure.detail && (
                        <details className="wm-error-state__details authorization-error-detail">
                          <summary className="wm-error-state__summary">查看详细信息</summary>
                          <pre className="wm-error-state__detail">{rolesFailure.detail}</pre>
                        </details>
                      )}
                    </div>
                  )}
                  {rolesState === 'ready' && roles.length === 0 && (
                    <small className="muted">该项目没有可用业务角色。</small>
                  )}
                </div>

                <div className="field">
                  <label htmlFor="authorization-expiry">有效期（天）</label>
                  <input
                    id="authorization-expiry"
                    type="number"
                    min={1}
                    max={MAX_AUTHORIZATION_DAYS}
                    step={1}
                    value={expiresInDays}
                    onChange={(event) => setExpiresInDays(event.target.value)}
                    aria-invalid={Boolean(expiryValidation)}
                    aria-describedby="authorization-expiry-hint"
                  />
                  <small
                    className={expiryValidation ? 'error' : 'muted'}
                    id="authorization-expiry-hint"
                  >
                    {expiryValidation || `必须为 1–${MAX_AUTHORIZATION_DAYS} 的整数天。`}
                  </small>
                </div>

                <div className="field">
                  <div className="field-head">
                    <span>权限范围</span>
                    <button type="button" className="ghost" onClick={clearScopes}>
                      清除选择
                    </button>
                  </div>
                  <small className="muted">
                    已选 {scopes.length} 项：
                    {selectedKnownScopes.map(scopeLabelOf).join('、') || '无'}
                    {scopeGrouping.unknownSelected.length > 0
                      ? `；未识别权限：${scopeGrouping.unknownSelected.join('、')}`
                      : ''}
                  </small>
                  <div className="authorization-scope-groups">
                    {scopeGrouping.groups.map((group) => (
                      <fieldset className="authorization-scope-group" key={group.key}>
                        <legend>{group.label}</legend>
                        <div className="authorization-scope-options">
                          {group.items.map((item) => (
                            <label key={item.value}>
                              <input
                                type="checkbox"
                                checked={item.selected}
                                aria-label={`${group.label}：${item.label}`}
                                onChange={() => toggleScope(item.value)}
                              />
                              <span>
                                {item.label} <small className="cell-mono">{item.value}</small>
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ))}
                  </div>
                  <div className="authorization-selected" aria-label="已选权限">
                    {scopes.map((scope) => (
                      <span className="status-tag" key={scope}>
                        {scopeLabelOf(scope)}（{scope}）
                      </span>
                    ))}
                  </div>
                  <small className="muted">
                    服务端仍会拒绝越权权限；Agent 不能获得发布、撤销或管理权限。
                  </small>
                </div>

                <div className="toolbar">
                  <button
                    className="danger"
                    type="button"
                    disabled={busy}
                    onClick={() => void deny()}
                  >
                    拒绝授权
                  </button>
                  <button
                    className="primary"
                    type="button"
                    disabled={busy || !canSubmit}
                    onClick={() => setApproveOpen(true)}
                  >
                    {busy ? '提交中…' : '批准授权'}
                  </button>
                  {!canSubmit && (
                    <small className="muted">
                      {expiryValidation ||
                        (!projectId
                          ? '请选择项目。'
                          : !roleId
                            ? '请选择角色。'
                            : scopes.length === 0
                              ? '请选择至少一个权限。'
                              : '')}
                    </small>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={approveOpen}
        title="确认批准设备授权"
        description={approveSummary}
        note="这是为避免误点的操作确认，不是密码验证、确认票据或第二因素认证；不改变服务端授权安全模型。"
        tone="primary"
        confirmLabel="确认批准授权"
        busy={busy}
        onCancel={() => {
          if (!busy) setApproveOpen(false);
        }}
        onConfirm={() => void approve()}
      />
    </section>
  );
}
