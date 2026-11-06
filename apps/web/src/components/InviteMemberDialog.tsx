import { useEffect, useMemo, useState } from 'react';
import type { ActionBindingInput } from '../api/auth';
import { invitationApi, type CreatedInvitationView, type RoleView } from '../api/resources';
import { ConfirmationPrompt } from './ConfirmationPrompt';
import { Modal } from './Modal';
import { InlineLoading } from './Skeleton';

export interface InviteMemberDialogProps {
  open: boolean;
  projectId: string | null;
  projectVersion: number | null;
  roles: RoleView[];
  /** 角色还在页面层加载：弹窗先给加载态，不能显示成「项目还没有业务角色」。 */
  rolesLoading?: boolean;
  onClose: () => void;
}

const DEFAULT_HOURS = 72;

function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

/**
 * 生成邀请链接：角色 + 可选邮箱 + 有效期先预览，再用一次性票据创建。
 * 明文链接只在创建成功那一次显示；服务端不再保存 token 明文。
 */
export function InviteMemberDialog({
  open,
  projectId,
  projectVersion,
  roles,
  rolesLoading = false,
  onClose,
}: InviteMemberDialogProps) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [promptOpen, setPromptOpen] = useState(false);
  const [created, setCreated] = useState<CreatedInvitationView | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelectedKeys([]);
    setEmail('');
    setHours(DEFAULT_HOURS);
    setPromptOpen(false);
    setCreated(null);
    setError('');
  }, [open]);

  const activeRoles = roles.filter((role) => role.isActive !== false);

  const binding = useMemo<ActionBindingInput | null>(() => {
    if (!projectId || projectVersion === null) return null;
    const roleIds = activeRoles
      .filter((role) => selectedKeys.includes(role.key))
      .map((role) => role.id)
      .sort();
    if (roleIds.length === 0) return null;
    return {
      action: 'PROJECT_INVITATION_CREATE',
      projectId,
      targetType: 'PROJECT_INVITATION',
      targetId: projectId,
      expectedVersion: projectVersion,
      roleSlot: null,
      payload: { roleIds, email: normalizeEmail(email), expiresInHours: hours },
    };
  }, [activeRoles, email, hours, projectId, projectVersion, selectedKeys]);

  const link = created?.token ? invitationUrl(window.location.origin, created.token) : '';

  async function create(confirmation: { ticketId: string; ticketSecret: string }) {
    if (!projectId || !binding) throw new Error('缺少项目或角色');
    const result = await invitationApi.create(projectId, {
      roleKeys: [...selectedKeys].sort(),
      ...(normalizeEmail(email) ? { email: normalizeEmail(email) as string } : {}),
      expiresInHours: hours,
      expectedVersion: binding.expectedVersion,
      confirmation,
    });
    setCreated(result);
    if (!result.token)
      setError('这条邀请之前已生成过，明文链接不会重复返回；请关闭后重新生成一条。');
  }

  async function copyLink() {
    if (!link || copyBusy) return;
    setCopyBusy(true);
    try {
      await navigator.clipboard.writeText(link);
      setError('');
    } catch {
      setError('复制失败，请手动选中链接复制。');
    } finally {
      setCopyBusy(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        title="邀请成员"
        description="生成一条带角色的限时链接，对方点开设置密码即加入项目。"
        size="md"
        onClose={onClose}
        footer={
          created ? (
            <>
              <button className="ghost" onClick={onClose}>
                关闭
              </button>
              <button className="primary" onClick={() => void copyLink()} disabled={copyBusy}>
                {copyBusy ? '复制中…' : '复制链接'}
              </button>
            </>
          ) : (
            <>
              {!binding && (
                <p className="modal-foot-note" aria-live="polite">
                  {rolesLoading
                    ? '正在读取业务角色…'
                    : activeRoles.length === 0
                      ? '项目还没有可用的业务角色，先创建角色后才能生成邀请链接。'
                      : '至少选择一个业务角色后才能生成邀请链接。'}
                </p>
              )}
              <button className="ghost" onClick={onClose}>
                取消
              </button>
              <button className="primary" disabled={!binding} onClick={() => setPromptOpen(true)}>
                生成邀请链接
              </button>
            </>
          )
        }
      >
        {created ? (
          <div className="form-grid">
            <p className="muted">
              这条链接只显示一次，有效期至 {new Date(created.expiresAt).toLocaleString()}。
            </p>
            <label className="field">
              <span>邀请链接</span>
              <input value={link || created.token || ''} readOnly aria-label="邀请链接" />
            </label>
            <p className="modal-note">
              对方打开链接后：填写姓名与密码 → 自动成为项目成员并带上角色；已有账号则先登录再接受。
            </p>
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="form-grid">
            <div className="field">
              <span>授予的业务角色</span>
              <div className="role-chips">
                {rolesLoading && <InlineLoading label="正在读取业务角色…" />}
                {!rolesLoading &&
                  activeRoles.map((role) => {
                    const checked = selectedKeys.includes(role.key);
                    return (
                      <label key={role.key} className={`chip${checked ? ' is-active' : ''}`}>
                        <input
                          type="checkbox"
                          aria-label={`邀请角色 ${role.key}`}
                          checked={checked}
                          onChange={(event) =>
                            setSelectedKeys((current) =>
                              event.target.checked
                                ? [...new Set([...current, role.key])]
                                : current.filter((key) => key !== role.key),
                            )
                          }
                        />
                        {role.title}
                      </label>
                    );
                  })}
                {!rolesLoading && activeRoles.length === 0 && (
                  <span className="muted">项目还没有业务角色。</span>
                )}
              </div>
            </div>

            <label className="field">
              <span>限定邮箱（可选）</span>
              <input
                value={email}
                placeholder="留空表示持链接者皆可接受"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="field">
              <span>有效期（小时）</span>
              <input
                type="number"
                min={1}
                max={336}
                value={hours}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setHours(Number.isFinite(next) ? next : DEFAULT_HOURS);
                }}
              />
            </label>

            <p className="modal-note">
              生成邀请会绑定“项目 + 角色 + 邮箱 + 有效期”的一次性票据；下次创建请重新预览。
            </p>
          </div>
        )}
      </Modal>

      <ConfirmationPrompt
        open={promptOpen && Boolean(binding)}
        title="确认生成邀请链接"
        description={
          binding
            ? `项目 ${projectId ?? ''} · 角色 ${selectedKeys.join('、')} · 有效期 ${hours} 小时`
            : ''
        }
        binding={binding}
        submitLabel="生成链接"
        busyLabel="邀请中…"
        onClose={() => setPromptOpen(false)}
        onConfirmed={create}
      />
    </>
  );
}

/** 供测试与页面复用的链接拼装。 */
export function invitationUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/invite/${token}`;
}
