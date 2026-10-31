import { useProjectContext } from '../hooks/useProjectContext';

interface ProjectSelectProps {
  label?: string;
  className?: string;
  /** 切换项目后的附加处理（清空页面内选中态等） */
  onChange?: (projectId: string) => void;
}

export function ProjectSelect({ label = '选择项目', className, onChange }: ProjectSelectProps) {
  const { projects, projectId, setProjectId, loading, error } = useProjectContext();

  const handle = (next: string) => {
    setProjectId(next);
    onChange?.(next);
  };

  if (error) {
    return (
      <span className="field-error" role="alert">
        {error}
      </span>
    );
  }

  return (
    <select
      aria-label={label}
      className={`select${className ? ` ${className}` : ''}`}
      value={projectId}
      disabled={loading || projects.length === 0}
      onChange={(event) => handle(event.target.value)}
    >
      {projects.length === 0 && (
        <option value="">{loading ? '正在加载项目…' : '还没有可访问的项目'}</option>
      )}
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}（{project.key}）
        </option>
      ))}
    </select>
  );
}
