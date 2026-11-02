import { useEffect, useState } from 'react';
import { formatApiError } from '../api/client';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/auth';

interface CredentialView {
  id: string;
  name: string;
  projectId: string;
  roleId: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
}

/**
 * 用户中心只展示 cookie 会话账号与 Agent 凭据列表。
 * 撤销凭据直接调用 v1 路由；页面不保存任何 token 或密钥。
 */
export function Profile() {
  const user = useAuthStore((state) => state.user);
  const [credentials, setCredentials] = useState<CredentialView[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      setCredentials(await authApi.credentials());
      setError('');
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(id: string) {
    try {
      await authApi.revokeCredential(id);
      setNotice('凭据已撤销，立即失效。');
      setError('');
      await load();
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>用户中心</h2>
          <p className="page-sub">当前会话来自 HttpOnly Cookie；凭据列表只展示元数据。</p>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="kb-notice">{notice}</p>}

      <div className="page-card">
        <div className="profile-grid">
          <div>
            <small>邮箱</small>
            <strong>{user?.email ?? '未登录'}</strong>
          </div>
          <div>
            <small>用户 ID</small>
            <span className="cell-mono">{user?.id ?? '—'}</span>
          </div>
        </div>
      </div>

      <div className="table-card">
        <div className="card-head">
          <h3>
            Agent 凭据<small>{credentials.length}</small>
          </h3>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>项目</th>
                <th>角色</th>
                <th>Scopes</th>
                <th>过期时间</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((credential) => (
                <tr key={credential.id}>
                  <td>
                    <strong>{credential.name}</strong>
                  </td>
                  <td className="cell-mono cell-truncate">{credential.projectId}</td>
                  <td className="cell-mono cell-truncate">{credential.roleId}</td>
                  <td className="cell-truncate">{credential.scopes.join('、')}</td>
                  <td>{new Date(credential.expiresAt).toLocaleString('zh-CN')}</td>
                  <td className="col-actions">
                    <div className="cell-actions row-actions">
                      {credential.revokedAt ? (
                        <span className="status-tag">已撤销</span>
                      ) : (
                        <button className="danger" onClick={() => void revoke(credential.id)}>
                          撤销
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {credentials.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={6}>没有 Agent 凭据。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
