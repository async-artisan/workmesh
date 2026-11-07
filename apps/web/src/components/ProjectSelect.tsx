import { useProjectContext } from '../hooks/useProjectContext';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { InlineLoading } from './Skeleton';
import { StaleDataBanner } from './StaleDataBanner';

interface ProjectSelectProps {
  label?: string;
  className?: string;
  /** 切换项目后的附加处理（清空页面内选中态等） */
  onChange?: (projectId: string) => void;
  /** 空态主操作：当前页面能创建项目时才传；不传时说明等待原因，不留死胡同。 */
  onCreateProject?: () => void;
}

const NO_ENTRY_HINT = '当前页面没有提供创建或邀请入口，请联系项目管理员，或前往项目列表创建项目。';

/**
 * 统一项目选择器：把“首次加载 / 加载失败 / 成功但为空 / 正常选择 / 刷新失败但保留旧数据”
 * 拆成互斥状态，失败不会被伪装成空列表。
 */
export function ProjectSelect({
  label = '选择项目',
  className,
  onChange,
  onCreateProject,
}: ProjectSelectProps) {
  const {
    projects,
    projectId,
    setProjectId,
    loading,
    loaded,
    error,
    errorDetail,
    updatedAt,
    refreshProjects,
  } = useProjectContext();

  const hasProjects = projects.length > 0;
  const selectClassName = `select${className ? ` ${className}` : ''}`;
  // 保留 URL 的显式选择；不可访问的项目使用下方占位选项提示用户重新选择。
  const selectedValue = projectId;

  const handle = (next: string) => {
    setProjectId(next);
    onChange?.(next);
  };

  // 1）加载失败且没有任何旧数据：页面级错误 + 重试，绝不显示成空列表。
  if (!hasProjects && error) {
    return (
      <div className="wm-project-select">
        <ErrorState
          title="项目列表加载失败"
          message={error}
          detail={errorDetail}
          onRetry={() => void refreshProjects()}
          retryAriaLabel="重试加载项目列表"
        />
      </div>
    );
  }

  // 2）首次加载：禁用选择器并给出可读的加载提示（role="status"），不只靠下拉里的占位文案。
  if (!hasProjects && loading) {
    return (
      <div className="wm-project-select">
        <select
          aria-label={label}
          className={selectClassName}
          value=""
          disabled
          aria-busy="true"
          onChange={() => undefined}
        >
          <option value="">正在加载项目…</option>
        </select>
        <InlineLoading label="正在读取项目…" />
      </div>
    );
  }

  // 3）成功但没有任何可访问项目：给出创建 / 邀请入口，或说明等待原因。
  if (!hasProjects && loaded) {
    return (
      <div className="wm-project-select">
        <EmptyState
          title="还没有可访问的项目"
          description="你可以创建项目；如已有项目管理员邀请你，请打开管理员发送的邀请链接加入已有项目。"
          actionLabel={onCreateProject ? '创建项目' : undefined}
          onAction={onCreateProject}
          hint={onCreateProject ? undefined : NO_ENTRY_HINT}
        />
      </div>
    );
  }

  // 4）有项目：正常选择器；刷新失败时先提示“数据可能已过期”，选择器仍可用。
  return (
    <div className="wm-project-select">
      {error && (
        <StaleDataBanner
          updatedAt={updatedAt}
          message="本次项目列表更新失败，数据可能已经过期。"
          onRetry={() => void refreshProjects()}
        />
      )}
      <select
        aria-label={label}
        className={selectClassName}
        value={selectedValue}
        aria-busy={loading || undefined}
        onChange={(event) => handle(event.target.value)}
      >
        {!projects.some((project) => project.id === projectId) && (
          <option value={projectId}>指定项目不可访问，请重新选择</option>
        )}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}（{project.key}）
          </option>
        ))}
      </select>
      {loading && <InlineLoading label="正在刷新项目列表…" />}
    </div>
  );
}
