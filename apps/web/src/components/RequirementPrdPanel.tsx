import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DocumentSummary } from '../api/documentSummaries';
import { useDocumentHistory } from '../hooks/useDocumentHistory';
import { useDocumentSummaries } from '../hooks/useDocumentSummaries';
import { REVISION_STATE_LABELS, labelFor } from '../lib/labels';
import { FullValueDisclosure } from './FullValueDisclosure';

export interface RequirementPrdCount {
  projectId: string;
  requirementId: string;
  total: number | null;
}

interface PanelProps {
  projectId: string;
  requirementId: string;
  active: boolean;
  onCountChange: (count: RequirementPrdCount) => void;
}

function documentTitle(summary: DocumentSummary): string {
  return summary.publishedRevision?.title ?? summary.latestVisibleRevision?.title ?? '尚无可见修订';
}

/** 概要常驻供页签计数；历史只属于用户显式展开的唯一文档。 */
export function RequirementPrdPanel(props: PanelProps) {
  return (
    <RequirementPrdScope key={JSON.stringify([props.projectId, props.requirementId])} {...props} />
  );
}

function RequirementPrdScope({ projectId, requirementId, active, onCountChange }: PanelProps) {
  const navigate = useNavigate();
  const catalog = useDocumentSummaries(projectId, { kind: 'PRD', requirementId, limit: 50 });
  const [selected, setSelected] = useState<DocumentSummary | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const refreshRef = useRef<HTMLButtonElement>(null);
  const count =
    catalog.loading || catalog.stale || catalog.error || catalog.queryError ? null : catalog.total;

  useEffect(() => {
    onCountChange({ projectId, requirementId, total: count });
  }, [count, onCountChange, projectId, requirementId]);

  useEffect(() => {
    if (catalog.accessDenied) {
      setSelected(null);
      return;
    }
    setSelected((previous) => {
      if (!previous) return null;
      return catalog.items.find((item) => item.document.id === previous.document.id) ?? previous;
    });
  }, [catalog.accessDenied, catalog.items]);

  function refreshCatalog() {
    setSelected(null);
    void catalog.reload();
  }

  function closeHistory() {
    const trigger = selected ? triggerRefs.current.get(selected.document.id) : null;
    setSelected(null);
    (trigger ?? refreshRef.current)?.focus();
  }

  if (!active) return null;

  const unavailable =
    catalog.loading || catalog.stale || Boolean(catalog.error) || Boolean(catalog.queryError);
  const initialLoading = catalog.total === null && !catalog.error && !catalog.queryError;
  const selectedOnPage = catalog.items.some((item) => item.document.id === selected?.document.id);

  return (
    <section className="detail-card" aria-label="需求 PRD 文档">
      <div className="detail-card-head">
        <h3>
          PRD<small>{count ?? '—'}</small>
        </h3>
        <div className="page-actions">
          <button
            className="ghost"
            ref={refreshRef}
            onClick={refreshCatalog}
            disabled={catalog.loading}
          >
            刷新 PRD 列表
          </button>
          <button
            className="ghost"
            onClick={() => navigate(`/prd?projectId=${encodeURIComponent(projectId)}`)}
          >
            打开项目文档页
          </button>
        </div>
      </div>

      {initialLoading && <p role="status">正在读取需求 PRD 文档…</p>}
      {(catalog.error || catalog.queryError) && (
        <div role="alert">
          <p>PRD 文档列表暂时无法读取。{catalog.error ?? catalog.queryError}</p>
          {catalog.stale && <p>保留上次成功读取的文档，数据可能已过期；请刷新后继续。</p>}
          <button className="ghost" onClick={refreshCatalog} disabled={catalog.loading}>
            重试读取 PRD 列表
          </button>
        </div>
      )}
      {catalog.loading && !initialLoading && <p role="status">正在更新 PRD 文档列表…</p>}
      {catalog.total !== null && (
        <p className="task-row-meta">
          {unavailable ? '上次读取' : '当前需求'}共 {catalog.total} 份 PRD · 第{' '}
          {catalog.pageIndex + 1} 页
        </p>
      )}
      {!initialLoading && !unavailable && catalog.total === 0 && (
        <p className="detail-empty">该需求还没有绑定 PRD 文档。</p>
      )}
      {catalog.items.length > 0 && (
        <div className="task-groups" data-testid="requirement-prd-catalog">
          {catalog.items.map((summary) => {
            const title = documentTitle(summary);
            const expanded = selected?.document.id === summary.document.id;
            return (
              <article className="task-row" key={summary.document.id} aria-label={title}>
                <div className="task-row-main">
                  <div className="task-row-top">
                    <strong>{title}</strong>
                    <span className="status-tag">文档版本 v{summary.document.version}</span>
                    <span className="task-row-meta">候选 {summary.candidateRevisionCount} 个</span>
                  </div>
                  <div className="task-row-meta">
                    可见修订 {summary.visibleRevisionCount} 个 ·{' '}
                    <FullValueDisclosure
                      label="文档"
                      value={summary.document.id}
                      preview={summary.document.id.slice(0, 12)}
                    />
                  </div>
                </div>
                <div className="task-row-actions">
                  <button
                    className="ghost"
                    ref={(node) => {
                      if (node) triggerRefs.current.set(summary.document.id, node);
                      else triggerRefs.current.delete(summary.document.id);
                    }}
                    aria-expanded={expanded}
                    aria-controls={expanded ? 'requirement-prd-history' : undefined}
                    disabled={unavailable}
                    onClick={() => setSelected(expanded ? null : summary)}
                  >
                    {expanded ? `收起修订 ${title}` : `查看修订 ${title}`}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {(catalog.hasPrevious || catalog.hasNext) && (
        <nav className="page-actions" aria-label="需求 PRD 分页">
          <button
            className="ghost"
            disabled={catalog.loading || !catalog.hasPrevious}
            onClick={() => void catalog.previousPage()}
          >
            上一页 PRD
          </button>
          <button
            className="ghost"
            disabled={catalog.loading || !catalog.hasNext}
            onClick={() => void catalog.nextPage()}
          >
            下一页 PRD
          </button>
        </nav>
      )}

      {selected && !catalog.accessDenied && (
        <>
          {!selectedOnPage && <p role="status">正在查看的文档不在当前结果页。</p>}
          <RequirementPrdHistory
            key={JSON.stringify([
              selected.document.id,
              selected.document.version,
              selected.publishedRevision?.id,
            ])}
            scope={JSON.stringify([projectId, requirementId, selected.document.version])}
            summary={selected}
            disabled={unavailable}
            onClose={closeHistory}
            onRefreshCatalog={refreshCatalog}
          />
        </>
      )}
    </section>
  );
}

function RequirementPrdHistory({
  scope,
  summary,
  disabled,
  onClose,
  onRefreshCatalog,
}: {
  scope: string;
  summary: DocumentSummary;
  disabled: boolean;
  onClose: () => void;
  onRefreshCatalog: () => void;
}) {
  const navigate = useNavigate();
  const history = useDocumentHistory(summary.document.id, { scopeKey: scope });
  const [metadataLoading, setMetadataLoading] = useState(false);
  const metadataRequest = useRef(0);
  const published = summary.publishedRevision;
  const publishedMetadata = published ? history.metadataById.get(published.id) : undefined;
  const versionChanged =
    history.documentVersion !== null && history.documentVersion !== summary.document.version;
  const unavailable =
    disabled ||
    history.loading ||
    Boolean(history.error) ||
    history.stale ||
    history.requiresReload ||
    versionChanged;

  useEffect(
    () => () => {
      ++metadataRequest.current;
    },
    [],
  );

  async function readPublished() {
    if (!published || unavailable || metadataLoading) return;
    const request = ++metadataRequest.current;
    setMetadataLoading(true);
    await history.resolveRevision(published.id);
    if (metadataRequest.current === request) setMetadataLoading(false);
  }

  function refreshHistory() {
    ++metadataRequest.current;
    setMetadataLoading(false);
    void history.reload();
  }

  return (
    <section
      className="detail-card"
      id="requirement-prd-history"
      aria-label="PRD 修订历史"
      style={{ minWidth: 0 }}
    >
      <div className="detail-card-head">
        <h4>PRD 修订历史 · {documentTitle(summary)}</h4>
        <button className="ghost" onClick={onClose}>
          关闭 PRD 修订历史
        </button>
      </div>
      {history.accessDenied ? (
        <div role="alert">
          <p>无法读取此文档修订。已清除历史与评审入口，请刷新文档列表后重试。</p>
          <p>{history.error}</p>
          <button className="ghost" onClick={onRefreshCatalog}>
            重新读取文档列表
          </button>
        </div>
      ) : (
        <>
          <button className="ghost" disabled={history.loading} onClick={refreshHistory}>
            刷新 PRD 历史
          </button>
          {history.loading && <p role="status">正在读取 PRD 修订历史…</p>}
          {history.error && (
            <div role="alert">
              <p>PRD 修订历史暂时无法读取。{history.error}</p>
              {history.stale && <p>已加载的历史保留供参考，评审入口暂不可用。</p>}
            </div>
          )}
          {history.requiresReload && <p role="alert">历史已变化，请刷新历史后继续。</p>}
          {versionChanged && <p role="alert">文档版本已变化，请刷新 PRD 列表后查看当前修订。</p>}
          {versionChanged && (
            <button className="ghost" onClick={onRefreshCatalog}>
              刷新文档版本
            </button>
          )}
          <p className="task-row-meta">
            已加载 {history.items.length} / {history.total ?? '—'} 条历史
          </p>

          {published ? (
            <div className="rail-card" data-testid="requirement-prd-published-revision">
              <h5>当前发布修订</h5>
              <p>
                v{published.seq} · {published.title}
              </p>
              <FullValueDisclosure
                label="当前发布修订 ID"
                value={published.id}
                preview={published.id.slice(0, 12)}
              />
              <p className="task-row-meta">当前发布来自文档概要，不计入已加载历史数量。</p>
              <button
                className="ghost"
                disabled={unavailable || metadataLoading}
                onClick={() => void readPublished()}
              >
                查看当前发布修订信息
              </button>
              {metadataLoading && <p role="status">正在读取当前发布修订…</p>}
              {history.metadataError && <p role="alert">{history.metadataError}</p>}
              {publishedMetadata && !unavailable && (
                <div>
                  <p>
                    已读取准确修订 v{publishedMetadata.seq} · {publishedMetadata.title}
                  </p>
                  {publishedMetadata.reviewRequestId ? (
                    <button
                      className="ghost"
                      onClick={() =>
                        navigate(
                          `/reviews/${encodeURIComponent(publishedMetadata.reviewRequestId!)}`,
                        )
                      }
                    >
                      评审当前发布修订
                    </button>
                  ) : (
                    <p className="task-row-meta">该修订没有关联评审。</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="task-row-meta">当前没有可见的发布修订。</p>
          )}

          {history.items.length > 0 && (
            <div
              className="revision-list"
              role="list"
              aria-label="已加载 PRD 历史"
              data-testid="requirement-prd-history-list"
            >
              {history.items.map((revision) => (
                <div className="revision-row" role="listitem" key={revision.id}>
                  <span className="cell-mono">v{revision.seq}</span>
                  <span>{labelFor(REVISION_STATE_LABELS, revision.state)}</span>
                  <span className="cell-truncate" title={revision.title}>
                    {revision.title}
                  </span>
                  {revision.reviewRequestId && (
                    <button
                      className="ghost"
                      disabled={unavailable}
                      onClick={() =>
                        navigate(`/reviews/${encodeURIComponent(revision.reviewRequestId!)}`)
                      }
                    >
                      评审修订 v{revision.seq}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!history.loading && !history.error && history.total === 0 && (
            <p className="detail-empty">当前没有可见的历史修订。</p>
          )}
          {history.hasMore && !history.requiresReload && !versionChanged && (
            <button
              className="ghost"
              disabled={disabled || history.loading || history.loadingMore}
              onClick={() => void history.loadMore()}
            >
              {history.loadingMore ? '正在加载更多 PRD 修订…' : '加载更多 PRD 修订'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
