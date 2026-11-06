import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, GitBranch, Plus, RefreshCw } from 'lucide-react';
import { formatApiError } from '../api/client';
import {
  projectApi,
  repositoryApi,
  workflowApi,
  type MemberView,
  type ProjectRepositoryView,
  type ProjectView,
  type WorkflowDefinitionView,
} from '../api/resources';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { PageState } from '../components/PageState';
import { StaleDataBanner } from '../components/StaleDataBanner';
import { useProjectStore } from '../store/project';

type SectionKey = 'overview' | 'repositories' | 'members';

const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'repositories', label: '代码仓库' },
  { key: 'members', label: '成员' },
];

/**
 * 项目详情：把原先散落在全局页与初始化弹窗里的仓库登记、成员入口集中到 /projects/:id。
 * 三态（加载 / 失败重试 / 正常）与页面其他列表保持一致。
 */
export function ProjectDetail({ projectId: routeProjectId }: { projectId?: string } = {}) {
  const params = useParams();
  const projectId = routeProjectId ?? params.projectId ?? '';
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [repositories, setRepositories] = useState<ProjectRepositoryView[]>([]);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [definitions, setDefinitions] = useState<WorkflowDefinitionView[]>([]);
  const [section, setSection] = useState<SectionKey>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);

  // 进入项目详情即把项目上下文切到这个项目，后续需求/看板/知识库都落在同一项目。
  useEffect(() => {
    if (projectId) useProjectStore.getState().setProjectId(projectId);
  }, [projectId]);

  const load = async (): Promise<boolean> => {
    if (!projectId) {
      setLoading(false);
      setError('缺少项目 ID，请从项目列表进入。');
      return false;
    }
    setLoading(true);
    try {
      const [projectList, repositoryList, memberList, definitionPage] = await Promise.all([
        projectApi.list(),
        repositoryApi.list(projectId),
        projectApi.members(projectId),
        workflowApi.listDefinitions(projectId),
      ]);
      const found = projectList.find((item) => item.id === projectId) ?? null;
      if (!found) {
        setProject(null);
        setError('项目不存在，或你没有访问权限。');
        return false;
      }
      setProject(found);
      setRepositories(repositoryList);
      setMembers(memberList);
      setDefinitions(definitionPage.items);
      setError('');
      setStale(false);
      return true;
    } catch (caught) {
      setError(formatApiError(caught));
      setStale(Boolean(project));
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // load 只依赖 projectId；项目上下文切换时重新加载。
  }, [projectId]);

  function goTo(path: string) {
    navigate(path);
  }

  if (loading && !project) {
    return <PageState state={{ kind: 'loading' }} title="正在读取项目…" />;
  }
  if (!project) {
    return (
      <ErrorState
        title="项目加载失败"
        message={error || '暂时无法读取项目。'}
        onRetry={() => void load()}
        retryAriaLabel="重试加载项目"
      />
    );
  }

  const repositoryCounts = repositories.length;
  const decisionLinks = [
    { label: '需求', path: '/requirements' },
    { label: '看板', path: '/board' },
    { label: '知识库', path: '/knowledge' },
    { label: 'PRD', path: '/prd' },
    { label: '流程', path: '/workflows' },
    { label: '角色 / ACL', path: '/roles' },
  ];

  return (
    <section className="project-detail" aria-label="项目详情">
      <header className="page-head">
        <div>
          <span className="req-code">{project.key}</span>
          <h2>{project.name}</h2>
          <p className="page-sub">
            {project.description || '还没有项目描述。'} · 版本 v{project.version}
          </p>
        </div>
        <div className="page-actions">
          <button className="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} />
            {loading ? '刷新中…' : '刷新'}
          </button>
          <button className="ghost" onClick={() => goTo('/projects')}>
            <ArrowLeft size={14} />
            返回项目
          </button>
        </div>
      </header>

      {stale && (
        <StaleDataBanner
          message="本次刷新失败，显示的是上次成功加载的项目数据。"
          onRetry={() => void load()}
          retryAriaLabel="重新加载项目"
        />
      )}

      <nav className="project-detail-tabs" aria-label="项目详情分区">
        <div role="tablist" className="wb-tabs">
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={section === item.key}
              className={`wb-tab${section === item.key ? ' is-active' : ''}`}
              onClick={() => setSection(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="project-detail-links">
          {decisionLinks.map((link) => (
            <button key={link.path} className="ghost" onClick={() => goTo(link.path)}>
              {link.label}
            </button>
          ))}
        </div>
      </nav>

      {section === 'overview' && (
        <div className="project-detail-grid">
          <div className="table-card">
            <div className="card-head">
              <h3>项目信息</h3>
            </div>
            <dl className="detail-list">
              <li>项目 Key：{project.key}</li>
              <li>项目版本：v{project.version}</li>
              <li>代码仓库：{repositoryCounts} 个</li>
              <li>成员：{members.length} 人</li>
              <li>流程定义：{definitions.length} 个</li>
            </dl>
            <p className="page-sub">
              {repositories.length === 0
                ? '还没有登记代码仓库；登记后 Agent 交付会关联仓库与提交。'
                : `已登记仓库：${repositories.map((repo) => `${repo.owner}/${repo.name}`).join('、')}`}
            </p>
          </div>
          <div className="table-card">
            <div className="card-head">
              <h3>流程定义</h3>
            </div>
            {definitions.length === 0 ? (
              <EmptyState
                title="还没有流程定义"
                description="项目创建后可在流程页载入标准模板并发布。"
                actionLabel="打开流程"
                onAction={() => goTo('/workflows')}
              />
            ) : (
              <div className="wb-list">
                {definitions.map((definition) => (
                  <div className="wb-row" key={definition.workflowKey}>
                    <div className="wb-row-main">
                      <div className="wb-row-top">
                        <span className="wb-type">流程</span>
                        <span className="wb-row-context">{definition.title}</span>
                      </div>
                      <div className="wb-row-detail">
                        当前修订 v{definition.currentRevision} ·{' '}
                        {definition.currentPublishedRevisionId ? '已发布' : '未发布'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {section === 'repositories' && (
        <div className="table-card">
          <div className="card-head">
            <h3>
              代码仓库<small>{repositories.length}</small>
            </h3>
            <span className="card-head-actions">
              <button className="primary" onClick={() => goTo('/workspace')}>
                <Plus size={14} />
                登记仓库
              </button>
            </span>
          </div>
          {repositories.length === 0 ? (
            <EmptyState
              title="还没有登记代码仓库"
              description="在“接入与工作区”声明仓库后，任务交付、代码引用与评审证据都会指向该仓库。"
              hint="仓库通过 canonical locator 声明；不再使用 owner/name 伪造外部 ID。"
              actionLabel="登记仓库"
              onAction={() => goTo('/workspace')}
            />
          ) : (
            <div className="wb-list">
              {repositories.map((repository) => (
                <div className="wb-row" key={repository.id}>
                  <div className="wb-row-main">
                    <div className="wb-row-top">
                      <span className="wb-type">仓库</span>
                      <span className="wb-row-context">
                        {repository.owner}/{repository.name}
                      </span>
                    </div>
                    <div className="wb-row-detail">
                      默认分支 {repository.defaultBranch} · {repository.adapter}
                      {repository.externalId ? ` · ${repository.externalId}` : ''}
                    </div>
                  </div>
                  <div className="wb-row-actions">
                    <a
                      className="ghost"
                      href={`https://github.com/${repository.owner}/${repository.name}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <GitBranch size={14} />
                      打开仓库
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {section === 'members' && (
        <div className="table-card">
          <div className="card-head">
            <h3>
              成员<small>{members.length}</small>
            </h3>
            <span className="card-head-actions">
              <button className="ghost" onClick={() => goTo('/roles')}>
                管理角色 / ACL
              </button>
            </span>
          </div>
          {members.length === 0 ? (
            <EmptyState
              title="还没有成员"
              description="邀请成员后，他们才能在需求、评审与看板中看到这个项目。"
              actionLabel="邀请成员"
              onAction={() => goTo('/roles')}
            />
          ) : (
            <ul className="project-member-list">
              {members.map((member) => (
                <li key={member.id} className="project-member-row">
                  <div>
                    <strong>{member.name || member.email}</strong>
                    {member.name && member.name !== member.email && <small>{member.email}</small>}
                  </div>
                  <div className="project-member-roles">
                    <span className="status-tag">{member.role}</span>
                    {(member.roles ?? []).map((role) => (
                      <span className="status-tag" key={role.id}>
                        {role.title}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
