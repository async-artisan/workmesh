import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getCsrfToken } from '../api/client';
import { bootstrapSession } from '../api/auth';
import { invitationApi, type InvitationView } from '../api/resources';
import { useAuthStore } from '../store/auth';
import {
  describeAccountError,
  isEmailAlreadyRegistered,
  type AccountErrorView,
} from '../lib/accountErrors';

function inputError(message: string): AccountErrorView {
  return { kind: 'invalid-input', message };
}

/**
 * 邀请接受页：公开路由，不需要登录。
 * 未登录且邮箱未被占用：填姓名 + 密码即建号并加入项目；
 * 邮箱已有账号：引导先登录，再回到本页接受（登录后走 join）。
 */
export function Invite({ token: tokenProp }: { token?: string } = {}) {
  const { token: routeToken = '' } = useParams<{ token: string }>();
  const token = tokenProp ?? routeToken;
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const [view, setView] = useState<InvitationView | null>(null);
  const [joined, setJoined] = useState<{ projectId: string; roleKeys: string[] } | null>(null);
  const [error, setError] = useState<AccountErrorView | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    // 先建立匿名会话拿 CSRF；已登录时也不会清掉现有会话。
    bootstrapSession()
      .catch(() => undefined)
      .then(() => invitationApi.resolve(token))
      .then((value) => {
        if (alive) setView(value);
      })
      .catch((caught: unknown) => {
        if (alive) setError(describeAccountError(caught, 'invite'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  async function joinAsCurrentUser() {
    setError(null);
    setNeedsLogin(false);
    if (!getCsrfToken()) await bootstrapSession();
    const result = await invitationApi.join(token);
    await bootstrapSession();
    setJoined({ projectId: result.projectId, roleKeys: result.roleKeys });
  }

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const password = String(form.get('password') ?? '');

    if (password.length < 8 || password.length > 200) {
      setError(inputError('密码长度必须为 8–200 个字符。'));
      return;
    }
    if (name.length > 80) {
      setError(inputError('姓名长度不能超过 80 个字符。'));
      return;
    }

    setBusy(true);
    setError(null);
    setNeedsLogin(false);
    try {
      if (!getCsrfToken()) await bootstrapSession();
      const result = await invitationApi.accept(token, {
        password,
        ...(name ? { name } : {}),
        // 邀请没绑定邮箱时由接受人填写；绑定了就由服务端决定，前端不再传。
        ...(view?.email ? {} : { email: String(form.get('email') || '').trim() }),
      });
      await bootstrapSession();
      setJoined({ projectId: result.invitation.projectId, roleKeys: result.invitation.roleKeys });
    } catch (caught) {
      setError(describeAccountError(caught, 'invite'));
      setNeedsLogin(isEmailAlreadyRegistered(caught));
    } finally {
      setBusy(false);
    }
  }

  function goLogin() {
    navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
  }

  function renderError() {
    if (!error) return null;
    return (
      <div className="error" role="alert">
        <p>{error.message}</p>
        {error.detail && (
          <details className="wm-error-state__details">
            <summary className="wm-error-state__summary">查看详细信息</summary>
            <pre className="wm-error-state__detail">{error.detail}</pre>
          </details>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <section className="auth-card">
        <p className="muted">正在读取邀请…</p>
      </section>
    );
  }

  if (!view) {
    return (
      <section className="auth-card">
        <span className="eyebrow">邀请链接</span>
        <h1>邀请不可用</h1>
        {error ? (
          renderError()
        ) : (
          <p className="error" role="alert">
            链接无效或已失效。
          </p>
        )}
        <button className="ghost" type="button" onClick={goLogin}>
          去登录
        </button>
      </section>
    );
  }

  if (joined) {
    return (
      <section className="auth-card">
        <span className="eyebrow">邀请已接受</span>
        <h1>已加入「{view.project.name}」</h1>
        <p className="muted">
          角色：{joined.roleKeys.join('、') || '（无）'}。工作台已经可以打开。
        </p>
        <p className="muted">
          如需让本地 Agent 参与项目，请进入项目接入页生成一次性接入码，选择角色、终端和本地目录，
          再复制 workspace init --join 预览命令。邀请链接用于加入项目，接入码用于本机绑定； Agent
          仍需在浏览器完成设备授权。
        </p>
        <button
          className="ghost"
          type="button"
          onClick={() => navigate(`/workspace?projectId=${encodeURIComponent(joined.projectId)}`)}
        >
          配置本地 Agent 接入
        </button>
        <button className="primary" type="button" onClick={() => navigate('/', { replace: true })}>
          进入工作台
        </button>
      </section>
    );
  }

  if (view.status !== 'PENDING') {
    const text =
      view.status === 'ACCEPTED'
        ? '这个邀请已经被接受过了。'
        : view.status === 'EXPIRED'
          ? '这个邀请已经过期，请联系管理员重新生成。'
          : '这个邀请已被撤回。';
    return (
      <section className="auth-card">
        <span className="eyebrow">邀请链接</span>
        <h1>{view.project.name}</h1>
        <p className="muted">{text}</p>
        <button className="primary" type="button" onClick={() => navigate('/', { replace: true })}>
          进入工作台
        </button>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <span className="eyebrow">邀请链接</span>
      <h1>加入「{view.project.name}」</h1>
      <p className="muted">
        项目编号 {view.project.key} · 角色：
        {view.roles.map((role) => role.title).join('、') || '—'} · 邀请有效期至{' '}
        {new Date(view.expiresAt).toLocaleString()}
      </p>
      <p className="muted">邀请状态：待接受</p>

      {user ? (
        <>
          <p className="muted">你已登录为 {user.email}，直接加入即可。</p>
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              joinAsCurrentUser()
                .catch((caught: unknown) => {
                  setError(describeAccountError(caught, 'invite'));
                })
                .finally(() => setBusy(false));
            }}
          >
            {busy ? '加入中…' : '接受邀请'}
          </button>
          {renderError()}
        </>
      ) : (
        <form onSubmit={accept}>
          <label>
            姓名（可选）
            <input name="name" autoComplete="name" maxLength={80} />
          </label>
          {view.email ? (
            <label>
              邮箱
              <input value={view.email} readOnly />
            </label>
          ) : (
            <label>
              邮箱
              <input name="email" type="email" required autoComplete="email" />
            </label>
          )}
          <label>
            设置密码
            <input
              name="password"
              type="password"
              minLength={8}
              maxLength={200}
              required
              autoComplete="new-password"
              aria-describedby="invite-password-hint"
            />
          </label>
          <p className="muted" id="invite-password-hint">
            密码长度必须为 8–200 个字符。
          </p>
          {renderError()}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? '加入中…' : '创建账号并加入'}
          </button>
          {needsLogin && (
            <button className="ghost" type="button" onClick={goLogin}>
              先登录再接受
            </button>
          )}
        </form>
      )}
    </section>
  );
}
