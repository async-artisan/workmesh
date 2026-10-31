import { client } from './client';
export interface ProjectItem {
  id: string;
  name: string;
  key: string;
  description?: string;
  repositoryUrl?: string | null;
}
export interface RequirementItem {
  id: string;
  title: string;
  status: string;
  description?: string;
  priority?: string;
  userStories?: string[];
  acceptanceCriteria?: string[];
}
export interface AiRunMessage {
  id: string;
  sequence?: number;
  role?: string;
  type?: string;
  content?: string;
  text?: string;
  createdAt?: string;
}
export interface AiRunDraft {
  backgroundGoal: string;
  usersScenarios: string[];
  userStoriesFlows: string[];
  acceptanceCriteria: string[];
}
export interface AiRunStep {
  id: string;
  name?: string;
  title?: string;
  status: string;
  messages?: AiRunMessage[];
}
export interface AiRunItem {
  id: string;
  projectId: string;
  title?: string;
  priority?: string;
  workflow?: string;
  status: string;
  currentStep?: number | string;
  step?: number | string;
  steps?: AiRunStep[];
  messages?: AiRunMessage[];
  draft?: AiRunDraft | string | { content?: string };
  error?: string;
  createdAt?: string;
  updatedAt?: string;
}
export interface AiRunDetail {
  run: AiRunItem;
  messages: AiRunMessage[];
  requirement?: RequirementItem;
}
export const projectApi = {
  list: () => client.get('/projects').then((value) => value as unknown as ProjectItem[]),
  members: (projectId: string) =>
    client
      .get(`/projects/${encodeURIComponent(projectId)}/members`)
      .then(
        (value) =>
          value as unknown as Array<{
            id: string;
            name?: string | null;
            email: string;
            role: string;
          }>,
      ),
  create: (data: { name: string; key: string; description?: string; repositoryUrl?: string }) =>
    client.post('/projects', data),
  update: (
    id: string,
    data: { name?: string; description?: string; repositoryUrl?: string | null },
  ) => client.put(`/projects/${id}`, data),
  remove: (id: string) => client.delete(`/projects/${id}`),
};
export const requirementApi = {
  list: (projectId: string, page = 1, limit = 20, status?: string, sortBy = 'updatedAt') =>
    client
      .get(
        `/requirements?projectId=${encodeURIComponent(projectId)}&page=${page}&limit=${limit}&sortBy=${sortBy}${status ? `&status=${status}` : ''}`,
      )
      .then(
        (value) =>
          value as unknown as {
            items: RequirementItem[];
            total: number;
            page: number;
            limit: number;
          },
      ),
  create: (data: Record<string, unknown>) => client.post('/requirements', data),
  update: (id: string, data: Record<string, unknown>) => client.patch(`/requirements/${id}`, data),
  remove: (id: string) => client.delete(`/requirements/${id}`),
};
export const prdApi = {
  list: (requirementId: string) => client.get(`/requirements/${requirementId}/prds`),
  generate: (requirementId: string, data: { templateId?: string; knowledgeBaseId?: string } = {}) =>
    client.post(`/requirements/${requirementId}/prds/generate`, data),
  versions: (prdId: string) => client.get(`/prds/${prdId}/versions`),
  revise: (prdId: string, content: string) => client.post(`/prds/${prdId}/versions`, { content }),
  restore: (prdId: string, version: number) =>
    client.post(`/prds/${prdId}/versions/restore?version=${version}`),
  templates: (projectId: string) =>
    client.get(`/projects/${encodeURIComponent(projectId)}/prd-templates`),
  createTemplate: (
    projectId: string,
    data: {
      name: string;
      content: string;
      description?: string;
      variables?: unknown[];
      isDefault?: boolean;
    },
  ) => client.post(`/projects/${encodeURIComponent(projectId)}/prd-templates`, data),
  submitApproval: (prdId: string, data: { approverId: string; comment?: string }) =>
    client.post(`/prds/${encodeURIComponent(prdId)}/approvals`, data),
  approvals: (prdId: string) =>
    client
      .get(`/prds/${encodeURIComponent(prdId)}/approvals`)
      .then(
        (value) =>
          value as unknown as Array<{
            id: string;
            status: string;
            comment?: string | null;
            createdAt?: string;
            approver?: { id: string; name?: string | null; email: string };
          }>,
      ),
  decideApproval: (
    id: string,
    data: { status: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'; comment?: string },
  ) => client.patch(`/prd-approvals/${encodeURIComponent(id)}`, data),
  specs: (projectId: string) => client.get(`/projects/${encodeURIComponent(projectId)}/specs`),
  updateSpecContent: (id: string, data: { title?: string; content?: string }) =>
    client.patch(`/specs/${encodeURIComponent(id)}/content`, data),
  generateSpec: (projectId: string, prdId: string) =>
    client.post(
      `/projects/${encodeURIComponent(projectId)}/specs/generate/${encodeURIComponent(prdId)}`,
    ),
  setSpecStatus: (id: string, status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'ARCHIVED') =>
    client.patch(`/specs/${encodeURIComponent(id)}`, { status }),
  decisions: (projectId: string) =>
    client.get(`/projects/${encodeURIComponent(projectId)}/decisions`),
  updateDecisionContent: (
    id: string,
    data: { title?: string; context?: string; decision?: string; consequences?: string },
  ) => client.patch(`/decisions/${encodeURIComponent(id)}/content`, data),
  createDecision: (
    projectId: string,
    data: { title: string; context: string; decision: string; consequences?: string },
  ) => client.post(`/projects/${encodeURIComponent(projectId)}/decisions`, data),
  setDecisionStatus: (id: string, status: 'PROPOSED' | 'ACCEPTED' | 'SUPERSEDED' | 'REJECTED') =>
    client.patch(`/decisions/${encodeURIComponent(id)}`, { status }),
  exportMarkdown: (prdId: string) => client.get(`/prds/${prdId}/export`, { responseType: 'blob' }),
  exportHtml: (prdId: string) =>
    client.get(`/prds/${prdId}/export?format=html`, { responseType: 'blob' }),
};
export const aiRunApi = {
  list: (projectId: string, page = 1, limit = 20, status?: string) =>
    client
      .get(
        `/ai/runs?projectId=${encodeURIComponent(projectId)}&page=${page}&limit=${limit}${status ? `&status=${encodeURIComponent(status)}` : ''}`,
      )
      .then((value) => value as unknown as { items: AiRunItem[]; total: number }),
  get: (id: string) =>
    client
      .get(`/ai/runs/${encodeURIComponent(id)}`)
      .then((value) => value as unknown as AiRunDetail),
  messages: (id: string) =>
    client
      .get(`/ai/runs/${encodeURIComponent(id)}/messages`)
      .then((value) => value as unknown as AiRunMessage[]),
  create: (data: { projectId: string }) =>
    client.post('/ai/runs', data).then((value) => value as unknown as AiRunDetail),
  sendMessage: (id: string, content: string) =>
    client
      .post(`/ai/runs/${encodeURIComponent(id)}/messages`, { content })
      .then((value) => value as unknown as AiRunDetail),
  pause: (id: string) =>
    client
      .post(`/ai/runs/${encodeURIComponent(id)}/pause`)
      .then((value) => value as unknown as AiRunDetail),
  resume: (id: string) =>
    client
      .post(`/ai/runs/${encodeURIComponent(id)}/resume`)
      .then((value) => value as unknown as AiRunDetail),
  cancel: (id: string) =>
    client
      .post(`/ai/runs/${encodeURIComponent(id)}/cancel`)
      .then((value) => value as unknown as AiRunDetail),
  confirm: (id: string, data: { title?: string; priority?: string; draft?: AiRunDraft }) =>
    client
      .post(`/ai/runs/${encodeURIComponent(id)}/confirm`, data)
      .then((value) => value as unknown as RequirementItem),
  stream: (id: string, accessToken: string, signal: AbortSignal, lastEventId?: string) =>
    fetch(`/api/ai/runs/${encodeURIComponent(id)}/events`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'text/event-stream',
        ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
      },
      signal,
    }),
};
export const knowledgeApi = {
  list: (projectId: string, page = 1) =>
    client.get(`/knowledge-bases/project/${encodeURIComponent(projectId)}?page=${page}`),
  create: (projectId: string, data: { name: string; description?: string }) =>
    client.post(`/knowledge-bases/project/${encodeURIComponent(projectId)}`, data),
  search: (knowledgeBaseId: string, query: string, page = 1, limit = 20) =>
    client.get(
      `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/search?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
    ),
  remove: (knowledgeBaseId: string) =>
    client.delete(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`),
};
export const traceApi = {
  graph: (projectId: string) =>
    client.get(`/traces/project/${encodeURIComponent(projectId)}/graph`),
};
export const dashboardApi = { summary: () => client.get('/dashboard') };
