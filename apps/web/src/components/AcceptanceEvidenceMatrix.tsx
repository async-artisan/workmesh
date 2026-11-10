import { useEffect, useMemo, useState } from 'react';
import { artifactApi, type ArtifactSetView } from '../api/resources';
import { ApiError, formatApiError } from '../api/client';
import {
  buildAcceptanceEvidenceMapping,
  isQualityJsonCandidate,
  parseQualityArtifact,
  safeEvidenceUrl,
  type AcceptanceCriterion,
  type QualityArtifactSource,
} from '../lib/acceptanceEvidence';

const rowLabels = {
  REPORTED_PASS: '报告通过，待人工核验',
  FAILED: '有失败报告',
  BLOCKED: '有阻塞报告',
  NOT_RUN: '尚未执行',
  MISSING: '缺少关联证据',
  NEEDS_REVIEW: '版本或覆盖待核对',
  UNKNOWN: '证据待确认',
};
const resultLabels = {
  PASSED: '提交者报告通过',
  FAILED: '报告失败',
  BLOCKED: '报告阻塞',
  NOT_RUN: '未执行',
};
const basisLabels = {
  MATCHED: '版本字段匹配',
  MISMATCH: '版本或条款不匹配',
  UNVERIFIED: '版本依据待核对',
};

