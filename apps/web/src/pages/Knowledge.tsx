import { useEffect, useState } from 'react';
import { documentApi, utf8ToBase64, base64ToUtf8, type DocumentDetail, type DocumentKind, type RevisionView } from '../api/resources';
import { formatApiError } from '../api/client';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import { Modal } from '../components/Modal';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';
import { toast } from '../store/toast';

const KINDS: DocumentKind[] = ['UNDERSTANDING', 'DECISION', 'PRD', 'KNOWLEDGE'];
const KIND_LABELS: Record<DocumentKind, string> = {
  UNDERSTANDING: '理解',
  DECISION: '决策',
  PRD: 'PRD',
  KNOWLEDGE: '知识',
};

export function Knowledge() {
  const { projectId, projects } = useProjectContext();
  const [docs, setDocs] = useState<DocumentDetail[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [content, setContent] = useState<{ revisionId: string; text: string; sha256: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');
  const [createForm, setCreateForm] = useState({
    kind: 'KNOWLEDGE' as DocumentKind,
    title: '',
    body: '',
    knowledgeBaseId: '',
    requirementId: '',
  });
  const [revisionForm, setRevisionForm] = useState({ title: '', body: '' });
  const [withdrawReason, setWithdrawReason] = useState('');

  const project = projects.find((item) => item.id === projectId);
  const selected = docs.find((item) => item.document.id === selectedId) ?? null;
  const published = selected?.publishedRevision ?? null;

  async function load() {
    if (!projectId) {
      setDocs([]);
      return;
    }
    try {
      const page = await documentApi.list(projectId);
      setDocs(page.items);
      setError('');
      setSelectedId((current) =>
        page.items.some((item) => item.document.id === current)
          ? current
          : (page.items[0]?.document.id ?? ''),
      );
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  useEffect(() => {
    void load();
    // 项目切换后重新读取文档；选中的知识库由文档自身携带
  }, [projectId]);

  async function openContent(revision: RevisionView) {
    try {
      const body = await documentApi.content(revision.id);
      setContent({ revisionId: revision.id, text: base64ToUtf8(body.bodyBase64), sha256: body.sha256 });
      setError('');
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  async function createDocument() {
    if (!projectId || !createForm.title.trim() || !createForm.body.trim()) {
      setModalError('标题与正文不能为空。');
      return;
    }
    const knowledgeBaseId = createForm.knowledgeBaseId.trim() || project?.defaultKnowledgeBaseId || '';
    if (!knowledgeBaseId) {
      setModalError('缺少知识库 ID：请填写目标知识库，或由服务端返回默认知识库。');
      return;
    }
    setBusy(true);
    setModalError('');
    try {
      const created = await documentApi.create(projectId, {
        knowledgeBaseId,
        kind: createForm.kind,
        requirementId: createForm.requirementId.trim() || null,
        title: createForm.title.trim(),
        bodyBase64: utf8ToBase64(createForm.body),
      });
      setCreateOpen(false);
      setCreateForm({ kind: 'KNOWLEDGE', title: '', body: '', knowledgeBaseId: '', requirementId: '' });
      await load();
      setSelectedId(created.document.id);
      toast.success('候选文档已创建，发布需经过评审全部批准。');
    } catch (caught) {
      setModalError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function proposeRevision() {
    if (!selected || !revisionForm.body.trim()) {
      setModalError('新版本正文不能为空。');
      return;
    }
    setBusy(true);
    setModalError('');
    try {
      await documentApi.proposeRevision(selected.document.id, {
        title: revisionForm.title.trim() || (published?.title ?? selected.document.kind),
        bodyBase64: utf8ToBase64(revisionForm.body),
      });
      setRevisionOpen(false);
      setRevisionForm({ title: '', body: '' });
      await load();
      setNotice('已追加候选修订；发布仍需评审全槽位批准。');
    } catch (caught) {
      setModalError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  function openWithdraw() {
    setWithdrawReason('');
    setModalError('');
    setWithdrawOpen(true);
  }

  async function withdraw(confirmation: { ticketId: string; ticketSecret: string }) {
    if (!selected) throw new Error('缺少撤销目标');
    if (!withdrawReason.trim()) throw new Error('撤销原因不能为空');
    await documentApi.withdraw(selected.document.id, {
      expectedVersion: selected.document.version,
      reason: withdrawReason.trim(),
      confirmation,
    });
    await load();
    setNotice('发布已撤销；旧发布指针不会自动回退。');
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>知识库</h2>
          <p className="page-sub">候选修订先经评审全槽位批准，页面不提供直接发布入口。</p>
        </div>
        <div className="page-actions">
          <ProjectSelect
            onChange={() => {
              setSelectedId('');
              setContent(null);
            }}
          />
          <button
            className="primary"
            onClick={() => {
              setModalError('');
              setCreateOpen(true);
            }}
          >
            新建候选文档
          </button>
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
            文档<small>{docs.length}</small>
          </h3>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>标题（当前发布版）</th>
                <th>版本</th>
                <th>修订数</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((item) => (
                <tr
                  key={item.document.id}
                  className={selectedId === item.document.id ? 'is-selected' : undefined}
                >
                  <td>
                    <span className="status-tag">{KIND_LABELS[item.document.kind]}</span>
                  </td>
                  <td>
                    <strong>{item.publishedRevision?.title ?? '尚未发布'}</strong>
                  </td>
                  <td className="cell-num">v{item.document.version}</td>
                  <td className="cell-num">{item.revisions.length}</td>
                  <td className="col-actions">
                    <div className="cell-actions row-actions">
                      <button className="ghost" onClick={() => setSelectedId(item.document.id)}>
                        {selectedId === item.document.id ? '当前' : '查看修订'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={5}>{projectId ? '该项目还没有可读文档。' : '先选择项目。'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="table-card">
          <div className="card-head">
            <h3>
              修订<small>{selected.document.kind}</small>
            </h3>
            <span className="card-head-actions">
              <button
                className="ghost"
                onClick={() => {
                  setRevisionForm({ title: '', body: '' });
                  setModalError('');
                  setRevisionOpen(true);
                }}
              >
                追加候选修订
              </button>
            </span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>状态</th>
                  <th>摘要</th>
                  <th>字节</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {selected.revisions.map((revision) => (
                  <tr key={revision.id}>
                    <td>
                      <strong>{revision.title}</strong>
                    </td>
                    <td>
                      <span className="status-tag">{revision.state}</span>
                    </td>
                    <td>
                      <span className="cell-mono cell-truncate" title={revision.digest}>
                        {revision.digest.slice(0, 16)}
                      </span>
                    </td>
                    <td className="cell-num">{revision.byteLength}</td>
                    <td className="col-actions">
                      <div className="cell-actions row-actions">
                        <button className="ghost" onClick={() => void openContent(revision)}>
                          查看正文
                        </button>
                        {revision.state === 'PUBLISHED' && (
                          <button className="danger" onClick={openWithdraw}>
                            撤销发布
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {selected.revisions.length === 0 && (
                  <tr className="table-empty">
                    <td colSpan={5}>该文档还没有修订。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {content && (
        <div className="table-card">
          <div className="card-head">
            <h3>
              正文<small>{content.revisionId}</small>
            </h3>
            <span className="card-head-actions">
              <small className="cell-mono">sha256 {content.sha256}</small>
            </span>
          </div>
          <pre className="search-result">{content.text}</pre>
        </div>
      )}

      <Modal
        open={createOpen}
        title="新建候选文档"
        description="创建后仍是候选修订，发布必须由评审全部批准。"
        size="lg"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button className="primary" disabled={busy} onClick={() => void createDocument()}>
              {busy ? '创建中…' : '创建候选'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>文档类型</span>
            <select
              value={createForm.kind}
              aria-label="文档类型"
              onChange={(event) =>
                setCreateForm({ ...createForm, kind: event.target.value as DocumentKind })
              }
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span>知识库 ID</span>
            <input
              value={createForm.knowledgeBaseId}
              onChange={(event) => setCreateForm({ ...createForm, knowledgeBaseId: event.target.value })}
              aria-label="知识库 ID"
              placeholder={project?.defaultKnowledgeBaseId ?? 'UUID'}
            />
          </div>
          <div className="field">
            <span>绑定需求 ID（UNDERSTANDING / PRD 必填）</span>
            <input
              value={createForm.requirementId}
              onChange={(event) => setCreateForm({ ...createForm, requirementId: event.target.value })}
              aria-label="绑定需求 ID"
              placeholder="UUID"
            />
          </div>
          <div className="field">
            <span>标题</span>
            <input
              value={createForm.title}
              onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })}
              aria-label="文档标题"
            />
          </div>
          <div className="field">
            <span>正文（Markdown）</span>
            <textarea
              value={createForm.body}
              onChange={(event) => setCreateForm({ ...createForm, body: event.target.value })}
              rows={12}
              aria-label="文档正文"
            />
          </div>
          {modalError && (
            <p className="modal-error" role="alert">
              {modalError}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={revisionOpen}
        title="追加候选修订"
        description="返修后重新提交评审；不直接改变发布指针。"
        size="lg"
        onClose={() => setRevisionOpen(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setRevisionOpen(false)}>
              取消
            </button>
            <button className="primary" disabled={busy} onClick={() => void proposeRevision()}>
              {busy ? '提交中…' : '追加修订'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>标题</span>
            <input
              value={revisionForm.title}
              onChange={(event) => setRevisionForm({ ...revisionForm, title: event.target.value })}
              aria-label="修订标题"
            />
          </div>
          <div className="field">
            <span>正文（Markdown）</span>
            <textarea
              value={revisionForm.body}
              onChange={(event) => setRevisionForm({ ...revisionForm, body: event.target.value })}
              rows={12}
              aria-label="修订正文"
            />
          </div>
          {modalError && (
            <p className="modal-error" role="alert">
              {modalError}
            </p>
          )}
        </div>
      </Modal>

      <ConfirmationPrompt
        open={withdrawOpen}
        title="撤销发布（需二次验证）"
        description={selected ? `文档 ${selected.document.id} v${selected.document.version}` : ''}
        binding={
          selected
            ? {
                action: 'KNOWLEDGE_WITHDRAW',
                projectId: selected.document.projectId,
                targetType: 'KNOWLEDGE_DOCUMENT',
                targetId: selected.document.id,
                expectedVersion: selected.document.version,
                roleSlot: null,
                payload: { reason: withdrawReason.trim() },
              }
            : null
        }
        submitLabel="撤销发布"
        onClose={() => setWithdrawOpen(false)}
        onConfirmed={withdraw}
      >
        <div className="field">
          <span>撤销原因（必填）</span>
          <textarea
            value={withdrawReason}
            onChange={(event) => setWithdrawReason(event.target.value)}
            aria-label="撤销原因"
            rows={3}
          />
        </div>
      </ConfirmationPrompt>
    </section>
  );
}
