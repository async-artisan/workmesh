import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import type { ActionBindingInput } from '../api/auth';
import { ApiError, formatApiError } from '../api/client';
import {
  projectApi,
  workspaceApi,
  type Confirmation,
  type MemberView,
  type ProjectRepositoryView,
  type WorkspaceDefinitionView,
} from '../api/resources';
import { DeclareRepositoryDialog } from '../components/DeclareRepositoryDialog';
import { EmptyState } from '../components/EmptyState';
import { EnrollmentCodeDialog } from '../components/EnrollmentCodeDialog';
import { ErrorState } from '../components/ErrorState';
import { PageState } from '../components/PageState';
import { ProjectSelect } from '../components/ProjectSelect';
import { ProjectReadiness } from '../components/ProjectReadiness';
import { StaleDataBanner } from '../components/StaleDataBanner';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import {
  WorkspaceDefinitionEditor,
  layoutKindLabel,
} from '../components/WorkspaceDefinitionEditor';
import { useProjectContext } from '../hooks/useProjectContext';
import { formatDateTime } from '../lib/datetime';
import { useAuthStore } from '../store/auth';

function hasCode(error: ApiError, code: string): boolean {
  return error.code === code || error.message === code;
}

/** 仓库归档错误说明（§13.3）：与声明共享同样的版本/票据/权限语义。 */
function describeArchiveError(error: unknown): string {
  if (!(error instanceof ApiError)) return formatApiError(error);
  if (hasCode(error, 'PROJECT_VERSION_CONFLICT'))
    return '项目版本已变化（可能有并发声明、归档或发布）。请刷新后重试；旧版本不会被接受。';
  if (hasCode(error, 'PROJECT_ARCHIVED')) return '项目已归档，不能再归档仓库。';
  if (hasCode(error, 'PROJECT_MANAGER_REQUIRED') || error.status === 403)
    return '需要项目 OWNER/ADMIN 权限才能归档仓库。';
  if (hasCode(error, 'CONFIRMATION_USED'))
    return '确认票据已被使用：请重新点击归档并再次验证密码。';
  if (hasCode(error, 'CONFIRMATION_EXPIRED') || hasCode(error, 'CONFIRMATION_INVALID'))
    return '确认票据已失效：请重新点击归档，重新完成密码验证。';
  if (hasCode(error, 'IDEMPOTENCY_DIGEST_CONFLICT') || hasCode(error, 'IDEMPOTENCY_CONFLICT'))
    return '同一幂等键提交了不同内容，服务端已拒绝；请重新发起归档。';
  if (error.status === 404) return '仓库不存在或已跨项目归档；请刷新仓库列表。';
  if (error.status === 429)
    return error.retryAfterSeconds !== null
      ? `请求过于频繁，请在 ${error.retryAfterSeconds} 秒后重试。`
      : '请求过于频繁，请稍后重试。';
  return formatApiError(error);
}

/** 只按服务端字段保守判断；DECLARED 行不可能被展示成 provider 已验证。 */
function repositoryIdentityMode(repo: ProjectRepositoryView): 'DECLARED' | 'PROVIDER' {
  if (repo.identityMode) return repo.identityMode;
  return repo.adapter && repo.externalId ? 'PROVIDER' : 'DECLARED';
}

interface RepositoryIdentityText {
  label: string;
  detail: string;
}

function repositoryIdentity(repo: ProjectRepositoryView): RepositoryIdentityText {
  const mode = repositoryIdentityMode(repo);
  const provider = repo.provider ?? (repo.adapter && repo.externalId ? repo : null);
  if (mode === 'PROVIDER') {
    const providerRef = provider
      ? `${provider.adapter} · ${provider.externalId}`
      : 'provider 身份字段缺失';
    if (repo.lastVerifiedStatus === 'PROVIDER_VERIFIED') {
      return {
        label: '托管方已核验',
        detail: `${providerRef}${
          repo.lastVerifiedAt ? ` · 最后核验 ${formatDateTime(repo.lastVerifiedAt)}` : ''
        }`,
      };
    }
    return {
      label: '托管方登记身份（无核验记录）',
      detail: providerRef,
    };
  }
  return {
    label: '人工声明 · 未由托管方核验',
    detail:
      'DECLARED 仅表示 HUMAN 声明的受控 locator，不是 provider 验证，也不能作为强代码签字证据。',
  };
}

