import { Fragment, createContext, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useProjectStore } from '../store/project';

export const ProjectUrlContext = createContext<{
  projectId: string;
  setProjectId: (id: string) => void;
} | null>(null);

const PROJECT_PAGES = new Set([
  '/requirements',
  '/pipeline',
  '/prd',
  '/knowledge',
  '/reviews',
  '/roles',
  '/workflows',
  '/board',
]);

/** URL is authoritative. A keyed subtree discards every project-owned view state on switch. */
export function ProjectContextBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const storedId = useProjectStore((state) => state.projectId);
  const projects = useProjectStore((state) => state.projects);
  const loaded = useProjectStore((state) => state.loaded);
  const setStoredId = useProjectStore((state) => state.setProjectId);
  const explicitId = params.get('projectId');
  const scoped =
    PROJECT_PAGES.has(location.pathname) || location.pathname.startsWith('/requirements/');
  const requirementKey = location.pathname.startsWith('/requirements/')
    ? location.pathname.slice('/requirements/'.length)
    : '';
  const routeProject = projects.find((project) => requirementKey.startsWith(`${project.key}-`));
  const projectId = explicitId ?? routeProject?.id ?? storedId;

  useLayoutEffect(() => {
    useProjectStore.setState({ requestedProjectId: explicitId });
    if (explicitId !== null && explicitId !== storedId) setStoredId(explicitId);
    return () => {
      useProjectStore.setState({ requestedProjectId: null });
    };
  }, [explicitId, storedId, setStoredId]);

  useEffect(() => {
    if (!scoped || !loaded || explicitId !== null || !projectId) return;
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('projectId', projectId);
        return next;
      },
      { replace: true },
    );
  }, [scoped, loaded, explicitId, projectId, setParams]);

  const setProjectId = (id: string) => {
    setStoredId(id);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('projectId', id);
      return next;
    });
  };
  const project = projects.find((item) => item.id === projectId);
  return (
    <ProjectUrlContext.Provider value={{ projectId, setProjectId }}>
      {scoped && project && (
        <p className="page-sub" aria-label="当前项目">
          当前项目：{project.name}（{project.key}）
        </p>
      )}
      {scoped && loaded && explicitId && !project && (
        <p className="error-text" role="alert">
          URL 指定的项目未在当前项目列表中找到，请核对项目 ID；如应有权限，请联系项目管理员。项目：
          {explicitId}
        </p>
      )}
      <Fragment key={scoped ? `${location.pathname}:${projectId}` : location.pathname}>
        {children}
      </Fragment>
    </ProjectUrlContext.Provider>
  );
}
