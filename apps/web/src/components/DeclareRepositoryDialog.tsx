import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActionBindingInput } from '../api/auth';
import { ApiError, formatApiError } from '../api/client';
import { workspaceApi, type Confirmation, type RepositoryDeclarationView } from '../api/resources';
import { ConfirmationPrompt } from './ConfirmationPrompt';
import { Modal } from './Modal';
import { InlineLoading } from './Skeleton';

export interface DeclareRepositoryDialogProps {
  open: boolean;
  projectId: string | null;
  /** 项目共享配置版本：仓库声明用 `Project.version` 做 CAS（§13.4）。 */
  projectVersion: number | null;
  onClose: () => void;
  /** 声明成功后由页面刷新仓库列表与定义状态。 */
  onDeclared: (result: RepositoryDeclarationView) => void | Promise<void>;
}

export const REPOSITORY_DECLARE_ACTION = 'REPOSITORY_DECLARE';

function hasCode(error: ApiError, code: string): boolean {
  // 部分服务端实现把机器码放在 message 里；两种位置都识别，避免只显示冷冰冰的 HTTP 文案。
  return error.code === code || error.message === code;
}

function stringDetail(error: ApiError, key: string): string {
  const value = error.details?.[key];
  return typeof value === 'string' ? value : '';
}

/**
 * 把仓库声明的 409/422/403 翻译成用户能执行的下一步。
 * 不猜测服务端未承诺的行为：冲突只说明“已发生什么 + 需要谁做什么”。
 */
