import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { knowledgeApi } from '../api/resources';
import { useAuthStore } from '../store/auth';
import { Modal } from '../components/Modal';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';

interface KnowledgeDocumentItem {
  id: string;
  filename: string;
}

interface KnowledgeBaseItem {
  id: string;
  name: string;
  documents?: KnowledgeDocumentItem[];
}

interface SearchHit {
  content: string;
  score: number;
  document?: { filename?: string };
}

interface SearchMetrics {
  candidateCount: number;
  totalDurationMs: number;
  truncated: boolean;
}

type SearchPayload =
  | SearchHit[]
  | {
      items?: SearchHit[];
      hasMore?: boolean;
      truncated?: boolean;
      metrics?: { candidateCount: number; totalDurationMs: number };
    };

const SEARCH_PAGE_SIZE = 20;
const EXAMPLE_QUERIES = ['进入公海条件', '运费计费规则怎么改', '汇率换算'];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function highlight(text: string, query: string) {
  const terms = Array.from(new Set(query.trim().split(/\s+/).filter(Boolean)));
  if (terms.length === 0) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return text
    .split(pattern)
    .map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part));
}

function splitFilename(filename: string) {
  const slash = filename.indexOf('/');
  return slash > 0
    ? { dir: filename.slice(0, slash), name: filename.slice(slash + 1) }
    : { dir: '', name: filename };
}

