import { create } from 'zustand';
import { ApiError, formatApiError } from '../api/client';
import { projectApi, type ProjectView } from '../api/resources';

/** 只记住当前项目 ID；会话凭据不进入 localStorage。 */
const STORAGE_KEY = 'workmesh.projectId';

/**
 * 项目上下文 store。
 *
 * 状态机（projects / loading / loaded / error / updatedAt 共同描述）：
 *
 * | 语义      | loaded | loading | error | projects | 说明                                   |
 * | --------- | ------ | ------- | ----- | -------- | -------------------------------------- |
 * | 未见结果  | false  | false   | ''    | []       | 尚未发起加载，UI 视为“首次加载中”       |
 * | 首次加载  | false  | true    | ''    | []       | 请求进行中                             |
 * | 已加载    | true   | false   | ''    | [...]    | 最近一次成功，updatedAt 为成功时间      |
 * | 空列表    | true   | false   | ''    | []       | 成功但没有可访问项目（不是错误）        |
 * | 加载失败  | false  | false   | 有值  | []       | 从未成功过：页面级错误                  |
 * | 过期/陈旧 | true   | false   | 有值  | [...]    | 刷新失败但保留上次成功数据（stale）     |
 *
 * localStorage 只作“上次选中的项目”的记忆，不是事实来源：每次成功加载后都会校验
 * 该 ID 是否仍可访问，失效则回落到第一个可访问项目并同步存储；列表为空则清空选择。
 */
export interface ProjectStoreState {
  projectId: string;
  projects: ProjectView[];
  loading: boolean;
  loaded: boolean;
  /** 中文用户可读的失败说明；成功或未加载时为空字符串。 */
  error: string;
  /** formatApiError 输出（含错误码 / requestId），供折叠的技术细节使用。 */
  errorDetail: string;
  /** 最近一次成功加载的时间（ISO 字符串）；失败时保留上一次成功时间。 */
  updatedAt: string | undefined;
  setProjectId: (id: string) => void;
  /** 未成功加载过时才请求；并发调用会复用同一个请求。 */
  ensureProjects: () => Promise<void>;
  /** 强制刷新（供重试按钮 / 发布后同步项目版本使用）；失败只写入 store，不抛错。 */
  refreshProjects: () => Promise<void>;
}

/** 并发去重：同一时刻只允许一个项目列表请求在飞。 */
let inflight: Promise<ProjectView[]> | null = null;
/** 加载代次：invalidateProjects 之后，旧请求的结果不能再写回 store。 */
let generation = 0;

function readStoredProjectId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistProjectId(id: string): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 隐私模式等场景 localStorage 可能不可写；记住选中项目只是体验优化，不能阻塞操作。
  }
}

/** 把 unknown 错误翻译成用户可读的中文说明，同时保留可折叠的技术细节。 */
function describeProjectError(error: unknown): { message: string; detail: string } {
  const detail = formatApiError(error);
  if (error instanceof ApiError) {
    if (error.status === 401) return { message: '登录状态已失效，请重新登录后重试。', detail };
    if (error.status === 403)
      return { message: '当前账号没有查看项目列表的权限，请联系项目管理员。', detail };
    if (error.status >= 500) return { message: '项目服务暂时不可用，请稍后重试。', detail };
  }
  return { message: '暂时无法读取项目列表，请检查网络后重试。', detail };
}

function applyStarted(): void {
  // 开始新一轮加载：清掉上一次的错误，但保留旧 projects / updatedAt（刷新期间仍可展示）。
  useProjectStore.setState({ loading: true, error: '', errorDetail: '' });
}

function applyLoaded(list: ProjectView[]): void {
  const previous = useProjectStore.getState();
  useProjectStore.setState({
    projects: list,
    loading: false,
    loaded: true,
    error: '',
    errorDetail: '',
    updatedAt: new Date().toISOString(),
  });
  // localStorage 里的项目 ID 只是记忆：不在本次可访问列表里就回落到第一个可访问项目。
  if (!list.some((project) => project.id === previous.projectId)) {
    useProjectStore.getState().setProjectId(list[0]?.id ?? '');
  }
}

function applyFailed(error: unknown): void {
  const { message, detail } = describeProjectError(error);
  // 失败时保留 projects / loaded / updatedAt：有旧数据时页面降级为 stale，而不是空列表。
  useProjectStore.setState({ loading: false, error: message, errorDetail: detail });
}

/** 发起（或复用）项目列表请求；成功 / 失败都会同步 store，并保持 reject 语义给旧调用点。 */
function requestProjects(): Promise<ProjectView[]> {
  if (inflight) return inflight;
  const requestGeneration = generation;
  let request: Promise<ProjectView[]>;
  request = projectApi
    .list()
    .then((list) => {
      const normalized = Array.isArray(list) ? list : [];
      if (requestGeneration === generation) applyLoaded(normalized);
      return normalized;
    })
    .catch((error: unknown) => {
      if (requestGeneration === generation) applyFailed(error);
      throw error;
    })
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

/**
 * 旧调用点兼容入口：Authorization 页面读取项目列表、Workflows 发布后同步项目版本都在用。
 * - force=false 且已成功加载过：直接返回 store 中的列表，不发请求；
 * - force=true：强制刷新（与并发请求去重）。
 * 失败时保持 reject，调用点按原有方式处理。
 */
export async function loadProjects(force = false): Promise<ProjectView[]> {
  if (!force) {
    const state = useProjectStore.getState();
    if (state.loaded) return state.projects;
  }
  applyStarted();
  return requestProjects();
}

/** 会话变化 / 项目增删后清空项目缓存，下次访问重新加载。 */
export function invalidateProjects(): void {
  generation += 1;
  inflight = null;
  useProjectStore.setState({
    projects: [],
    loading: false,
    loaded: false,
    error: '',
    errorDetail: '',
    updatedAt: undefined,
  });
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projectId: readStoredProjectId(),
  projects: [],
  loading: false,
  loaded: false,
  error: '',
  errorDetail: '',
  updatedAt: undefined,
  setProjectId: (id) => {
    persistProjectId(id);
    set({ projectId: id });
  },
  ensureProjects: () => {
    // 已成功加载过就直接复用；失败过但尚未成功时，新挂载的页面会重新尝试一次。
    if (get().loaded) return Promise.resolve();
    return get().refreshProjects();
  },
  refreshProjects: async () => {
    applyStarted();
    try {
      await requestProjects();
    } catch {
      // 失败状态已写入 store；按钮触发的刷新不再抛错，避免未处理的 Promise 拒绝。
    }
  },
}));
