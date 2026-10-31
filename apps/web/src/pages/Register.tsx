import { FormEvent, useState } from 'react';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/auth';
import { useNavigate } from 'react-router-dom';

export function Register() {
  const setAuth = useAuthStore((state) => state.setAuth);
  const navigate = useNavigate();
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await authApi.register({
        email: String(form.get('email')),
        password: String(form.get('password')),
        name: String(form.get('name') || ''),
      });
      setAuth(result.user, result.accessToken, result.refreshToken);
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '注册失败');
    }
  }
  return (
    <section className="auth-card">
      <span className="eyebrow">REQFLOW ONBOARDING</span>
      <h1>创建工作区</h1>
      <form onSubmit={submit}>
        <label>
          姓名
          <input name="name" />
        </label>
        <label>
          邮箱
          <input name="email" type="email" required />
        </label>
        <label>
          密码
          <input name="password" type="password" minLength={8} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">
          注册
        </button>
      </form>
    </section>
  );
}
