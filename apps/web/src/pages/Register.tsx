import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, bootstrapSession } from '../api/auth';
import { getCsrfToken } from '../api/client';
import { describeAccountError, type AccountErrorView } from '../lib/accountErrors';

function inputError(message: string): AccountErrorView {
  return { kind: 'invalid-input', message };
}

export function Register() {
  const navigate = useNavigate();
  const [error, setError] = useState<AccountErrorView | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');
    const name = String(form.get('name') ?? '').trim();

    // 服务端规则：密码 8–200 个字符；姓名可选，非空时 1–80 个字符。
    if (password.length < 8 || password.length > 200) {
      setError(inputError('密码长度必须为 8–200 个字符。'));
      return;
    }
    if (password !== confirmPassword) {
      setError(inputError('两次输入的密码不一致，请重新输入。'));
      return;
    }
    if (name.length > 80) {
      setError(inputError('姓名长度不能超过 80 个字符。'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (!getCsrfToken()) await bootstrapSession();
      await authApi.register({
        email,
        password,
        // 空姓名不提交，避免触发服务端 1–80 长度校验。
        ...(name ? { name } : {}),
      });
      navigate('/', { replace: true });
    } catch (caught) {
      setError(describeAccountError(caught, 'register'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card">
      <span className="eyebrow">账号创建</span>
      <h1>创建账号</h1>
      <p className="page-sub">注册后可以创建项目，或通过邀请加入已有项目。</p>
      <form onSubmit={submit}>
        <label>
          姓名（可选）
          <input name="name" autoComplete="name" maxLength={80} />
        </label>
        <label>
          邮箱
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            minLength={8}
            maxLength={200}
            required
            autoComplete="new-password"
            aria-describedby="register-password-hint"
          />
        </label>
        <p className="muted" id="register-password-hint">
          密码长度必须为 8–200 个字符。
        </p>
        <label>
          确认密码
          <input
            name="confirmPassword"
            type="password"
            minLength={8}
            maxLength={200}
            required
            autoComplete="new-password"
          />
        </label>
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
          {busy ? '注册中…' : '注册'}
        </button>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            navigate('/login');
          }}
        >
          已有账号？登录
        </button>
      </form>
    </section>
  );
}
