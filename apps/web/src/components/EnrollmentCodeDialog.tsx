import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, formatApiError } from '../api/client';
import {
  projectApi,
  workspaceApi,
  type RoleView,
  type WorkspaceEnrollmentView,
} from '../api/resources';
import { formatDateTime } from '../lib/datetime';
import { buildOnboardingCommand, validateOnboardingParameters } from '../lib/onboarding-command';
import {
  configuredPublicApi,
  readOnboardingPreferences,
  saveOnboardingPreferences,
} from '../lib/onboarding-preferences';
import { useAuthStore } from '../store/auth';
import { Modal } from './Modal';
import { InlineLoading } from './Skeleton';

export interface EnrollmentCodeDialogProps {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
}

function hasCode(error: ApiError, code: string): boolean {
  return error.code === code || error.message === code;
}

/**
 * 接入码签发错误说明（§13.3 / §13.5）：
 * 签发只要求活动 HUMAN 成员 + 限流，不需要确认票据；码本身不授权任何东西。
 */
export function describeEnrollmentError(error: unknown): string {
  if (!(error instanceof ApiError)) return formatApiError(error);

  if (hasCode(error, 'PROJECT_UNCONFIGURED')) {
    return '项目尚未发布工作区定义，不能签发接入码。请先由 OWNER/ADMIN 发布定义（无代码项目需显式发布 layout.kind = NONE），发布后重试。';
  }
  if (hasCode(error, 'ENROLLMENT_CODE_NOT_REPLAYABLE')) {
    const enrollmentId =
      typeof error.details?.enrollmentId === 'string' ? error.details.enrollmentId : '';
    return `本次请求命中了已签发过的接入码，明文不会重复返回（enrollmentId ${enrollmentId || '未知'}）。请重新生成新码，旧码会作废。`;
  }
  if (hasCode(error, 'PROJECT_ARCHIVED')) {
    return '项目已归档，不能再签发接入码。';
  }
  if (hasCode(error, 'HUMAN_SESSION_REQUIRED') || error.status === 403) {
    return '需要已登录的 HUMAN 会话才能签发接入码。';
  }
  if (hasCode(error, 'RATE_LIMITED') || error.status === 429) {
    return error.retryAfterSeconds !== null
      ? `请求过于频繁，请在 ${error.retryAfterSeconds} 秒后重试。`
      : '请求过于频繁，请稍后重试（服务端未提供可解析的等待时间）。';
  }
  if (error.status === 404) {
    return '你已不是该项目成员，或项目不可访问，无法签发接入码。';
  }
  return formatApiError(error);
}

/**
 * 一次性接入码：明文只在签发响应里出现一次，关闭即丢失，重新生成会让旧码作废。
 * 接入码只解析项目与签发时的已发布 revision，不授予成员/知识/仓库/Agent 权限。
 */
