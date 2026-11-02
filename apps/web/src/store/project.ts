import { create } from 'zustand';
import { projectApi, type ProjectView } from '../api/resources';

/** 只记住当前项目 ID；会话凭据不进入 localStorage。 */
const STORAGE_KEY = 'workmesh.projectId';

let cache: ProjectView[] | null = null;
let inflight: Promise<ProjectView[]> | null = null;

export async function loadProjects(force = false) {
  if (force) {
    cache = null;
    inflight = null;
  }
  if (cache) return cache;
  if (!inflight) {
    inflight = projectApi
      .list()
      .then((list) => {
        cache = Array.isArray(list) ? list : [];
        return cache;
      })
      .catch((error: unknown) => {
        inflight = null;
        throw error;
      });
  }
  return inflight;
}

export function invalidateProjects() {
  cache = null;
  inflight = null;
}

interface ProjectState {
  projectId: string;
  setProjectId: (id: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projectId: localStorage.getItem(STORAGE_KEY) ?? '',
  setProjectId: (id) => {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
    set({ projectId: id });
  },
}));
