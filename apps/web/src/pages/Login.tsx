import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authApi, bootstrapSession } from '../api/auth';
import { getCsrfToken } from '../api/client';
import { describeAccountError, type AccountErrorView } from '../lib/accountErrors';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const returningToInvite = Boolean(from?.startsWith('/invite/'));
  const [error, setError] = useState<AccountErrorView | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      // 登录前必须有匿名会话 cookie 与 CSRF；缺失时先做 bootstrap，不把任何凭据写进存储。
      if (!getCsrfToken()) await bootstrapSession();
      await authApi.login({
        email: String(form.get('email')),
        password: String(form.get('password')),
      });
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (caught) {
      setError(describeAccountError(caught, 'login'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card">
      <span className="eyebrow">账号登录</span>
      <h1>登录工作台</h1>
      {returningToInvite && (
        <p className="muted" role="status">
          登录成功后会回到原邀请页面，继续接受邀请。
        </p>
      )}
      <form onSubmit={submit}>
        <label>
          邮箱
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          密码
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <p className="muted">忘记密码？请联系项目管理员重置账号密码。</p>
        {error && (
          <div className="error" role="alert">
            <p>{error.message}</p>
            {error.detail && (
              <details className="wm-error-state__details">
                <summary className="wm-error-state__summary">查看详细信息</summary>
                <pre className="wm-error-state__detail">{error.detail}</pre>
              </details>
            )}
          </div>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </button>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            navigate('/register');
          }}
        >
          创建账号
        </button>
      </form>
    </section>
  );
}