export function AcceptanceEvidenceMatrix({
  acceptance,
  requirementId,
  prdRevisionId,
  artifactSet,
}: {
  acceptance: AcceptanceCriterion[];
  requirementId: string | null;
  prdRevisionId: string | null;
  artifactSet: ArtifactSetView | null;
}) {
  const [sources, setSources] = useState<QualityArtifactSource[]>([]);
  const [issues, setIssues] = useState<
    Array<{ artifactId: string; label: string; message: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const candidates = useMemo(
    () => artifactSet?.artifacts.filter(isQualityJsonCandidate) ?? [],
    [artifactSet],
  );

  useEffect(() => {
    let active = true;
    setSources([]);
    setIssues([]);
    if (!artifactSet || !candidates.length) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all(
      candidates.map(async (artifact) => {
        const label = artifact.summary ?? artifact.repoPath ?? artifact.id;
        try {
          const content = await artifactApi.content(artifactSet.id, artifact.id);
          const parsed = parseQualityArtifact(artifact, content);
          return parsed.ok
            ? { source: parsed.source }
            : { issue: { artifactId: artifact.id, label, message: parsed.message } };
        } catch (error) {
          return {
            issue: {
              artifactId: artifact.id,
              label,
              message:
                error instanceof ApiError && [403, 404].includes(error.status)
                  ? '当前账号不可读取这份完整正文；无法确认是否包含关联证据，请联系管理员。'
                  : `完整正文读取失败：${formatApiError(error)}`,
            },
          };
        }
      }),
    ).then((results) => {
      if (!active) return;
      setSources(results.flatMap((result) => (result.source ? [result.source] : [])));
      setIssues(results.flatMap((result) => (result.issue ? [result.issue] : [])));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [artifactSet, candidates, refresh]);

  const mapping = useMemo(
    () =>
      buildAcceptanceEvidenceMapping({
        acceptance,
        requirementId,
        prdRevisionId,
        artifactSet,
        sources,
      }),
    [acceptance, requirementId, prdRevisionId, artifactSet, sources],
  );
  return (
    <section aria-label="验收条件与证据映射">
      <p className="page-sub">
        按已发布 PRD 的验收 key
        对照完整质量包。证据来源与执行结果均为提交者提供；引用内容、测试执行和业务效果仍需人工核验，这张表不会自动批准。
      </p>
      {prdRevisionId && (
        <p className="task-row-meta">
          对照 PRD 修订：<code>{prdRevisionId}</code> · 交付快照：
          <code>{artifactSet?.snapshotId ?? '尚不可读取'}</code>
        </p>
      )}
      {loading && <p role="status">正在读取完整质量包并核对逐条证据…</p>}
      {candidates.length > 0 && (
        <button
          className="ghost"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          重新读取验收映射
        </button>
      )}
      {!candidates.length && artifactSet && (
        <p className="page-sub">
          本次交付没有可识别的 HOSTED JSON 质量包。可将质量包作为当前步骤允许的工件提交，使用
          acceptanceKeys 明确关联；GIT_REF 和普通检查仍需人工对照，不会被分配给每条验收。
        </p>
      )}
      {issues.length > 0 && (
        <ul className="detail-list" aria-label="质量包读取问题">
          {issues.map((issue) => (
            <li key={issue.artifactId}>
              <strong>{issue.label}</strong>：{issue.message}
            </li>
          ))}
        </ul>
      )}
      {sources.map(
        (source) =>
          source.report.issues.some((issue) => issue.severity === 'ERROR') && (
            <details key={source.artifactId}>
              <summary>{source.label} 存在质量包缺口</summary>
              <ul>
                {source.report.issues
                  .filter((issue) => issue.severity === 'ERROR')
                  .map((issue, index) => (
                    <li key={`${issue.location}:${index}`}>
                      {issue.location}：{issue.message}
                    </li>
                  ))}
              </ul>
            </details>
          ),
      )}
      {mapping.unknownAcceptanceKeys.length > 0 && (
        <p className="callout warning">
          证据还引用了当前 PRD 未定义的验收 key：{mapping.unknownAcceptanceKeys.join('、')}
          。这些关联不计入当前验收覆盖。
        </p>
      )}
      {mapping.unlinkedCheckCount > 0 && (
        <p className="page-sub">
          另有 {mapping.unlinkedCheckCount} 项工件检查未提供逐条验收关联，继续在工件区查看。
        </p>
      )}
      <div className="table-wrap">
        <table aria-label="逐条验收证据">
          <thead>
            <tr>
              <th>验收条件</th>
              <th>关联证据与执行结果</th>
              <th>覆盖与版本缺口</th>
            </tr>
          </thead>
          <tbody>
            {mapping.rows.map((row) => (
              <tr key={row.criterion.key}>
                <td>
                  <code>{row.criterion.key}</code>
                  <p>{row.criterion.text}</p>
                  <span className="task-row-meta">{row.criterion.verification}</span>
                </td>
                <td>
                  <span className="status-tag">
                    {loading && !row.evidence.length
                      ? '证据待确认'
                      : issues.length && !row.evidence.length
                        ? '证据待确认'
                        : issues.length && row.status === 'REPORTED_PASS'
                          ? '部分证据待确认'
                          : rowLabels[row.status]}
                  </span>
                  {row.evidence.length > 0 && (
                    <ul className="detail-list">
                      {row.evidence.map((item, index) => {
                        const href = safeEvidenceUrl(item.ref);
                        return (
                          <li key={`${item.artifactId}:${item.id}:${index}`}>
                            <strong>
                              {item.id} · {resultLabels[item.result]}
                            </strong>
                            <p className="task-row-meta">
                              来源：
                              {item.source === 'AGENT_REPORTED'
                                ? 'Agent 自报'
                                : '外部引用（尚未核验）'}{' '}
                              · 质量包：{item.artifactLabel} · {item.stage}
                            </p>
                            <p>
                              证据引用：
                              {href ? (
                                <a href={href} target="_blank" rel="noopener noreferrer">
                                  {item.ref}
                                </a>
                              ) : (
                                <code>{item.ref}</code>
                              )}
                            </p>
                            <details>
                              <summary>
                                {basisLabels[item.basisState]}：查看 PRD / 快照 / commit
                              </summary>
                              <ul className="detail-list">
                                <li>
                                  PRD：<code>{item.basis.prdRevisionId}</code>
                                </li>
                                <li>
                                  快照：<code>{item.basis.snapshotId}</code>
                                </li>
                                <li>
                                  commit：<code>{item.basis.commitSha}</code>
                                </li>
                                {item.issues.map((issue) => (
                                  <li key={issue}>{issue}</li>
                                ))}
                              </ul>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </td>
                <td>
                  {issues.length > 0 && row.evidence.length > 0 && (
                    <p className="task-row-meta">
                      还有质量包不可读取或解析，当前逐条覆盖结论不完整；已读证据仍保留在本行。
                    </p>
                  )}
                  {row.taskIds.length > 0 && (
                    <p className="task-row-meta">质量包任务：{row.taskIds.join('、')}</p>
                  )}
                  {row.caseIds.length > 0 && (
                    <p className="task-row-meta">匹配用例：{row.caseIds.join('、')}</p>
                  )}
                  {row.gaps.length > 0 ? (
                    <ul className="detail-list">
                      {row.gaps.map((gap) => (
                        <li key={gap}>{gap}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="task-row-meta">字段关联已核对；仍须检查原始证据及实际效果。</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
