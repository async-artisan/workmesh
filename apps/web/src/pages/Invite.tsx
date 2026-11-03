import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, formatApiError, getCsrfToken } from '../api/client';
import { bootstrapSession } from '../api/auth';
import { invitationApi, type InvitationView } from '../api/resources';
import { useAuthStore } from '../store/auth';

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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    // 先建立匿名会话拿 CSRF；已登录时也不会清掉现有会话。
    bootstrapSession()
      .catch(() => undefined)
      .then(() => invitationApi.resolve(token))
      .then((value) => {
        if (alive) setView(value);
      })
      .catch((caught: unknown) => {
        if (alive) setError(formatApiError(caught));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  async function joinAsCurrentUser() {
    if (!getCsrfToken()) await bootstrapSession();
    const result = await invitationApi.join(token);
    await bootstrapSession();
    setJoined({ projectId: result.projectId, roleKeys: result.roleKeys });
  }

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!getCsrfToken()) await bootstrapSession();
      const name = String(form.get('name') || '').trim();
      const result = await invitationApi.accept(token, {
        password: String(form.get('password')),
        ...(name ? { name } : {}),
        // 邀请没绑定邮箱时由接受人填写；绑定了就由服务端决定，前端不再传。
        ...(view?.email ? {} : { email: String(form.get('email') || '').trim() }),
      });
      await bootstrapSession();
      setJoined({ projectId: result.invitation.projectId, roleKeys: result.invitation.roleKeys });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'EMAIL_ALREADY_REGISTERED') {
        setError('这个邮箱已经有账号，请先登录再接受邀请。');
        setNotice('login');
      } else {
        setError(formatApiError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  function goLogin() {
    navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
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
        <span className="eyebrow">WORKMESH INVITATION</span>
        <h1>邀请不可用</h1>
        <p className="error" role="alert">
          {error || '链接无效或已失效。'}
        </p>
        <button className="ghost" type="button" onClick={goLogin}>
          去登录
        </button>
      </section>
    );
  }

  if (joined) {
    const role = joined.roleKeys[0] ?? 'product';
    const setupCommand = `workmesh setup --role ${role} --api ${window.location.origin}/api/v1 --project ${joined.projectId}`;
    return (
      <section className="auth-card">
        <span className="eyebrow">WORKMESH ONBOARDED</span>
        <h1>已加入「{view.project.name}」</h1>
        <p className="muted">
          角色：{joined.roleKeys.join('、') || '（无）'}。工作台已经可以打开。
        </p>
        <label>
          如果你要用本地 Agent 干活，先在服务器 /download 取 CLI，再运行：
          <input value={setupCommand} readOnly aria-label="CLI 初始化命令" />
        </label>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            navigator.clipboard
              .writeText(setupCommand)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? '已复制' : '复制命令'}
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
        <span className="eyebrow">WORKMESH INVITATION</span>
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
      <span className="eyebrow">WORKMESH INVITATION</span>
      <h1>加入「{view.project.name}」</h1>
      <p className="muted">
        项目编号 {view.project.key} · 角色：{view.roles.map((role) => role.title).join('、') || '—'}{' '}
        · 邀请有效期至 {new Date(view.expiresAt).toLocaleString()}
      </p>

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
                .catch((caught: unknown) => setError(formatApiError(caught)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? '加入中…' : '接受邀请'}
          </button>
        </>
      ) : (
        <form onSubmit={accept}>
          <label>
            姓名
            <input name="name" autoComplete="name" />
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
              required
              autoComplete="new-password"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? '加入中…' : '创建账号并加入'}
          </button>
          {notice === 'login' && (
            <button className="ghost" type="button" onClick={goLogin}>
              先登录再接受
            </button>
          )}
          {notice !== 'login' && notice && <p className="muted">{notice}</p>}
        </form>
      )}

      {user && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
