import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { workflowApi, type WorkflowRevisionView } from '../api/resources';
import {
  checkPeople,
  checkPublishedKnowledge,
  checkWorkspace,
  loadProjectReadiness,
  readReadiness,
  type ProjectReadinessSnapshot,
  type ReadinessCheck,
  type ReadinessState,
} from '../lib/projectReadiness';

const stateLabels: Record<ReadinessState, string> = {
  READY: '已具备',
  MISSING: '待准备',
  UNKNOWN: '待确认',
  NOT_REQUIRED: '无需此项',
};

/** 只读准备清单；入口均保留项目 ID，无法读取的数据保留为待确认。 */
export function ProjectReadiness({ projectId }: { projectId: string }) {
  const [snapshot, setSnapshot] = useState<ProjectReadinessSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selectedKey, setSelectedKey] = useState('');
  const [revision, setRevision] = useState<WorkflowRevisionView | null>(null);
  const [revisionError, setRevisionError] = useState('');
  const [knowledge, setKnowledge] = useState<ReadinessCheck>({
    state: 'UNKNOWN',
    detail: '请选择已发布流程后核对其必需资料。',
  });
  const [revisionLoading, setRevisionLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSnapshot(null);
    setRevision(null);
    void loadProjectReadiness(projectId).then((value) => {
      if (cancelled) return;
      setSnapshot(value);
      if (value.definitions.ok) {
        const published = value.definitions.value.items.filter(
          (item) => item.currentPublishedRevisionId,
        );
        setSelectedKey((previous) =>
          published.some((item) => item.workflowKey === previous)
            ? previous
            : (published[0]?.workflowKey ?? ''),
        );
      } else setSelectedKey('');
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, refresh]);

  const published = snapshot?.definitions.ok
    ? snapshot.definitions.value.items.filter((item) => item.currentPublishedRevisionId)
    : [];
  const selected = published.find((item) => item.workflowKey === selectedKey);
  const revisionId = selected?.currentPublishedRevisionId;

  useEffect(() => {
    const request = ++requestRef.current;
    setRevision(null);
    setRevisionError('');
    setKnowledge({ state: 'UNKNOWN', detail: '请选择已发布流程后核对其必需资料。' });
    if (!revisionId || !snapshot) {
      setRevisionLoading(false);
      return;
    }
    setRevisionLoading(true);
    void readReadiness(workflowApi.revision(revisionId)).then(async (result) => {
      if (requestRef.current !== request) return;
      if (!result.ok) {
        setRevisionError(result.reason);
        setRevisionLoading(false);
        return;
      }
      if (result.value.projectId !== projectId) {
        setRevisionError('流程修订与当前项目不一致，请刷新后由管理员确认。');
        setRevisionLoading(false);
        return;
      }
      setRevision(result.value);
      const checked = await checkPublishedKnowledge(projectId, result.value, snapshot.bindings);
      if (requestRef.current !== request) return;
      setKnowledge(checked);
      setRevisionLoading(false);
    });
    return () => {
      requestRef.current += 1;
    };
  }, [projectId, revisionId, snapshot]);

  const waiting: ReadinessCheck = {
    state: 'UNKNOWN',
    detail: loading ? '正在读取项目资料…' : '尚不能确认，请刷新或联系管理员。',
  };
  const definitionUncertainty =
    revisionError ||
    (snapshot && !snapshot.definitions.ok
      ? snapshot.definitions.reason
      : snapshot?.definitions.ok && !selected && snapshot.definitions.value.nextCursor
        ? '流程列表尚未完整读取，暂时不能确定本项目的角色和资料要求。'
        : '');
  const people = snapshot
    ? definitionUncertainty
      ? { state: 'UNKNOWN' as const, detail: definitionUncertainty }
      : checkPeople(snapshot.members, snapshot.roles, revision)
    : waiting;
  const workspaceFact = snapshot
    ? checkWorkspace(snapshot.workspace, snapshot.repositories, revision)
    : waiting;
  const workspace =
    workspaceFact.state === 'READY' && (definitionUncertainty || (selected && !revision))
      ? {
          state: 'UNKNOWN' as const,
          detail: `${workspaceFact.detail} 选定流程的实现要求尚不可确认，请重试读取流程。`,
        }
      : workspaceFact;
  const workflow: ReadinessCheck = !snapshot
    ? waiting
    : !snapshot.definitions.ok
      ? { state: 'UNKNOWN', detail: snapshot.definitions.reason }
      : selected
        ? {
            state: 'READY',
            detail: `已选择 ${selected.title}，当前发布修订 v${selected.currentRevision}。新实例使用该修订，已有实例保持原修订。`,
          }
        : snapshot.definitions.value.nextCursor
          ? {
              state: 'UNKNOWN',
              detail: '当前页没有已发布流程，但还有未读取的列表页；请在流程页继续确认。',
            }
          : {
              state: 'MISSING',
              detail: '还没有已发布流程。载入模板、准备资料并校验，通过人工确认后发布。',
            };
  const firstTask: ReadinessCheck = !snapshot
    ? waiting
    : !snapshot.board.ok
      ? { state: 'UNKNOWN', detail: snapshot.board.reason }
      : typeof snapshot.board.value.summary?.total !== 'number'
        ? { state: 'UNKNOWN', detail: '任务接口未返回总数，暂时无法确认是否已有任务。' }
        : snapshot.board.value.summary.total > 0
          ? {
              state: 'READY',
              detail: `项目已有 ${snapshot.board.value.summary.total} 个任务。到看板或需求详情查看负责人、前置条件和下一步。`,
            }
          : {
              state: 'MISSING',
              detail:
                '还没有任务。创建需求并完成 PRD 发布后，在需求详情用已发布流程创建实例，分配责任人与签字人。',
            };
  const withProject = (path: string) => `${path}?projectId=${encodeURIComponent(projectId)}`;
  const rows = [
    {
      key: 'people',
      title: '安排人员与独立签字',
      check: revisionLoading ? { ...waiting, detail: '正在按选定流程核对角色与签字槽…' } : people,
      path: '/roles',
      action: '安排角色人员',
    },
    {
      key: 'knowledge',
      title: '准备已发布并绑定的知识',
      check: revisionLoading
        ? { ...waiting, detail: '正在核对已发布知识和角色绑定…' }
        : definitionUncertainty
          ? { state: 'UNKNOWN' as const, detail: definitionUncertainty }
          : knowledge,
      path: '/workflows',
      action: '选择资料与绑定',
    },
    {
      key: 'workspace',
      title: '配置仓库与工作区',
      check: workspace,
      path: '/workspace',
      action: '配置工作区',
    },
    {
      key: 'workflow',
      title: '发布可用流程',
      check: workflow,
      path: '/workflows',
      action: '配置与发布流程',
    },
    {
      key: 'task',
      title: '创建首次任务',
      check: firstTask,
      path: firstTask.state === 'READY' ? '/board' : '/requirements',
      action: firstTask.state === 'READY' ? '查看项目任务' : '创建需求与任务',
    },
  ];

  return (
    <section className="table-card" aria-label="项目准备清单">
      <div className="card-head">
        <h3>项目准备清单</h3>
        <button
          className="ghost"
          disabled={loading || revisionLoading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          刷新准备状态
        </button>
      </div>
      <p className="page-sub">
        按人员、资料、工作区、流程、任务依次准备。清单按当前账号可读取的平台事实核对；访问受限或读取失败保留为待确认，不代表未配置。
        角色分配、资料绑定和工作区发布由项目 OWNER/ADMIN 操作，普通成员可查看并请管理员补齐。
      </p>
      {published.length > 0 && (
        <label className="field">
          <span>按哪个流程核对</span>
          <select
            aria-label="准备清单使用的流程"
            value={selectedKey}
            disabled={loading}
            onChange={(event) => setSelectedKey(event.target.value)}
          >
            {published.map((item) => (
              <option key={item.workflowKey} value={item.workflowKey}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {snapshot?.definitions.ok && snapshot.definitions.value.nextCursor && (
        <p className="page-sub">这里只展示当前页流程；其余定义请在流程配置页查看。</p>
      )}
      {(loading || revisionLoading) && (
        <p className="page-sub" role="status">
          正在核对项目准备状态…
        </p>
      )}
      <ol className="detail-list">
        {rows.map((row) => (
          <li key={row.key} aria-label={row.title}>
            <div className="card-head">
              <strong>{row.title}</strong>
              <span className="status-tag">{stateLabels[row.check.state]}</span>
            </div>
            <p className="page-sub">{row.check.detail}</p>
            <Link to={withProject(row.path)}>{row.action}</Link>
          </li>
        ))}
      </ol>
      <p className="page-sub">
        清单不会替代任务领取、知识访问与人工签字的服务端校验；仓库和工作区状态不包含本机接入情况。
      </p>
    </section>
  );
}