export function Knowledge() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { projectId, setProjectId } = useProjectContext();
  const [bases, setBases] = useState<KnowledgeBaseItem[]>([]);
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(searchParams.get('kb') ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [newBaseName, setNewBaseName] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [metrics, setMetrics] = useState<SearchMetrics | null>(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [modalError, setModalError] = useState('');
  const accessToken = useAuthStore((state) => state.accessToken);
  const fileRef = useRef<HTMLInputElement>(null);

  // 深链接优先：URL 指定的项目写入共享上下文
  useEffect(() => {
    const requested = searchParams.get('project');
    if (requested && requested !== projectId) setProjectId(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadBases(targetProjectId = projectId) {
    if (!targetProjectId.trim()) return;
    try {
      const value = (await knowledgeApi.list(targetProjectId.trim())) as unknown as {
        items: KnowledgeBaseItem[];
      };
      setBases(value.items);
      setKnowledgeBaseId(
        (current) =>
          value.items.find((base) => base.id === current)?.id ?? value.items[0]?.id ?? '',
      );
      setLoadError('');
    } catch {
      setLoadError('无法加载知识库，请检查项目访问权限。');
    }
  }

  useEffect(() => {
    if (projectId) void loadBases(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const params = new URLSearchParams({ project: projectId });
    if (knowledgeBaseId) params.set('kb', knowledgeBaseId);
    setSearchParams(params, { replace: true });
  }, [projectId, knowledgeBaseId, setSearchParams]);

  function resetSearch() {
    setHits([]);
    setMetrics(null);
    setSearched(false);
    setSearchError('');
    setSearchPage(1);
  }

  function openCreate() {
    setNewBaseName('');
    setModalError('');
    setCreateOpen(true);
  }

  function openUpload() {
    setUploadFile(null);
    setModalError('');
    setUploadOpen(true);
  }

  async function upload() {
    if (!knowledgeBaseId.trim() || !accessToken || !uploadFile) return;
    setUploading(true);
    setModalError('');
    try {
      const form = new FormData();
      form.append('file', uploadFile);
      const response = await fetch(
        `/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/upload`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        },
      );
      if (!response.ok) throw new Error('upload failed');
      await loadBases();
      setUploadOpen(false);
      setUploadFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch {
      setModalError('上传失败，仅支持 10MB 以内的 TXT、Markdown 或 PDF。');
    } finally {
      setUploading(false);
    }
  }

  async function createBase() {
    if (!projectId.trim() || !newBaseName.trim()) return;
    try {
      const created = (await knowledgeApi.create(projectId.trim(), {
        name: newBaseName.trim(),
      })) as unknown as KnowledgeBaseItem;
      setNewBaseName('');
      setCreateOpen(false);
      setKnowledgeBaseId(created.id);
      await loadBases();
    } catch {
      setModalError('创建知识库失败，请检查项目权限。');
    }
  }

  async function search(page = searchPage, term = query) {
    const keyword = term.trim();
    if (!keyword || !knowledgeBaseId.trim()) return;
    setSearching(true);
    try {
      const payload = (await knowledgeApi.search(
        knowledgeBaseId,
        keyword,
        page,
        SEARCH_PAGE_SIZE,
      )) as unknown as SearchPayload;
      const list = Array.isArray(payload) ? payload : (payload.items ?? []);
      const safeList = list.filter(
        (hit): hit is SearchHit => Boolean(hit) && typeof hit.content === 'string',
      );
      setHits(safeList);
      setSearchHasMore(
        Array.isArray(payload) ? safeList.length >= SEARCH_PAGE_SIZE : Boolean(payload.hasMore),
      );
      setMetrics(
        !Array.isArray(payload) && payload.metrics
          ? {
              candidateCount: payload.metrics.candidateCount,
              totalDurationMs: payload.metrics.totalDurationMs,
              truncated: Boolean(payload.truncated),
            }
          : null,
      );
      setSearched(true);
      setSearchError('');
    } catch {
      setHits([]);
      setSearched(false);
      setSearchError('检索失败，请重新选择知识库后重试。');
    } finally {
      setSearching(false);
    }
  }

  const selected = bases.find((base) => base.id === knowledgeBaseId);
  const documents = selected?.documents ?? [];

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>知识库</h2>
          <p className="page-sub">沉淀项目知识，支持全文检索</p>
        </div>
        <div className="page-actions">
          <ProjectSelect
            onChange={() => {
              setKnowledgeBaseId('');
              setBases([]);
              resetSearch();
            }}
          />
          <button className="ghost" disabled={!projectId} onClick={openCreate}>
            新建知识库
          </button>
          <button className="primary" disabled={!knowledgeBaseId} onClick={openUpload}>
            上传文档
          </button>
        </div>
      </header>

      {loadError && <p className="error">{loadError}</p>}

      <div className="table-card">
        <div className="card-head">
          <h3>
            知识库<small>{bases.length}</small>
          </h3>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>文档数</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {bases.map((base) => (
                <tr
                  key={base.id}
                  className={knowledgeBaseId === base.id ? 'is-selected' : undefined}
                >
                  <td>
                    <strong>{base.name}</strong>
                  </td>
                  <td className="cell-num">{base.documents?.length ?? 0}</td>
                  <td className="col-actions">
                    <div className="cell-actions row-actions">
                      <button
                        className="ghost"
                        onClick={() => {
                          setKnowledgeBaseId(base.id);
                          resetSearch();
                        }}
                      >
                        {knowledgeBaseId === base.id ? '当前' : '查看文档'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {bases.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={3}>
                    {projectId
                      ? '该项目还没有知识库，点右上角「新建知识库」创建。'
                      : '先选择项目。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-card">
        <div className="card-head">
          <h3>
            文档<small>{documents.length}</small>
          </h3>
          <span className="card-head-actions">
            <small>{selected ? selected.name : '先选择知识库'}</small>
          </span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>目录</th>
                <th>文件名</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => {
                const { dir, name } = splitFilename(document.filename);
                return (
                  <tr key={document.id}>
                    <td>{dir ? <span className="status-tag">{dir}</span> : '—'}</td>
                    <td>
                      <strong>{name}</strong>
                    </td>
                  </tr>
                );
              })}
              {documents.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={2}>
                    {selected ? '该知识库还没有文档，点右上角「上传文档」添加。' : '先选择知识库。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-card">
        <div className="card-head">
          <h3>
            检索<small>{selected ? `在「${selected.name}」中检索` : '先选择知识库'}</small>
          </h3>
          {metrics && (
            <small>
              候选 {metrics.candidateCount} · {metrics.totalDurationMs}ms
              {metrics.truncated ? ' · 已截断' : ''}
            </small>
          )}
        </div>
        <div className="kb-search-panel">
          <form
            className="kb-search-bar"
            onSubmit={(event) => {
              event.preventDefault();
              void search(1);
            }}
          >
            <svg
              className="kb-search-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchPage(1);
              }}
              placeholder={knowledgeBaseId ? '输入关键词或问题，回车检索' : '先选择知识库'}
              disabled={!knowledgeBaseId}
              aria-label="检索关键词"
            />
            <button
              className="primary"
              type="submit"
              disabled={!knowledgeBaseId || !query.trim() || searching}
            >
              {searching ? '检索中…' : '检索'}
            </button>
          </form>
          {searchError && <p className="error">{searchError}</p>}
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>文档</th>
                <th>分数</th>
                <th>片段</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((hit, index) => (
                <tr key={`${hit.document?.filename ?? 'hit'}-${index}`}>
                  <td>
                    <span className="cell-truncate" title={hit.document?.filename ?? ''}>
                      {hit.document?.filename ?? '未知文档'}
                    </span>
                  </td>
                  <td className="cell-num">{hit.score.toFixed(2)}</td>
                  <td>
                    <p className="kb-hit-body">{highlight(hit.content, query)}</p>
                  </td>
                </tr>
              ))}
              {!searched && (
                <tr className="table-empty">
                  <td colSpan={3}>
                    {knowledgeBaseId
                      ? '输入问题检索知识库，回车即可。'
                      : '选择项目与知识库后开始检索。'}
                  </td>
                </tr>
              )}
              {searched && hits.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={3}>没有匹配的片段，换个关键词试试。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!searched && knowledgeBaseId && (
          <div className="kb-examples kb-examples-foot">
            {EXAMPLE_QUERIES.map((example) => (
              <button
                type="button"
                className="ghost"
                key={example}
                onClick={() => {
                  setQuery(example);
                  void search(1, example);
                }}
              >
                {example}
              </button>
            ))}
          </div>
        )}

        {(searchPage > 1 || searchHasMore) && (
          <div className="table-foot">
            <span>第 {searchPage} 页</span>
            <div className="pager">
              <button
                className="ghost"
                disabled={searchPage === 1}
                onClick={() => {
                  const page = Math.max(1, searchPage - 1);
                  setSearchPage(page);
                  void search(page);
                }}
              >
                上一页
              </button>
              <button
                className="ghost"
                disabled={!searchHasMore}
                onClick={() => {
                  const page = searchPage + 1;
                  setSearchPage(page);
                  void search(page);
                }}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={createOpen}
        title="新建知识库"
        description="知识库用于按主题归集文档，可被 PRD 生成引用。"
        size="sm"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button
              className="primary"
              disabled={!newBaseName.trim()}
              onClick={() => void createBase()}
            >
              创建
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>知识库名称</span>
            <input
              value={newBaseName}
              onChange={(event) => {
                setNewBaseName(event.target.value);
                setModalError('');
              }}
              placeholder="例如：产品知识库"
              aria-label="知识库名称"
            />
          </div>
          {modalError && <p className="modal-error">{modalError}</p>}
        </div>
      </Modal>

      <Modal
        open={uploadOpen}
        title="上传文档"
        description={selected ? `上传到「${selected.name}」` : ''}
        size="sm"
        onClose={() => setUploadOpen(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setUploadOpen(false)}>
              取消
            </button>
            <button
              className="primary"
              disabled={!uploadFile || uploading}
              onClick={() => void upload()}
            >
              {uploading ? '上传中…' : '上传'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <label className="file-drop">
            <strong>{uploadFile ? uploadFile.name : '选择文件'}</strong>
            <span>支持 10MB 以内的 TXT、Markdown 或 PDF</span>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
              style={{ display: 'none' }}
              aria-label="选择文档文件"
              onChange={(event) => {
                setUploadFile(event.target.files?.[0] ?? null);
                setModalError('');
              }}
            />
            <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
              浏览文件
            </button>
          </label>
          {modalError && <p className="modal-error">{modalError}</p>}
        </div>
      </Modal>
    </section>
  );
}
