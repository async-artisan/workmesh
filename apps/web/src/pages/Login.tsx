import { FormEvent, useState } from 'react';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/auth';
import { useLocation, useNavigate } from 'react-router-dom';

export function Login() {
  const setAuth = useAuthStore((state) => state.setAuth);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await authApi.login({
        email: String(form.get('email')),
        password: String(form.get('password')),
      });
      setAuth(result.user, result.accessToken, result.refreshToken);
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登录失败');
    }
  }
  return (
    <section className="auth-card">
      <span className="eyebrow">REQFLOW ACCESS</span>
      <h1>登录工作台</h1>
      <form onSubmit={submit}>
        <label>
          邮箱
          <input name="email" type="email" required />
        </label>
        <label>
          密码
          <input name="password" type="password" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">
          登录
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
