import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, formatApiError } from '../api/client';
import {
  projectApi,
  workspaceApi,
  type RoleView,
  type WorkspaceEnrollmentView,
} from '../api/resources';
import { formatDateTime } from '../lib/datetime';
import { buildOnboardingCommand } from '../lib/onboarding-command';
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
    setShell('');
    setHost('');
    setRole('');
    setRoot('');
    setApi('');
    setRoles([]);
    setRolesError('');
    setRolesLoading(false);
    return () => {
      generationRef.current += 1;
    };
  }, [open, projectId]);

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
      const values = await projectApi.roles(projectId);
      if (!isCurrentRequest()) return;
      setRoles(values.filter((value) => value.isActive !== false));
    } catch (caught) {
      if (isCurrentRequest()) setRolesError(`读取项目角色失败：${formatApiError(caught)}`);
    } finally {
      if (isCurrentRequest()) setRolesLoading(false);
    }
  }

  useEffect(() => {
    void loadRoles();
    // Each open/project epoch owns its response, just like code issuance.
  }, [open, projectId]);

  const preview = buildOnboardingCommand({
    shell,
    host,
    role,
    root,
    api,
    code: issued?.code ?? '',
  });

  async function issue() {
    if (!projectId) return;
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
      description="接入码用于本机 workspace init --join 解析项目与签发时的已发布 revision。"
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
            <button className="primary" onClick={() => void issue()} disabled={busy || !projectId}>
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
            <p className="modal-note">
              选择本机终端和 Agent，填写业务代码根目录及管理员提供的 WorkMesh API 地址。 API
              地址可能与网页地址不同；不要填写业务系统的 API。
            </p>
            <label className="field">
              <span>Shell</span>
              <select
                value={shell}
                onChange={(event) => {
                  setShell(event.target.value);
                  setNotice('');
                }}
                disabled={copyBusy}
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
                disabled={copyBusy}
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
                disabled={copyBusy || rolesLoading}
              >
                <option value="">
                  {rolesLoading ? '正在读取项目角色…' : '请选择本次 Agent 的角色'}
                </option>
                {roles.map((value) => (
                  <option key={value.id} value={value.key}>
                    {value.title}（{value.key}）
                  </option>
                ))}
              </select>
            </label>
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
                disabled={copyBusy}
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
                disabled={copyBusy}
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
              <code>workmesh workspace status</code> 查看状态。
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
