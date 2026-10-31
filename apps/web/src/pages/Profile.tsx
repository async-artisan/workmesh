import { useAuthStore } from '../store/auth';
import { useEffect, useState } from 'react';
import { authApi } from '../api/auth';
import { useNavigate } from 'react-router-dom';
export function Profile() {
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const setAuth = useAuthStore((state) => state.setAuth);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  useEffect(() => {
    let objectUrl = '';
    if (accessToken) {
      void fetch('/api/auth/profile/avatar', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (blob) {
            objectUrl = URL.createObjectURL(blob);
            setAvatarUrl(objectUrl);
          }
        })
        .catch(() => undefined);
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accessToken]);
  async function saveProfile() {
    try {
      const updated = (await authApi.updateProfile({ name })) as unknown as typeof user;
      if (updated && accessToken && refreshToken) setAuth(updated, accessToken, refreshToken);
      setMessage('资料已保存');
    } catch {
      setMessage('资料保存失败');
    }
  }
  async function savePassword() {
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      clearAuth();
      navigate('/login', { replace: true });
    } catch {
      setMessage('密码更新失败，请检查当前密码和密码强度');
    }
  }
  async function uploadAvatar(file: File) {
    const form = new FormData();
    form.append('file', file);
    try {
      const token = useAuthStore.getState().accessToken;
      const response = await fetch('/api/auth/profile/avatar', {
        method: 'PATCH',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!response.ok) throw new Error('upload failed');
      const image = await fetch('/api/auth/profile/avatar', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (image.ok) setAvatarUrl(URL.createObjectURL(await image.blob()));
      setMessage('头像已更新');
    } catch {
      setMessage('头像上传失败，仅支持 2MB 以内 PNG、JPEG 或 WebP。');
    }
  }
  return (
    <>
      <header className="page-head">
        <div>
          <h2>用户中心</h2>
          <p className="page-sub">账号资料、头像与登录密码</p>
        </div>
      </header>
      <section className="page-card">
        <div className="profile-grid">
          <div>
            <small>头像</small>
            {avatarUrl ? (
              <img
                className="avatar"
                src={avatarUrl}
                alt="用户头像"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <span className="avatar avatar-fallback" aria-hidden="true">
                {(user?.name ?? 'U').slice(0, 1).toUpperCase()}
              </span>
            )}
            <label className="file-picker">
              更换头像
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadAvatar(file);
                }}
              />
            </label>
          </div>
          <div>
            <small>邮箱</small>
            <strong>{user?.email ?? '未登录'}</strong>
          </div>
          <div>
            <small>姓名</small>
            <strong>{user?.name ?? '未设置'}</strong>
          </div>
          <div>
            <small>角色</small>
            <strong>{user?.role ?? 'USER'}</strong>
          </div>
        </div>

        <div className="profile-form">
          <h3>基本资料</h3>
          <label>
            姓名
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={50} />
          </label>
          <div className="form-actions">
            <button className="primary" onClick={saveProfile}>
              保存资料
            </button>
          </div>
        </div>

        <div className="profile-form">
          <h3>修改密码</h3>
          <label>
            当前密码
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            新密码
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              autoComplete="new-password"
            />
            <small className="field-hint">至少 8 位，修改后需要重新登录。</small>
          </label>
          <div className="form-actions">
            <button className="ghost" onClick={savePassword} disabled={!currentPassword || !newPassword}>
              修改密码
            </button>
          </div>
          {message && <p className="muted">{message}</p>}
        </div>
      </section>
    </>
  );
}
