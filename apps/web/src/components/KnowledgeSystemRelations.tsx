import { useCallback, useEffect, useMemo, useState } from 'react';
import { InlineLoading, SkeletonLines } from './Skeleton';

/** A project system unit as returned by the units read API. */
export interface KnowledgeSystemUnit {
  id: string;
  key: string;
  name: string;
  status?: string | null;
  repoPath?: string | null;
}

/** A declared directional edge between two system units. */
export interface KnowledgeSystemDependency {
  id: string;
  fromUnitId: string;
  toUnitId: string;
  edgeKind: string;
  protocol?: string | null;
  source?: string | null;
  confidence?: string | null;
  evidence?: string | null;
  verifiedAt?: string | null;
  fromUnit?: { key: string; name: string } | null;
  toUnit?: { key: string; name: string } | null;
}

export interface KnowledgeSystemRelationsProps {
  projectId: string | null | undefined;
  /** Keep the API adapter outside this component so the view remains easy to test. */
  loadUnits: (projectId: string) => Promise<KnowledgeSystemUnit[]>;
  loadDependencies: (projectId: string) => Promise<KnowledgeSystemDependency[]>;
}

function unitLabel(unit: { key?: string | null; name?: string | null } | null | undefined) {
  if (!unit) return '未知系统单元';
  if (unit.name && unit.key && unit.name !== unit.key) return `${unit.name}（${unit.key}）`;
  return unit.name || unit.key || '未命名系统单元';
}

function relationUnit(
  id: string,
  nested: { key: string; name: string } | null | undefined,
  byId: Map<string, KnowledgeSystemUnit>,
) {
  return nested ?? byId.get(id) ?? null;
}

/**
 * System-facts sub-view for the Knowledge page.
 *
 * This view deliberately renders only the directional dependency records supplied by the API.
 * It does not infer relationships from document titles and it is intended to be mounted inside
 * the SYSTEM collection, rather than promoted to the knowledge portal homepage.
 */
export function KnowledgeSystemRelations({
  projectId,
  loadUnits,
  loadDependencies,
}: KnowledgeSystemRelationsProps) {
  const [units, setUnits] = useState<KnowledgeSystemUnit[]>([]);
  const [dependencies, setDependencies] = useState<KnowledgeSystemDependency[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!projectId) {
      setUnits([]);
      setDependencies([]);
      setError('');
      setState('idle');
      return;
    }
    setState('loading');
    setError('');
    try {
      const [nextUnits, nextDependencies] = await Promise.all([
        loadUnits(projectId),
        loadDependencies(projectId),
      ]);
      setUnits(nextUnits);
      setDependencies(nextDependencies);
      setState('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '系统关系读取失败，请稍后重试。');
      setState('error');
    }
  }, [loadDependencies, loadUnits, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const unitsById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);

  if (!projectId) {
    return (
      <section className="table-card" data-testid="knowledge-system-relations">
        <div className="card-head">
          <h3>上下游关系</h3>
        </div>
        <p className="table-empty">先选择项目，再查看系统单元之间的已声明关系。</p>
      </section>
    );
  }

  return (
    <section className="table-card" data-testid="knowledge-system-relations">
      <div className="card-head">
        <div>
          <h3>上下游关系</h3>
          <p className="page-sub">
            仅显示项目中已记录的系统单元依赖。方向按服务端的 fromUnit → toUnit
            展示，不根据文档标题推断关系。
          </p>
        </div>
        {state !== 'loading' && (
          <button type="button" className="ghost" onClick={() => void reload()}>
            重新读取
          </button>
        )}
      </div>

      {state === 'loading' && (
        <div role="status" aria-busy="true" data-testid="knowledge-system-relations-loading">
          <InlineLoading label="正在读取系统关系…" />
          <SkeletonLines lines={3} />
        </div>
      )}

      {state === 'error' && (
        <div className="error" role="alert">
          <span>{error || '系统关系读取失败。'}</span>{' '}
          <button type="button" className="ghost" onClick={() => void reload()}>
            重试
          </button>
        </div>
      )}

      {state === 'ready' && dependencies.length === 0 && (
        <p className="table-empty" role="status">
          当前项目还没有已声明的系统上下游关系。
        </p>
      )}

      {state === 'ready' && dependencies.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="page-sub">
              {dependencies.length} 条已声明关系；显示的是事实记录，不代表系统自动发现的依赖。
            </caption>
            <thead>
              <tr>
                <th>上游（from）</th>
                <th aria-label="方向">→</th>
                <th>下游（to）</th>
                <th>关系</th>
                <th>来源 / 可信度</th>
              </tr>
            </thead>
            <tbody>
              {dependencies.map((dependency) => {
                const from = relationUnit(dependency.fromUnitId, dependency.fromUnit, unitsById);
                const to = relationUnit(dependency.toUnitId, dependency.toUnit, unitsById);
                return (
                  <tr key={dependency.id}>
                    <td>
                      <strong>{unitLabel(from)}</strong>
                      <div className="task-row-meta">fromUnit · {dependency.fromUnitId}</div>
                    </td>
                    <td className="cell-num" aria-label="依赖方向">
                      →
                    </td>
                    <td>
                      <strong>{unitLabel(to)}</strong>
                      <div className="task-row-meta">toUnit · {dependency.toUnitId}</div>
                    </td>
                    <td>
                      <span className="status-tag">{dependency.edgeKind}</span>
                      {dependency.protocol && (
                        <div className="task-row-meta">{dependency.protocol}</div>
                      )}
                    </td>
                    <td>
                      <div>{dependency.source || '未标注来源'}</div>
                      {dependency.confidence && (
                        <div className="task-row-meta">可信度：{dependency.confidence}</div>
                      )}
                      {dependency.evidence && (
                        <div className="task-row-meta">证据：{dependency.evidence}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