/**
 * 项目接入与工作区（T9 最小页面）：
 * 仓库列表/声明/归档、工作区定义草稿/校验/发布、一次性接入码。
 *
 * 边界：
 * - 只展示服务端事实，不展示也不伪造本机实时绑定/健康状态；
 * - 成员只读仓库与定义，任意活跃成员可生成接入码（§21.1 冻结）；
 * - DECLARED 永远显示“未由托管方核验”，P0a 不执行真实 provider 核验。
 */
export function ProjectWorkspace() {
  const navigate = useNavigate();
  const { projectId, project } = useProjectContext();
  const currentUser = useAuthStore((state) => state.user);
  const [repositories, setRepositories] = useState<ProjectRepositoryView[]>([]);
  const [definition, setDefinition] = useState<WorkspaceDefinitionView | null>(null);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [declareOpen, setDeclareOpen] = useState(false);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ProjectRepositoryView | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [errorProjectId, setErrorProjectId] = useState<string | null>(null);
  const activeProjectIdRef = useRef(projectId);
  const projectEpochRef = useRef(0);
  const loadRequestIdRef = useRef(0);
  const mountedRef = useRef(true);

  // Invalidate old work during the render that observes a project change. This
  // closes the gap before the effect below clears project-scoped state.
  if (activeProjectIdRef.current !== projectId) {
    activeProjectIdRef.current = projectId;
    projectEpochRef.current += 1;
    loadRequestIdRef.current += 1;
  }
  const renderProjectEpoch = projectEpochRef.current;

  async function load(): Promise<void> {
    const requestedProjectId = projectId;
    if (
      requestedProjectId !== activeProjectIdRef.current ||
      renderProjectEpoch !== projectEpochRef.current
    )
      return;
    const requestedEpoch = renderProjectEpoch;
    const requestId = ++loadRequestIdRef.current;
    const isCurrentRequest = () =>
      mountedRef.current &&
      requestedProjectId === activeProjectIdRef.current &&
      requestedEpoch === projectEpochRef.current &&
      requestId === loadRequestIdRef.current;

    if (!projectId) {
      setRepositories([]);
      setDefinition(null);
      setMembers([]);
      setLoading(false);
      setLoadedProjectId(null);
      setError('');
      setErrorProjectId(null);
      return;
    }
    setLoading(true);
    try {
      const [repositoryList, definitionView, memberList] = await Promise.all([
        workspaceApi.repositories(projectId),
        workspaceApi.definition(projectId),
        projectApi.members(projectId),
      ]);
      if (!isCurrentRequest()) return;
      setRepositories(repositoryList);
      setDefinition(definitionView);
      setMembers(memberList);
      setLoadedProjectId(projectId);
      setError('');
      setErrorProjectId(null);
    } catch (caught) {
      if (!isCurrentRequest()) return;
      setError(formatApiError(caught));
      setErrorProjectId(projectId);
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }

  useEffect(() => {
    setNotice('');
    setReadinessOpen(false);
    setError('');
    setErrorProjectId(null);
    setArchiveError('');
    setArchiveTarget(null);
    setArchiveBusy(false);
    setDeclareOpen(false);
    setEnrollmentOpen(false);
    setRepositories([]);
    setDefinition(null);
    setMembers([]);
    setLoadedProjectId(null);
    void load();
    // load 只依赖 projectId；项目切换时重新加载。
  }, [projectId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const hasCurrentProjectData = loadedProjectId === projectId;
  const currentRepositories = hasCurrentProjectData ? repositories : [];
  const currentDefinition = hasCurrentProjectData ? definition : null;
  const currentMembers = hasCurrentProjectData ? members : [];
  const currentError = errorProjectId === projectId ? error : '';
  const currentLoading = loading || (Boolean(projectId) && !hasCurrentProjectData && !currentError);
  const myMembership = currentMembers.find((member) => member.id === currentUser?.id);
  const canManage = myMembership?.role === 'OWNER' || myMembership?.role === 'ADMIN';
  const configured = currentDefinition?.definitionStatus === 'CONFIGURED';
  const projectVersion = currentDefinition?.projectVersion ?? project?.version ?? null;

  const archiveBinding = useMemo<ActionBindingInput | null>(() => {
    if (!projectId || !archiveTarget || projectVersion === null) return null;
    return {
      action: 'REPOSITORY_ARCHIVE',
      projectId,
      targetType: 'PROJECT_REPOSITORY',
      targetId: archiveTarget.id,
      expectedVersion: projectVersion,
      roleSlot: null,
      payload: { repositoryId: archiveTarget.id },
    };
  }, [archiveTarget, projectId, projectVersion]);

  async function archive(confirmation: Confirmation) {
    if (!projectId || !archiveTarget || projectVersion === null) return;
    const actionProjectId = projectId;
    const actionEpoch = renderProjectEpoch;
    const isCurrentAction = () =>
      mountedRef.current &&
      actionProjectId === activeProjectIdRef.current &&
      actionEpoch === projectEpochRef.current;
    const target = archiveTarget;
    // 先关闭确认框：失败原因保留在仓库卡片里，用户可按提示重试。
    setArchiveTarget(null);
    setArchiveBusy(true);
    setArchiveError('');
    setNotice('');
    try {
      const result = await workspaceApi.archiveRepository(projectId, target.id, {
        expectedProjectVersion: projectVersion,
        confirmation,
      });
      if (!isCurrentAction()) return;
      setNotice(
        `仓库 ${target.owner}/${target.name} 已归档（项目版本 v${result.projectVersion}）。定义中若仍引用该仓库，需要重新编辑并发布。`,
      );
      await load();
    } catch (caught) {
      if (!isCurrentAction()) return;
      setArchiveError(describeArchiveError(caught));
    } finally {
      if (isCurrentAction()) setArchiveBusy(false);
    }
  }

  function renderRepositories() {
    return (
      <div className="table-card" aria-label="项目仓库">
        <div className="card-head">
          <h3>
            代码仓库<small>{currentRepositories.length}</small>
          </h3>
          <span className="card-head-actions">
            {canManage && (
              <button className="primary" onClick={() => setDeclareOpen(true)}>
                <Plus size={14} />
                声明仓库
              </button>
            )}
          </span>
        </div>
        <p className="page-sub">
          新代码统一通过“声明”登记受控 locator（DECLARED）。声明会被审计，但不调用 provider
          API、不写核验状态；DECLARED 不等于“已验证”。
        </p>
        {hasCurrentProjectData && archiveError && (
          <p className="error" role="alert">
            {archiveError}
          </p>
        )}
        {currentRepositories.length === 0 ? (
          configured && currentDefinition?.payload?.layout?.kind === 'NONE' ? (
            <EmptyState
              title="无代码工作区"
              description="当前已发布定义显式声明项目不需要代码仓库（layout.kind: NONE）。"
              hint={
                canManage
                  ? '如果之后项目需要代码，请修改定义并发布新的 revision；不要用空数组替代 NONE。'
                  : '如果项目后续需要代码，请联系项目 OWNER/ADMIN 修改并重新发布定义。'
              }
            />
          ) : (
            <EmptyState
              title="还没有声明代码仓库"
              description="声明受控仓库来源后，才能把它加入工作区定义，供成员按平台稳定 ID 关联本机 checkout。"
              actionLabel={canManage ? '声明仓库' : undefined}
              onAction={canManage ? () => setDeclareOpen(true) : undefined}
              hint={
                canManage
                  ? '只填写仓库地址（HTTPS / SSH）；owner/name 只作展示，不会被当成 externalId。'
                  : '请联系项目 OWNER/ADMIN 声明仓库；成员只能查看仓库与定义。'
              }
            />
          )
        ) : (
          <div className="table-scroll">
            <table className="data-table" aria-label="仓库列表">
              <thead>
                <tr>
                  <th>仓库</th>
                  <th>身份</th>
                  <th>来源 locator</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {currentRepositories.map((repository) => {
                  const identity = repositoryIdentity(repository);
                  const locators = repository.locators ?? [];
                  return (
                    <tr key={repository.id}>
                      <td>
                        <div>
                          {repository.owner}/{repository.name}
                        </div>
                        <small>
                          默认分支 {repository.defaultBranch ?? '—'} · ID{' '}
                          <span className="cell-mono">{repository.id}</span>
                        </small>
                      </td>
                      <td>
                        <span className="status-tag">{identity.label}</span>
                        <div>
                          <small>{identity.detail}</small>
                        </div>
                      </td>
                      <td>
                        {locators.length === 0 ? (
                          <small>服务端未返回 locator</small>
                        ) : (
                          <ul className="detail-list">
                            {locators.map((locator) => (
                              <li key={locator.id}>
                                <span className="cell-mono">{locator.canonicalLocator}</span>
                                {locator.source ? <small>（{locator.source}）</small> : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="col-actions">
                        {canManage ? (
                          <button
                            className="ghost"
                            disabled={archiveBusy}
                            onClick={() => {
                              setArchiveError('');
                              setArchiveTarget(repository);
                            }}
                          >
                            归档
                          </button>
                        ) : (
                          <span className="page-sub">只读</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <section aria-label="接入与工作区">
      <header className="page-head">
        <div>
          <h2>接入与工作区</h2>
          <p className="page-sub">
            声明项目仓库、维护并发布工作区定义，并为成员生成一次性接入码。本页只展示平台共享事实，不展示也不伪造本机实时绑定状态。
          </p>
        </div>
        <div className="page-actions">
          <ProjectSelect
            onChange={() => {
              setNotice('');
              setError('');
              setErrorProjectId(null);
            }}
            onCreateProject={() => navigate('/projects')}
          />
          <button
            className="ghost"
            disabled={!projectId || currentLoading}
            onClick={() => void load()}
          >
            <RefreshCw size={14} />
            {currentLoading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </header>

      {hasCurrentProjectData && notice && <p className="kb-notice">{notice}</p>}

      {projectId && (
        <details
          open={readinessOpen}
          onToggle={(event) => setReadinessOpen(event.currentTarget.open)}
        >
          <summary>查看项目准备清单</summary>
          {readinessOpen && <ProjectReadiness key={projectId} projectId={projectId} />}
        </details>
      )}

      {!projectId && (
        <p className="page-card muted">
          {project?.name ? '正在读取项目…' : '先选择项目，再查看仓库、定义与接入码。'}
        </p>
      )}

      {projectId && currentLoading && !currentDefinition && (
        <PageState state={{ kind: 'loading' }} title="正在读取工作区…" />
      )}

      {projectId && currentError && !currentDefinition && !currentLoading && (
        <ErrorState
          title="工作区数据加载失败"
          message="暂时无法读取项目仓库与工作区定义。"
          detail={currentError}
          onRetry={() => void load()}
          retryAriaLabel="重试加载工作区"
        />
      )}

      {projectId && currentDefinition && currentError && (
        <StaleDataBanner
          message="本次刷新失败，显示的是上次成功读取的工作区数据。"
          onRetry={() => void load()}
          retryAriaLabel="重新加载工作区"
        />
      )}

      {projectId && currentDefinition && (
        <>
          <div className="project-detail-grid">
            <div className="table-card">
              <div className="card-head">
                <h3>定义状态</h3>
                <span className="card-head-actions">
                  <span className="status-tag">
                    {configured ? '已配置（CONFIGURED）' : '未配置（PROJECT_UNCONFIGURED）'}
                  </span>
                </span>
              </div>
              {configured ? (
                <dl className="detail-list">
                  <li>当前已发布 revision：v{currentDefinition.revisionNo ?? '—'}</li>
                  <li>
                    定义摘要：<span className="cell-mono">{currentDefinition.digest ?? '—'}</span>
                  </li>
                  <li>
                    发布时间：
                    {currentDefinition.publishedAt
                      ? formatDateTime(currentDefinition.publishedAt)
                      : '—'}
                  </li>
                  <li>布局类型：{layoutKindLabel(currentDefinition.payload?.layout?.kind)}</li>
                  <li>定义中的仓库：{currentDefinition.repositories.length} 个</li>
                </dl>
              ) : (
                <p className="page-sub">
                  项目还没有已发布的工作区定义。服务端返回 200 +
                  NOT_CONFIGURED，仅用于展示与引导发布；该状态不能生成接入码，也不能执行 workspace
                  init --join。
                </p>
              )}
            </div>

            <div className="table-card">
              <div className="card-head">
                <h3>当前权限</h3>
              </div>
              {canManage ? (
                <p className="page-sub">
                  你在本项目的角色是 <strong>{myMembership?.role}</strong>
                  ：可以声明/归档仓库、编辑、校验并发布工作区定义，也可以生成接入码。
                </p>
              ) : (
                <p className="page-sub">
                  你在本项目的角色是 <strong>{myMembership?.role ?? '未知'}</strong>
                  ：仓库与定义为只读。任意活跃 HUMAN
                  项目成员都可以生成一次性接入码；接入码本身不授予任何权限。
                </p>
              )}
              <p className="page-sub">
                项目版本 v{currentDefinition.projectVersion} · 定义版本 v
                {currentDefinition.definitionVersion}
                。所有写操作都由服务端按 OWNER/ADMIN、CAS 与一次性票据再次校验。
              </p>
            </div>
          </div>

          {!configured && (
            <div className="table-card" role="status">
              <div className="card-head">
                <h3>工作区定义尚未发布</h3>
              </div>
              <p className="page-sub">
                未发布定义前不能签发接入码。无代码项目必须显式发布 layout.kind = NONE（repositories:
                []），而不是留下空 JSON 当作已发布 revision。成员仍可在现有知识/PRD 权限内工作。
              </p>
              {canManage ? (
                <p className="page-sub">
                  请在下方选择布局、加入已声明仓库、校验并保存草稿，然后用一次性票据发布首个
                  revision。
                </p>
              ) : (
                <p className="page-sub">等待项目 OWNER/ADMIN 发布定义后再生成接入码。</p>
              )}
            </div>
          )}

          {renderRepositories()}

          <WorkspaceDefinitionEditor
            projectId={projectId}
            projectVersion={projectVersion}
            definition={currentDefinition}
            repositories={currentRepositories}
            canWrite={canManage}
            onPublished={(result) => {
              if (
                !mountedRef.current ||
                projectId !== activeProjectIdRef.current ||
                renderProjectEpoch !== projectEpochRef.current
              )
                return;
              setNotice(
                `工作区定义已发布：revision v${result.revisionNo}，摘要 ${result.digest}，定义版本 v${result.definitionVersion}（项目版本 v${result.projectVersion}）。`,
              );
            }}
            onChanged={async () => {
              if (
                !mountedRef.current ||
                projectId !== activeProjectIdRef.current ||
                renderProjectEpoch !== projectEpochRef.current
              )
                return;
              await load();
            }}
          />

          <div className="table-card" aria-label="接入码">
            <div className="card-head">
              <h3>接入码</h3>
            </div>
            <p className="page-sub">
              接入码用于本机 workspace init --join：解析项目与签发时的已发布
              revision，再走设备授权。码随机、短时、一次使用；明文只显示一次，
              重新生成会让旧码作废。码不授予成员、知识、仓库或 Agent 权限。
            </p>
            <div className="toolbar">
              <button
                className="primary"
                disabled={!configured}
                title={configured ? undefined : '项目尚未发布工作区定义，不能生成接入码'}
                onClick={() => setEnrollmentOpen(true)}
              >
                生成接入码
              </button>
              {!configured && <span className="page-sub">发布工作区定义后才能生成接入码。</span>}
            </div>
            <p className="page-sub" role="note">
              本页不展示本机仓库映射或实时接入状态。浏览器未连接本地桥接能力时，请在本机完成接入后运行
              workspace status 查看；Web 不伪造本机健康状态。
            </p>
          </div>
        </>
      )}

      <DeclareRepositoryDialog
        open={declareOpen && hasCurrentProjectData}
        projectId={projectId}
        projectVersion={projectVersion}
        onClose={() => setDeclareOpen(false)}
        onDeclared={async () => {
          if (
            !mountedRef.current ||
            projectId !== activeProjectIdRef.current ||
            renderProjectEpoch !== projectEpochRef.current
          )
            return;
          await load();
        }}
      />

      <EnrollmentCodeDialog
        open={enrollmentOpen && hasCurrentProjectData}
        projectId={projectId}
        onClose={() => setEnrollmentOpen(false)}
      />

      <ConfirmationPrompt
        open={hasCurrentProjectData && Boolean(archiveTarget) && Boolean(archiveBinding)}
        title="归档代码仓库"
        description={
          archiveTarget
            ? `将归档仓库 ${archiveTarget.owner}/${archiveTarget.name}。归档不是删除历史，但依赖该仓库的新交付需要重新登记来源。`
            : ''
        }
        targetLabel={archiveTarget ? `${archiveTarget.owner}/${archiveTarget.name}` : ''}
        binding={archiveBinding}
        submitLabel="确认归档仓库"
        impact={[
          '归档后该仓库不再出现在活动仓库列表，也不能再被新的工作区定义引用。',
          '已发布定义中若仍引用它，需要 OWNER/ADMIN 编辑并发布新的 revision。',
          '归档通过项目版本 CAS + 一次性票据执行，版本变化会被拒绝。',
        ]}
        onClose={() => setArchiveTarget(null)}
        onConfirmed={archive}
      />
    </section>
  );
}
