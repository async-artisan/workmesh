import { useProjectContext } from '../hooks/useProjectContext';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { StaleDataBanner } from './StaleDataBanner';

interface ProjectSelectProps {
  label?: string;
  className?: string;
  /** 切换项目后的附加处理（清空页面内选中态等） */
  onChange?: (projectId: string) => void;
  /** 空态主操作：当前页面能创建项目时才传；不传时说明等待原因，不留死胡同。 */
  onCreateProject?: () => void;
  /** 空态次操作：当前页面能接受邀请时才传。 */
  onAcceptInvite?: () => void;
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
  onAcceptInvite,
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
  // 当前选中的项目可能刚被移除、尚未回落到第一个可访问项目；此时按第一个展示，避免空 value。
  const selectedValue = projects.some((project) => project.id === projectId)
    ? projectId
    : (projects[0]?.id ?? '');

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
          message="暂时无法读取项目列表。"
          detail={errorDetail}
          onRetry={() => void refreshProjects()}
          retryAriaLabel="重试加载项目列表"
        />
      </div>
    );
  }

  // 2）首次加载：禁用选择器并给出加载文案。
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
      </div>
    );
  }

  // 3）成功但没有任何可访问项目：给出创建 / 邀请入口，或说明等待原因。
  if (!hasProjects && loaded) {
    return (
      <div className="wm-project-select">
        <EmptyState
          title="还没有可访问的项目"
          description="你可以创建项目，或通过邀请加入已有项目。"
          actionLabel={onCreateProject ? '创建项目' : undefined}
          onAction={onCreateProject}
          secondaryActionLabel={onAcceptInvite ? '接受邀请' : undefined}
          onSecondaryAction={onAcceptInvite}
          hint={onCreateProject || onAcceptInvite ? undefined : NO_ENTRY_HINT}
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
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}（{project.key}）
          </option>
        ))}
      </select>
    </div>
  );
}