export function describeDeclarationError(error: unknown): string {
  if (!(error instanceof ApiError)) return formatApiError(error);

  if (hasCode(error, 'LOCATOR_ALREADY_BOUND')) {
    const bound = stringDetail(error, 'boundRepositoryId');
    const canonical = stringDetail(error, 'canonicalLocator');
    return [
      `该来源已绑定到另一条仓库记录${bound ? `（仓库 ${bound}）` : ''}，服务端不会自动改写。`,
      canonical ? `规范化 locator：${canonical}` : '',
      '需要项目 OWNER/ADMIN 先显式撤销/改绑该 locator，或发起可审计的合并后再声明。',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (hasCode(error, 'LOCATOR_INVALID')) {
    return '仓库地址无法解析。支持 https://host/path、ssh://[user@]host/path 或 git@host:path；请检查后重试。';
  }
  if (hasCode(error, 'PROJECT_VERSION_CONFLICT')) {
    return '项目版本已变化（可能有人同时声明/归档了仓库或发布了定义）。请刷新后重试；旧版本不会被接受。';
  }
  if (hasCode(error, 'PROJECT_ARCHIVED')) {
    return '项目已归档，不能再声明代码仓库。';
  }
  if (hasCode(error, 'PROJECT_MANAGER_REQUIRED') || error.status === 403) {
    return '需要项目 OWNER/ADMIN 权限才能声明仓库。';
  }
  if (hasCode(error, 'CONFIRMATION_USED')) {
    return '确认票据已被使用：同一票据不能重复提交，请重新点击声明并再次验证密码。';
  }
  if (hasCode(error, 'CONFIRMATION_EXPIRED') || hasCode(error, 'CONFIRMATION_INVALID')) {
    return '确认票据已失效：请重新点击声明，重新完成密码验证后重试。';
  }
  if (hasCode(error, 'IDEMPOTENCY_DIGEST_CONFLICT') || hasCode(error, 'IDEMPOTENCY_CONFLICT')) {
    return '本次提交与同一幂等键的首次请求内容不同，服务端已拒绝。请关闭后重新声明（会自动使用新的幂等键）。';
  }
  if (error.status === 429) {
    return error.retryAfterSeconds !== null
      ? `请求过于频繁，请在 ${error.retryAfterSeconds} 秒后重试。`
      : '请求过于频繁，请稍后重试。';
  }
  return formatApiError(error);
}

/**
 * 声明仓库（DECLARED）：只提交受控 locator，不提交伪造的 provider 外部 ID，
 * 也不把 owner/name 当作身份。声明必须带一次性确认票据 + 幂等键。
 */
export function DeclareRepositoryDialog({
  open,
  projectId,
  ...props
}: DeclareRepositoryDialogProps) {
  // 每次关闭或切换项目都卸载整个会话，包括密码与尚在途的确认票据。
  if (!open || !projectId) return null;
  return <DeclarationSession key={projectId} open projectId={projectId} {...props} />;
}

function DeclarationSession({
  open,
  projectId,
  projectVersion,
  onClose,
  onDeclared,
}: DeclareRepositoryDialogProps) {
  const [locator, setLocator] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RepositoryDeclarationView | null>(null);
  const activeRef = useRef(true);
  const promptGenerationRef = useRef(0);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      promptGenerationRef.current += 1;
    };
  }, []);

  const trimmedLocator = locator.trim();
  const trimmedDisplayName = displayName.trim();
  const promptGeneration = promptGenerationRef.current;

  /** 票据绑定与真正提交的业务字段必须一致，否则服务端会判定动作已变化。 */
  const binding = useMemo<ActionBindingInput | null>(() => {
    if (!projectId || projectVersion === null || !trimmedLocator) return null;
    return {
      action: REPOSITORY_DECLARE_ACTION,
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      expectedVersion: projectVersion,
      roleSlot: null,
      payload: {
        locator: trimmedLocator,
        targetRepositoryId: null,
        displayName: trimmedDisplayName ? trimmedDisplayName : null,
      },
    };
  }, [projectId, projectVersion, trimmedDisplayName, trimmedLocator]);

  async function declare(confirmation: Confirmation) {
    if (!projectId || !binding) {
      setError('缺少项目版本，无法声明仓库；请刷新页面后重试。');
      return;
    }
    // 先关闭确认框：请求失败时把可恢复原因留在本对话框里，而不是卡在票据弹窗。
    promptGenerationRef.current += 1;
    setPromptOpen(false);
    setBusy(true);
    setError('');
    try {
      const declared = await workspaceApi.declareRepository(projectId, {
        expectedProjectVersion: binding.expectedVersion,
        locator: String(binding.payload.locator),
        targetRepositoryId: null,
        displayName: (binding.payload.displayName as string | null) ?? null,
        confirmation,
      });
      if (!activeRef.current) return;
      setResult(declared);
      await onDeclared(declared);
    } catch (caught) {
      if (activeRef.current) setError(describeDeclarationError(caught));
    } finally {
      if (activeRef.current) setBusy(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        title="声明代码仓库"
        description="登记项目受控的仓库来源（DECLARED）。声明会被审计，但不代表托管方已核验身份。"
        size="md"
        busy={busy}
        onClose={onClose}
        footer={
          result ? (
            <button className="primary" onClick={onClose}>
              关闭
            </button>
          ) : (
            <>
              <button className="ghost" onClick={onClose} disabled={busy}>
                取消
              </button>
              <button
                className="primary"
                onClick={() => {
                  promptGenerationRef.current += 1;
                  setPromptOpen(true);
                }}
                disabled={!binding || busy}
              >
                {busy ? '声明中…' : '继续（需要二次验证）'}
              </button>
            </>
          )
        }
      >
        {result ? (
          <div className="form-grid">
            <p className="kb-notice" role="status">
              仓库已声明（{result.identityMode}）：{result.owner}/{result.name}。
            </p>
            <dl className="signoff-meta">
              <div>
                <dt>规范化 locator</dt>
                <dd className="cell-mono">{result.canonicalLocator}</dd>
              </div>
              <div>
                <dt>来源类型</dt>
                <dd>{result.source}</dd>
              </div>
              <div>
                <dt>项目版本</dt>
                <dd>v{result.projectVersion}</dd>
              </div>
            </dl>
            {result.reused && (
              <p className="modal-note">
                服务端按同一 canonical locator 复用了已有仓库，没有创建第二条身份。
              </p>
            )}
            {result.replayed && (
              <p className="modal-note">本次是同一幂等键的重放，返回首次成功结果。</p>
            )}
            {result.alias && <p className="modal-note">已作为该仓库的额外来源别名登记。</p>}
            <p className="modal-note" role="note">
              {result.identityMode === 'PROVIDER'
                ? '该仓库保留已有的 PROVIDER 身份；本次声明操作没有执行托管方核验。'
                : '身份状态为“人工声明”：未由托管方核验。本次操作不会显示为“已验证”。'}
            </p>
          </div>
        ) : (
          <div className="form-grid" aria-busy={busy}>
            {busy && <InlineLoading label="正在声明仓库，等待服务端校验项目版本与票据…" />}
            <label className="field">
              <span>仓库地址</span>
              <input
                value={locator}
                onChange={(event) => {
                  setLocator(event.target.value);
                  setError('');
                }}
                placeholder="https://github.com/owner/name 或 git@host:owner/name.git"
                aria-label="仓库地址"
                autoComplete="off"
                disabled={busy}
              />
              <small>
                接受 HTTPS、ssh:// 或 git@host:path；凭据会被去除。HTTPS 与 SSH 形式不会被自动等价，
                需要额外别名时须由有权限的人显式声明。
              </small>
            </label>
            <label className="field">
              <span>展示名（可选）</span>
              <input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setError('');
                }}
                placeholder="仅用于展示，不参与身份判定"
                aria-label="展示名（可选）"
                disabled={busy}
              />
            </label>
            {projectVersion === null && (
              <p className="modal-note">项目版本尚未读取，暂时不能声明；请刷新页面。</p>
            )}
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
            <p className="modal-note">
              提交后会签发一次性票据并校验项目版本；内容、版本或票据任一不一致都会被服务端拒绝。
            </p>
          </div>
        )}
      </Modal>

      {open && promptOpen && binding && (
        <ConfirmationPrompt
          open={open && promptOpen}
          title="声明代码仓库"
          description={
            binding
              ? `将把 ${String(binding.payload.locator)} 声明为项目 ${projectId ?? ''} 的受控仓库来源。`
              : ''
          }
          binding={binding}
          submitLabel="确认声明仓库"
          impact={[
            '新仓库以 DECLARED 身份加入项目；复用已有仓库时保留其原有身份。',
            '声明不代表托管方已核验身份，也不会自动写入 provider 外部 ID。',
            '同一 canonical locator 会复用已有仓库；已绑定到另一仓库时必须显式处理。',
          ]}
          onClose={() => {
            if (!activeRef.current || promptGeneration !== promptGenerationRef.current) return;
            promptGenerationRef.current += 1;
            setPromptOpen(false);
          }}
          onConfirmed={declare}
        />
      )}
    </>
  );
}
