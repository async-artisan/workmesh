import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, bootstrapSession } from '../api/auth';
import { formatApiError, getCsrfToken } from '../api/client';

export function Register() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (!getCsrfToken()) await bootstrapSession();
      const name = String(form.get('name') || '').trim();
      await authApi.register({
        email: String(form.get('email')),
        password: String(form.get('password')),
        // 空姓名不提交，避免触发服务端 1–80 长度校验。
        ...(name ? { name } : {}),
      });
      navigate('/', { replace: true });
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card">
      <span className="eyebrow">WORKMESH ONBOARDING</span>
      <h1>创建工作区</h1>
      <form onSubmit={submit}>
        <label>
          姓名
          <input name="name" autoComplete="name" />
        </label>
        <label>
          邮箱
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          密码
          <input name="password" type="password" minLength={8} required autoComplete="new-password" />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? '注册中…' : '注册'}
        </button>
      </form>
    </section>
  );
}
