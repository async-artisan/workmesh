import { useEffect, useState } from 'react';
import { SCOPE_REGISTRY } from '@workmesh/shared';
import { formatApiError } from '../api/client';
import { authApi, type CliAuthorizationView } from '../api/auth';
import { projectApi, type RoleView } from '../api/resources';
import { loadProjects } from '../store/project';
import type { ProjectView } from '../api/resources';

/**
 * CLI 设备授权批准页：只处理用户主动输入的 userCode。
 * 批准时提交预期的授权请求版本；角色与项目由服务端重新校验，页面不缓存任何凭据。
 */
export function Authorization() {
  const [userCode, setUserCode] = useState('');
  const [lookup, setLookup] = useState<CliAuthorizationView | null>(null);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [projectId, setProjectId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [scopes, setScopes] = useState<string[]>(['project:read']);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadProjects()
      .then((list) => setProjects(list))
      .catch(() => setProjects([]));
  }, []);

  async function loadRoles(nextProjectId: string) {
    setProjectId(nextProjectId);
    setRoleId('');
    setRoles([]);
    if (!nextProjectId) return;
    try {
      setRoles(await projectApi.roles(nextProjectId));
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  async function doLookup() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await authApi.cliLookup(userCode.trim());
      setLookup(value);
      if (value.authorizationId) setNotice('请确认客户端名称与授权范围后再批准。');
    } catch (caught) {
      setLookup(null);
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!lookup) return;
    if (!projectId || !roleId || scopes.length === 0) {
      setError('[INVALID_REQUEST] 请选择项目、业务角色与至少一个 scope');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await authApi.cliApprove({
        authorizationId: lookup.authorizationId,
        expectedVersion: lookup.version,
        projectId,
        roleId,
        scopes,
        expiresInDays,
      });
      setNotice(`授权已批准（${result.status} · v${result.version}）。`);
      setLookup({ ...lookup, status: result.status, version: result.version });
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function deny() {
    if (!lookup) return;
    setBusy(true);
    setError('');
    try {
      const result = await authApi.cliDeny(lookup.authorizationId, lookup.version);
      setNotice(`授权已拒绝（${result.status}）。`);
      setLookup({ ...lookup, status: result.status, version: result.version });
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  function toggleScope(scope: string) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>设备授权</h2>
          <p className="page-sub">
            为 CLI 批准一次设备授权。授权只绑定所选项目与业务角色，角色资格由服务端校验。
          </p>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="kb-notice">{notice}</p>}

      <div className="page-card">
        <div className="toolbar">
          <input
            value={userCode}
            onChange={(event) => setUserCode(event.target.value.toUpperCase())}
            aria-label="设备授权码"
            placeholder="XXXX-XXXX"
          />
          <button
            className="primary"
            disabled={busy || !userCode.trim()}
            onClick={() => void doLookup()}
          >
            查询授权请求
          </button>
        </div>

        {lookup && (
          <div className="table-card">
            <div className="card-head">
              <h3>
                {lookup.clientName}
                <small>{lookup.status}</small>
              </h3>
              <span className="card-head-actions">
                <small>版本 v{lookup.version}</small>
              </span>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>授权请求</th>
                    <th>状态</th>
                    <th>过期时间</th>
                    <th>版本</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="cell-mono">{lookup.authorizationId}</td>
                    <td>{lookup.status}</td>
                    <td>{new Date(lookup.expiresAt).toLocaleString('zh-CN')}</td>
                    <td className="cell-num">v{lookup.version}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {lookup && lookup.status === 'PENDING' && (
          <div className="form-grid">
            <div className="field">
              <span>项目</span>
              <select
                value={projectId}
                aria-label="授权项目"
                onChange={(event) => void loadRoles(event.target.value)}
              >
                <option value="">选择项目</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>业务角色</span>
              <select
                value={roleId}
                aria-label="授权角色"
                disabled={!projectId}
                onChange={(event) => setRoleId(event.target.value)}
              >
                <option value="">选择角色</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>有效期（天）</span>
              <input
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                aria-label="授权有效期"
                onChange={(event) => setExpiresInDays(Number(event.target.value))}
              />
            </div>
            <div className="field">
              <span>Scopes</span>
              <div className="cell-actions row-actions">
                {SCOPE_REGISTRY.map((scope) => (
                  <label key={scope} className="inline-check">
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      aria-label={`scope ${scope}`}
                      onChange={() => toggleScope(scope)}
                    />
                    {scope}
                  </label>
                ))}
              </div>
              <small>服务端仍会拒绝越权 scope；Agent 不能获得发布、撤销或管理权限。</small>
            </div>
            <div className="toolbar">
              <button className="danger" disabled={busy} onClick={() => void deny()}>
                拒绝授权
              </button>
              <button className="primary" disabled={busy} onClick={() => void approve()}>
                {busy ? '提交中…' : '批准授权'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