export function EnrollmentCodeDialog({ open, projectId, onClose }: EnrollmentCodeDialogProps) {
  const userId = useAuthStore((state) => state.user?.id);
  const [issued, setIssued] = useState<WorkspaceEnrollmentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [shell, setShell] = useState('');
  const [host, setHost] = useState('');
  const [role, setRole] = useState('');
  const [root, setRoot] = useState('');
  const [api, setApi] = useState('');
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [rolesError, setRolesError] = useState('');
  const [rolesLoading, setRolesLoading] = useState(false);
  const [assignedRoleKeys, setAssignedRoleKeys] = useState<string[] | null>(null);
  const [onlyCode, setOnlyCode] = useState(false);
  const [publicApiError, setPublicApiError] = useState('');
  const generationRef = useRef(0);
  const currentPropsRef = useRef({ open, projectId });

  // Closing or switching projects immediately invalidates in-flight work and
  // clears the one-time code before paint or a late promise can repopulate it.
  useLayoutEffect(() => {
    currentPropsRef.current = { open, projectId };
    generationRef.current += 1;
    setIssued(null);
    setBusy(false);
    setCopyBusy(false);
    setError('');
    setNotice('');
    const preferences = readOnboardingPreferences();
    setShell(preferences.shell);
    setHost(preferences.host);
    setRole('');
    setRoot('');
    const publicApi = configuredPublicApi();
    setApi(publicApi.value);
    setPublicApiError(publicApi.error ?? '');
    setRoles([]);
    setRolesError('');
    setRolesLoading(false);
    setAssignedRoleKeys(null);
    setOnlyCode(false);
    return () => {
      generationRef.current += 1;
    };
  }, [open, projectId, userId]);

  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    [],
  );

  async function loadRoles() {
    if (!open || !projectId) return;
    const generation = generationRef.current;
    const requestedProjectId = projectId;
    const isCurrentRequest = () =>
      generation === generationRef.current &&
      currentPropsRef.current.open &&
      currentPropsRef.current.projectId === requestedProjectId;
    setRolesLoading(true);
    setRolesError('');
    try {
      const [values, members] = await Promise.all([
        projectApi.roles(projectId),
        userId ? projectApi.members(projectId).catch(() => null) : Promise.resolve(null),
      ]);
      if (!isCurrentRequest()) return;
      const activeRoles = values.filter((value) => value.isActive !== false);
      setRoles(activeRoles);
      const ownMembership = members?.find((member) => member.id === userId);
      const assigned = ownMembership?.roles
        ? ownMembership.roles
            .map((value) => value.key)
            .filter((key) => activeRoles.some((value) => value.key === key))
        : null;
      setAssignedRoleKeys(assigned);
      if (assigned?.length === 1) setRole(assigned[0] ?? '');
    } catch (caught) {
      if (isCurrentRequest()) setRolesError(`读取项目角色失败：${formatApiError(caught)}`);
    } finally {
      if (isCurrentRequest()) setRolesLoading(false);
    }
  }

  useEffect(() => {
    void loadRoles();
    // Each open/project epoch owns its response, just like code issuance.
  }, [open, projectId, userId]);

  const parametersError = validateOnboardingParameters({ shell, host, role, root, api });
  const roleAllowed =
    roles.some((value) => value.key === role) &&
    (assignedRoleKeys === null || assignedRoleKeys.includes(role));
  const readyToIssue =
    onlyCode || (!parametersError && roleAllowed && !rolesLoading && !rolesError);

  const preview = buildOnboardingCommand({
    shell,
    host,
    role,
    root,
    api,
    code: issued?.code ?? '',
  });

  async function issue() {
    if (!projectId || busy || !readyToIssue) return;
    saveOnboardingPreferences({ shell, host });
    const requestedProjectId = projectId;
    const generation = generationRef.current;
    const isCurrentRequest = () =>
      generation === generationRef.current &&
      currentPropsRef.current.open &&
      currentPropsRef.current.projectId === requestedProjectId;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const view = await workspaceApi.issueEnrollment(requestedProjectId);
      if (!isCurrentRequest()) return;
      setIssued(view);
    } catch (caught) {
      if (!isCurrentRequest()) return;
      setIssued(null);
      setError(describeEnrollmentError(caught));
    } finally {
      if (isCurrentRequest()) setBusy(false);
    }
  }

  async function copy(kind: 'code' | 'command') {
    if (!issued || copyBusy) return;
    const value = kind === 'code' ? issued.code : preview.command;
    if (!value) return;
    const requestedProjectId = projectId;
    const generation = generationRef.current;
    const isCurrentRequest = () =>
      generation === generationRef.current &&
      currentPropsRef.current.open &&
      currentPropsRef.current.projectId === requestedProjectId;
    setCopyBusy(true);
    setNotice('');
    try {
      await navigator.clipboard.writeText(value);
      if (isCurrentRequest())
        setNotice(
          kind === 'code'
            ? '接入码已复制。请只通过受信渠道交给本机 CLI。'
            : '预览命令已复制。请在所选 Shell 中执行，核对预览计划后再追加 --apply。',
        );
    } catch {
      if (isCurrentRequest())
        setNotice(`复制失败，请手动选中${kind === 'code' ? '接入码' : '预览命令'}复制。`);
    } finally {
      if (isCurrentRequest()) setCopyBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="生成一次性接入码"
      description="先准备本机接入参数，再生成短时接入码；接入码会绑定当前已发布的工作区定义。"
      size="lg"
      // A pending issue can be abandoned locally; the generation guard below
      // prevents its late one-time plaintext response from repopulating state.
      // Keep the modal locked only while copying the already-issued code.
      busy={copyBusy}
      onClose={onClose}
      footer={
        issued ? (
          <>
            <button className="ghost" onClick={onClose} disabled={copyBusy}>
              关闭
            </button>
            <button className="ghost" onClick={() => void copy('code')} disabled={copyBusy}>
              {copyBusy ? '复制中…' : '复制接入码'}
            </button>
            <button
              className="primary"
              onClick={() => void copy('command')}
              disabled={copyBusy || !preview.command}
            >
              复制预览命令
            </button>
          </>
        ) : (
          <>
            <button className="ghost" onClick={onClose} disabled={copyBusy}>
              取消
            </button>
            <button
              className="primary"
              onClick={() => void issue()}
              disabled={busy || !projectId || !readyToIssue}
            >
              {busy ? '生成中…' : '生成接入码'}
            </button>
          </>
        )
      }
    >
      <div className="form-grid" aria-busy={busy || copyBusy}>
        {busy && <InlineLoading label="正在生成一次性接入码…" />}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <p className="modal-note">
          第一步：准备本机参数。选择终端和 Agent，填写业务代码根目录及管理员提供的 WorkMesh API
          地址。 API 地址可能与网页地址不同；不要填写业务系统的 API。
        </p>
        <label className="field">
          <span>Shell</span>
          <select
            value={shell}
            onChange={(event) => {
              setShell(event.target.value);
              setNotice('');
            }}
            disabled={copyBusy || busy}
          >
            <option value="">请选择 Shell</option>
            <option value="git-bash">Git Bash</option>
            <option value="powershell">PowerShell</option>
          </select>
        </label>
        <label className="field">
          <span>Agent 客户端</span>
          <select
            value={host}
            onChange={(event) => {
              setHost(event.target.value);
              setNotice('');
            }}
            disabled={copyBusy || busy}
          >
            <option value="">请选择 Agent 客户端</option>
            <option value="codex">Codex</option>
            <option value="claude-code">Claude Code</option>
          </select>
        </label>
        <label className="field">
          <span>项目角色</span>
          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setNotice('');
            }}
            disabled={copyBusy || busy || rolesLoading}
          >
            <option value="">
              {rolesLoading ? '正在读取项目角色…' : '请选择本次 Agent 的角色'}
            </option>
            {roles.map((value) => (
              <option
                key={value.id}
                value={value.key}
                disabled={assignedRoleKeys !== null && !assignedRoleKeys.includes(value.key)}
              >
                {value.title}（{value.key}）
              </option>
            ))}
          </select>
        </label>
        <p className="modal-note">
          {assignedRoleKeys === null
            ? '此处列出项目的活动业务角色，尚未确认你的角色分配；浏览器授权时仍会校验真实分配。'
            : assignedRoleKeys.length === 0
              ? '你尚未被分配活动业务角色，请联系项目管理员在成员管理中分配角色后重试。'
              : `你已分配的活动业务角色：${roles
                  .filter((value) => assignedRoleKeys.includes(value.key))
                  .map((value) => value.title)
                  .join('、')}。`}
          项目管理员身份与业务角色分别管理；选择角色或生成接入码不会增加权限。
        </p>
        {rolesError && (
          <div>
            <p className="modal-error" role="alert">
              {rolesError}
            </p>
            <button
              className="ghost"
              onClick={() => void loadRoles()}
              disabled={rolesLoading || copyBusy}
            >
              重新读取角色
            </button>
          </div>
        )}
        {!rolesLoading && !rolesError && roles.length === 0 && (
          <p className="modal-note">项目暂无活动角色，请联系项目管理员配置。</p>
        )}
        <label className="field">
          <span>本地工作区根目录</span>
          <input
            value={root}
            onChange={(event) => {
              setRoot(event.target.value);
              setNotice('');
            }}
            placeholder="例如 G:\projects\app 或 /g/projects/app"
            autoComplete="off"
            disabled={copyBusy || busy}
          />
        </label>
        <p className="modal-note">
          填写真实业务代码目录；命令会转换 Windows 盘符路径以适配所选 Shell。
        </p>
        <label className="field">
          <span>WorkMesh API 地址</span>
          <input
            value={api}
            onChange={(event) => {
              setApi(event.target.value);
              setNotice('');
            }}
            placeholder="https://workmesh.example.com/api/v1"
            type="url"
            autoComplete="off"
            disabled={copyBusy || busy}
          />
        </label>
        <p className="modal-note">
          {configuredPublicApi().value
            ? '地址由部署管理员通过公共 API 配置提供，可按管理员指引调整。'
            : '未配置公共 CLI API 地址，请向部署管理员确认完整地址；网页地址不会自动填入。'}
          仅记住 Shell 和 Agent 客户端；本地目录、角色、API 地址和接入码不会保存到浏览器偏好。
        </p>
        {publicApiError && (
          <p className="modal-error" role="alert">
            {publicApiError}
          </p>
        )}
        {!issued && (
          <>
            <p className="modal-note" role="status">
              {readyToIssue
                ? onlyCode
                  ? '将仅签发接入码，命令参数可在本机已有配置中提供。'
                  : '参数格式检查通过。生成后可复制预览命令；本地目录是否存在及 API 可达性由 CLI doctor 检查。'
                : parametersError || '请选择当前已分配的活动业务角色。'}
            </p>
            <label className="field-checkbox">
              <input
                type="checkbox"
                checked={onlyCode}
                disabled={busy}
                onChange={(event) => setOnlyCode(event.target.checked)}
              />
              我已有本机命令参数，仅生成接入码
            </label>
          </>
        )}
        {issued ? (
          <>
            <p className="kb-notice" role="status">
              接入码只显示这一次。关闭后无法再次查看，需要重新生成（旧码会作废）。
            </p>
            <label className="field">
              <span>一次性接入码</span>
              <input
                readOnly
                value={issued.code}
                aria-label="一次性接入码"
                className="cell-mono"
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            {preview.command ? (
              <label className="field">
                <span>CLI 预览命令</span>
                <textarea
                  readOnly
                  value={preview.command}
                  rows={4}
                  className="cell-mono"
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            ) : (
              <p className="modal-note">{preview.error}</p>
            )}
            <p className="modal-note">
              此单行命令仅预览，不消费接入码、不写入本机配置。核对计划后，在同一命令末尾追加{' '}
              <code>--apply</code>{' '}
              再执行，并在浏览器完成设备授权。接入完成后，在填写的工作区根目录运行{' '}
              <code>workmesh workspace status</code> 查看状态；有代码仓库时按 CLI 提示 discover /
              bind。 然后运行{' '}
              <code>
                workmesh setup --role {role || '<role>'} --host {host || '<host>'}
              </code>{' '}
              安装角色资源， 最后运行 <code>workmesh doctor --online</code>{' '}
              自检。有效的同平台、项目和角色凭据会复用。 接入中断时先查看 status / recover
              的实际状态；CLI 明确提示码已消费且未完成绑定时，再回此处生成新码。
            </p>
            <dl className="signoff-meta">
              <div>
                <dt>项目</dt>
                <dd className="cell-mono">{issued.projectId}</dd>
              </div>
              <div>
                <dt>绑定的已发布 revision</dt>
                <dd className="cell-mono">{issued.definitionRevisionId}</dd>
              </div>
              <div>
                <dt>定义摘要</dt>
                <dd className="cell-mono">{issued.definitionDigest}</dd>
              </div>
              <div>
                <dt>过期时间</dt>
                <dd>{formatDateTime(issued.expiresAt)}</dd>
              </div>
            </dl>
            {notice && (
              <p className="modal-note" role="status">
                {notice}
              </p>
            )}
            <p className="modal-note" role="note">
              接入码本身不授予成员、知识、仓库或 Agent 权限；CLI
              仍必须完成设备授权，服务端会按真实成员身份与 ACL 逐次校验。
            </p>
          </>
        ) : (
          <p className="modal-note">
            签发要求项目已发布工作区定义；不需要确认票据，但受服务端限流。重新生成会作废你此前未消费的接入码。
          </p>
        )}
      </div>
    </Modal>
  );
}
