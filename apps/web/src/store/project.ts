import { create } from 'zustand';
import { projectApi, type ProjectItem } from '../api/resources';

const STORAGE_KEY = 'reqflow.projectId';

let cache: ProjectItem[] | null = null;
let inflight: Promise<ProjectItem[]> | null = null;

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
