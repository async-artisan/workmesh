import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { traceApi } from '../api/resources';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectStore } from '../store/project';

interface TraceGraphItem {
  id: string;
  title: string;
  prds?: Array<{ id: string; title: string; version: number }>;
  traces?: Array<{ id: string; kind: string; targetId: string }>;
  commits?: Array<{
    id: string;
    sha: string;
    message: string;
    url: string;
    files?: Array<{ path: string; linkType: string }>;
  }>;
  pullRequests?: Array<{
    id: string;
    number: number;
    title: string;
    url: string;
    provider: string;
    files?: Array<{ path: string; linkType: string }>;
  }>;
}

export function Trace() {
  const projectId = useProjectStore((state) => state.projectId);
  const [graph, setGraph] = useState<TraceGraphItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const result = (await traceApi.graph(id)) as unknown as TraceGraphItem[];
      setGraph(Array.isArray(result) ? result : []);
      setError('');
    } catch {
      setGraph([]);
      setError('无法加载追溯关系，请确认当前项目有需求与代码关联数据。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      setGraph([]);
      return;
    }
    void load(projectId);
  }, [projectId, load]);

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>追溯</h2>
          <p className="page-sub">需求 → PRD → 提交与 PR → 代码/测试文件</p>
        </div>
        <div className="page-actions">
          <ProjectSelect />
          <button
            className="ghost"
            disabled={!projectId || loading}
            onClick={() => void load(projectId)}
          >
            <RefreshCw size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>
      </header>

      <div className="table-card">
        <div className="card-head">
          <h3>
            追溯关系 <small>{graph.length} 个需求节点</small>
          </h3>
        </div>
        <div className="trace-panel">
          {error && <p className="error">{error}</p>}
          {!error && !projectId && <p className="muted">先选择项目。</p>}
          {!error && projectId && loading && <p className="muted">正在加载追溯关系…</p>}
          {!error && projectId && !loading && graph.length === 0 && (
            <p className="muted">
              该项目还没有追溯数据。需求关联 PRD、提交或 PR 后会自动出现在这里。
            </p>
          )}
          {graph.length > 0 && (
            <div className="trace-map">
              {graph.flatMap((item) => [
                <div className="trace-node requirement" key={item.id}>
                  需求
                  <br />
                  <strong>{item.title}</strong>
                </div>,
                ...(item.prds ?? []).flatMap((prd) => [
                  <span key={`${prd.id}-arrow`}>→</span>,
                  <div className="trace-node prd" key={prd.id}>
                    PRD
                    <br />
                    <strong>v{prd.version}</strong>
                  </div>,
                ]),
                ...(item.commits ?? []).flatMap((commit) => [
                  <span key={`${commit.id}-arrow`}>→</span>,
                  <div key={commit.id}>
                    <div className="trace-node code">
                      代码提交
                      <br />
                      <strong>{commit.sha.slice(0, 8)}</strong>
                    </div>
                    {(commit.files ?? []).map((file) => (
                      <div className="trace-node code" key={`${commit.id}-${file.path}`}>
                        {file.linkType === 'tests' ? '测试文件' : '代码文件'}
                        <br />
                        <strong>{file.path}</strong>
                      </div>
                    ))}
                  </div>,
                ]),
                ...(item.pullRequests ?? []).flatMap((pullRequest) => [
                  <span key={`${pullRequest.id}-arrow`}>→</span>,
                  <div key={pullRequest.id}>
                    <div className="trace-node prd">
                      {pullRequest.provider} PR #{pullRequest.number}
                      <br />
                      <strong>{pullRequest.title}</strong>
                    </div>
                    {(pullRequest.files ?? []).map((file) => (
                      <div className="trace-node code" key={`${pullRequest.id}-${file.path}`}>
                        {file.linkType === 'tests' ? '测试文件' : '代码文件'}
                        <br />
                        <strong>{file.path}</strong>
                      </div>
                    ))}
                  </div>,
                ]),
                ...(item.traces ?? []).flatMap((trace) => [
                  <span key={`${trace.id}-arrow`}>→</span>,
                  <div className="trace-node code" key={trace.id}>
                    代码
                    <br />
                    <strong>{trace.targetId}</strong>
                  </div>,
                ]),
              ])}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
