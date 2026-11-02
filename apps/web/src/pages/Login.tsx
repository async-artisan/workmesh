import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authApi, bootstrapSession } from '../api/auth';
import { formatApiError, getCsrfToken } from '../api/client';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      // 登录前必须有匿名会话 cookie 与 CSRF；缺失时先做 bootstrap，不把任何凭据写进存储。
      if (!getCsrfToken()) await bootstrapSession();
      await authApi.login({
        email: String(form.get('email')),
        password: String(form.get('password')),
      });
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card">
      <span className="eyebrow">WORKMESH ACCESS</span>
      <h1>登录工作台</h1>
      <form onSubmit={submit}>
        <label>
          邮箱
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          密码
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
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
