import { useEffect, useState } from 'react';
import type { ProjectView } from '../api/resources';
import { loadProjects, useProjectStore } from '../store/project';

/**
 * 读取当前项目上下文：项目列表只请求一次（模块级缓存），
 * 选中项目写入 localStorage，跨页面保持一致。
 */
export function useProjectContext() {
  const projectId = useProjectStore((state) => state.projectId);
  const setProjectId = useProjectStore((state) => state.setProjectId);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    loadProjects()
      .then((list) => {
        if (!alive) return;
        setProjects(list);
        setError('');
        setLoading(false);
        if (list.length && !list.some((item) => item.id === projectId)) {
          setProjectId(list[0].id);
        }
      })
      .catch(() => {
        if (!alive) return;
        setError('无法加载项目列表，请检查登录状态。');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // 只在挂载时拉取；项目增删由页面显式刷新
  }, []);

  return { projects, projectId, setProjectId, loading, error };
}
