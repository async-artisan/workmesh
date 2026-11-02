import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatApiError } from '../api/client';
import { changeApi, type ChangeRecipient } from '../api/resources';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';

/**
 * 工作台：待确认变更与评审入口。确认变更带收件人当前版本，版本变化由服务端判 409。
 */
export function Workbench() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const [recipients, setRecipients] = useState<ChangeRecipient[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewId, setReviewId] = useState('');

  async function load() {
    if (!projectId) {
      setRecipients([]);
      return;
    }
    try {
      const page = await changeApi.listRecipients(projectId);
      setRecipients(page.items);
      setError('');
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function ack(recipient: ChangeRecipient) {
    try {
      await changeApi.ack(recipient.id, recipient.version);
      setNotice('变更已确认。');
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
          <h2>工作台</h2>
          <p className="page-sub">待确认变更、评审与项目入口。所有写操作由服务端校验版本与权限。</p>
        </div>
        <div className="page-actions">
          <ProjectSelect onChange={() => setRecipients([])} />
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="kb-notice">{notice}</p>}

      <div className="table-card">
        <div className="card-head">
          <h3>
            待确认变更<small>{recipients.length}</small>
          </h3>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>来源</th>
                <th>项目</th>
                <th>版本</th>
                <th>创建时间</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((recipient) => (
                <tr key={recipient.id}>
                  <td>
                    <span className="cell-mono cell-truncate" title={recipient.eventId}>
                      {recipient.eventId}
                    </span>
                  </td>
                  <td className="cell-mono cell-truncate">{recipient.projectId}</td>
                  <td className="cell-num">v{recipient.version}</td>
                  <td>{new Date(recipient.createdAt).toLocaleString('zh-CN')}</td>
                  <td className="col-actions">
                    <div className="cell-actions row-actions">
                      {recipient.ackedAt ? (
                        <span className="status-tag">已确认</span>
                      ) : (
                        <button className="primary" onClick={() => void ack(recipient)}>
                          确认已处理
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {recipients.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={5}>{projectId ? '没有待确认变更。' : '先选择项目。'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-card">
        <div className="card-head">
          <h3>评审</h3>
          <span className="card-head-actions">
            <input
              value={reviewId}
              onChange={(event) => setReviewId(event.target.value)}
              aria-label="评审请求 ID"
              placeholder="评审请求 ID"
            />
            <button
              className="ghost"
              disabled={!reviewId.trim()}
              onClick={() => navigate(`/reviews?id=${encodeURIComponent(reviewId.trim())}`)}
            >
              打开评审
            </button>
          </span>
        </div>
        <div className="toolbar">
          <button className="ghost" onClick={() => navigate('/requirements')}>
            需求
          </button>
          <button className="ghost" onClick={() => navigate('/prd')}>
            PRD 文档
          </button>
          <button className="ghost" onClick={() => navigate('/knowledge')}>
            知识库
          </button>
          <button className="ghost" onClick={() => navigate('/board')}>
            任务看板
          </button>
          <button className="ghost" onClick={() => navigate('/roles')}>
            角色 / ACL
          </button>
          <button className="ghost" onClick={() => navigate('/authorization')}>
            设备授权
          </button>
        </div>
      </div>
    </section>
  );
}
