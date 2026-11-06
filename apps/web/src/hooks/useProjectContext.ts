import { useContext, useEffect, useMemo } from 'react';
import { useProjectStore } from '../store/project';
import { ProjectUrlContext } from '../components/ProjectContextBoundary';

/**
 * 统一项目上下文：页面与 ProjectSelect 共用同一份 store，跨页面保持一致。
 *
 * - 挂载时按需加载（已成功加载过则复用，不重复请求；失败后不自动无限重试，由用户显式刷新）；
 * - URL 项目优先；只有未显式指定项目时，store 才会修正失效的本地记忆；
 * - 保留旧页面依赖的字段名（projects / projectId / setProjectId / loading / error）。
 */
export function useProjectContext() {
  const projects = useProjectStore((state) => state.projects);
  const url = useContext(ProjectUrlContext);
  const storedProjectId = useProjectStore((state) => state.projectId);
  const projectId = url?.projectId ?? storedProjectId;
  const loading = useProjectStore((state) => state.loading);
  const loaded = useProjectStore((state) => state.loaded);
  const error = useProjectStore((state) => state.error);
  const errorDetail = useProjectStore((state) => state.errorDetail);
  const updatedAt = useProjectStore((state) => state.updatedAt);
  const setStoredProjectId = useProjectStore((state) => state.setProjectId);
  const setProjectId = url?.setProjectId ?? setStoredProjectId;
  const ensureProjects = useProjectStore((state) => state.ensureProjects);
  const refreshProjects = useProjectStore((state) => state.refreshProjects);

  useEffect(() => {
    // 只在挂载时触发一次；ensureProjects 内部会做 loaded / 并发去重。
    void ensureProjects();
  }, [ensureProjects]);

  const project = useMemo(
    () => projects.find((item) => item.id === projectId) ?? null,
    [projects, projectId],
  );

  return {
    projects,
    projectId,
    project,
    // 首次加载还没有结果时同样视为加载中，保持旧页面 `loading` 的语义。
    loading: loading || (!loaded && !error),
    loaded,
    error,
    errorDetail,
    updatedAt,
    setProjectId,
    refreshProjects,
  };
}
