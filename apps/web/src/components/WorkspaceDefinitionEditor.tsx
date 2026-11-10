import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FolderGit2, Plus, Trash2 } from 'lucide-react';
import type { ActionBindingInput } from '../api/auth';
import { ApiError, formatApiError } from '../api/client';
import {
  workspaceApi,
  type Confirmation,
  type ProjectRepositoryView,
  type WorkspaceDefinitionIssue,
  type WorkspaceDefinitionPayload,
  type WorkspaceDefinitionPublishView,
  type WorkspaceDefinitionRepositoryRef,
  type WorkspaceDefinitionValidationResult,
  type WorkspaceDefinitionView,
  type WorkspaceLayoutKind,
} from '../api/resources';
import { formatDateTime } from '../lib/datetime';
import { ConfirmationPrompt } from './ConfirmationPrompt';
import { InlineLoading } from './Skeleton';
import './workspace-definition-editor.css';

export interface WorkspaceDefinitionEditorProps {
  projectId: string;
  /** 项目共享配置版本：发布用 `Project.version` + `definitionVersion` 双 CAS。 */
  projectVersion: number | null;
  definition: WorkspaceDefinitionView;
  /** 项目活跃仓库，供“逻辑键 → 平台仓库 ID”选择。 */
  repositories: ProjectRepositoryView[];
  canWrite: boolean;
  /** 发布成功或用户要求重新加载时，由页面重新拉取定义与仓库。 */
  onChanged: () => void | Promise<void>;
  /** 发布成功后由页面展示成功提示（编辑器随后会按新 revision 重载）。 */
  onPublished?: (result: WorkspaceDefinitionPublishView) => void;
}

export const WORKSPACE_DEFINITION_PUBLISH_ACTION = 'WORKSPACE_DEFINITION_PUBLISH';

const LAYOUT_KIND_OPTIONS: Array<{ value: WorkspaceLayoutKind; label: string; hint: string }> = [
  {
    value: 'SINGLE_ROOT',
    label: '单根仓库（SINGLE_ROOT）',
    hint: '恰好一个平台仓库，建议路径固定为 “.”；普通单仓与 monorepo 都使用这种布局。',
  },
  {
    value: 'MULTI_ROOT',
    label: '多根工作区（MULTI_ROOT）',
    hint: '两个或更多独立仓库，各自使用安全的相对路径；不得使用绝对路径或 “..”。',
  },
  {
    value: 'NONE',
    label: '无代码项目（NONE）',
    hint: '显式声明项目不需要代码仓库；此时 repositories 必须为空数组。',
  },
];

export function layoutKindLabel(kind: WorkspaceLayoutKind | null | undefined): string {
  return LAYOUT_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? '未选择';
}

function hasCode(error: ApiError, code: string): boolean {
  return error.code === code || error.message === code;
}

/** 从 422/校验错误里提取问题清单；服务端把 issues 放在 details.issues。 */
export function issuesFromError(error: unknown): WorkspaceDefinitionIssue[] {
  if (!(error instanceof ApiError)) return [];
  const raw = error.details?.issues;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      path: String(item.path ?? ''),
      code: String(item.code ?? ''),
      message: String(item.message ?? ''),
    }));
}

/**
 * 定义生命周期错误说明（§13.3/§13.4）：
 * 409 版本/摘要冲突必须重新加载，不能用旧编辑器覆盖新基线；
 * 422 是内容问题（仓库归属、路径规则、文档引用不存在/越权/已归档），要逐条修正。
 */
export function describeDefinitionError(error: unknown): string {
  if (!(error instanceof ApiError)) return formatApiError(error);

  if (
    hasCode(error, 'VALIDATION_FAILED') ||
    hasCode(error, 'WORKSPACE_DEFINITION_INVALID') ||
    error.status === 422
  ) {
    return '定义内容被服务端拒绝（422）：存在无效的仓库引用、路径规则或文档引用（不存在/越权/已归档）。请按下方问题清单修正后重新校验。';
  }
  if (hasCode(error, 'DEFINITION_VERSION_CONFLICT')) {
    return '定义版本已变化：其他管理员保存过草稿或发布过新版本。你手中的编辑器已过期，请重新加载后再编辑；服务端不会接受旧版本覆盖新基线。';
  }
  if (hasCode(error, 'DEFINITION_DIGEST_CONFLICT')) {
    return '草稿摘要不一致：服务端规范化后的内容与本次提交的 payloadDigest 不同（可能草稿已被他人更新）。请重新加载、重新校验并保存草稿。';
  }
  if (hasCode(error, 'PROJECT_VERSION_CONFLICT')) {
    return '项目版本已变化（仓库声明/归档或定义发布改变了项目版本）。请重新加载后重新校验并发布，旧版本不会被接受。';
  }
  if (hasCode(error, 'DEFINITION_NOT_SAVED')) {
    return '发布失败：服务端没有找到可发布的草稿。请先校验并保存草稿，再发起发布。';
  }
  if (hasCode(error, 'CONFIRMATION_USED')) {
    return '确认票据已被使用：同一票据不能重复发布。请重新点击发布并再次验证密码（服务端会签发新票据）。';
  }
  if (hasCode(error, 'CONFIRMATION_EXPIRED') || hasCode(error, 'CONFIRMATION_INVALID')) {
    return '确认票据已失效：请重新点击发布，重新完成密码验证后重试。';
  }
  if (hasCode(error, 'IDEMPOTENCY_DIGEST_CONFLICT') || hasCode(error, 'IDEMPOTENCY_CONFLICT')) {
    return '本次提交与同一幂等键的首次请求内容不同，服务端已拒绝。请重新发起保存（会使用新的幂等键）。';
  }
  if (hasCode(error, 'PROJECT_ARCHIVED')) {
    return '项目已归档，不能再修改或发布工作区定义。';
  }
  if (hasCode(error, 'PROJECT_MANAGER_REQUIRED') || error.status === 403) {
    return '需要项目 OWNER/ADMIN 权限才能编辑或发布工作区定义。';
  }
  if (error.status === 429) {
    return error.retryAfterSeconds !== null
      ? `请求过于频繁，请在 ${error.retryAfterSeconds} 秒后重试。`
      : '请求过于频繁，请稍后重试。';
  }
  return formatApiError(error);
}

function conflictNeedsReload(error: ApiError): boolean {
  return (
    hasCode(error, 'DEFINITION_VERSION_CONFLICT') ||
    hasCode(error, 'DEFINITION_DIGEST_CONFLICT') ||
    hasCode(error, 'PROJECT_VERSION_CONFLICT')
  );
}

function basePayload(projectId: string): WorkspaceDefinitionPayload {
  return {
    schemaVersion: '1.0',
    projectId,
    layout: { kind: 'NONE' },
    repositories: [],
    relations: [],
    roleHints: {},
    contextPolicy: { requiredDocumentIds: [], roleDocumentIds: {}, repositoryDocuments: [] },
  };
}

/** 逻辑键只做本地预填，必须由负责人确认；规范化与唯一性以服务端校验为准。 */
function suggestedRepositoryKey(repo: ProjectRepositoryView, used: Set<string>): string {
  const base =
    repo.name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^[^a-z]+/, '') || 'repo';
  let key = base;
  let index = 2;
  while (used.has(key)) {
    key = `${base}-${index}`;
    index += 1;
  }
  used.add(key);
  return key;
}

function repositoryRow(
  repo: ProjectRepositoryView,
  suggestedPath: string,
  used: Set<string>,
): WorkspaceDefinitionRepositoryRef {
  return {
    key: suggestedRepositoryKey(repo, used),
    projectRepositoryId: repo.id,
    suggestedPath,
    defaultRef: repo.defaultBranch,
    description: null,
  };
}

/** 未配置时用已声明仓库生成可编辑草稿；负责人仍须显式选择布局并校验发布。 */
function prefillPayload(
  projectId: string,
  repositories: ProjectRepositoryView[],
): WorkspaceDefinitionPayload {
  const payload = basePayload(projectId);
  if (repositories.length === 0) return payload;
  const used = new Set<string>();
  if (repositories.length === 1) {
    return {
      ...payload,
      layout: { kind: 'SINGLE_ROOT' },
      repositories: [repositoryRow(repositories[0]!, '.', used)],
    };
  }
  return {
    ...payload,
    layout: { kind: 'MULTI_ROOT' },
    repositories: repositories.map((repo) => repositoryRow(repo, repo.name, used)),
  };
}

function clonePayload(payload: WorkspaceDefinitionPayload): WorkspaceDefinitionPayload {
  return JSON.parse(JSON.stringify(payload)) as WorkspaceDefinitionPayload;
}

function initialPayload(
  projectId: string,
  definition: WorkspaceDefinitionView,
  repositories: ProjectRepositoryView[],
): WorkspaceDefinitionPayload {
  if (definition.draft?.payload) return clonePayload(definition.draft.payload);
  if (definition.payload) return clonePayload(definition.payload);
  return prefillPayload(projectId, repositories);
}

function definitionSignature(definition: WorkspaceDefinitionView): string {
  return [
    definition.projectId,
    definition.definitionStatus,
    definition.definitionVersion,
    definition.revisionId ?? '',
    definition.revisionNo ?? '',
    definition.draft?.payloadDigest ?? '',
  ].join('|');
}

function repositoryIdentityMode(repo: {
  identityMode?: 'DECLARED' | 'PROVIDER';
  adapter: string | null;
  externalId: string | null;
}): 'DECLARED' | 'PROVIDER' {
  // 只按服务端字段保守判断：有 provider 身份字段才是 PROVIDER；不据此宣称“已核验”。
  if (repo.identityMode) return repo.identityMode;
  return repo.adapter && repo.externalId ? 'PROVIDER' : 'DECLARED';
}

/**
 * 工作区定义编辑器：布局 + 逻辑键/仓库映射的结构化编辑，校验 → 保存草稿 → 发布。
 * 发布使用服务端保存的草稿，因此不把定义内容塞进发布请求；票据绑定两个版本与摘要。
 * 成员只读：不渲染任何写入入口，也不伪造“已发布/已核验”状态。
 */
export function WorkspaceDefinitionEditor({
  projectId,
  projectVersion,
  definition,
  repositories,
  canWrite,
  onChanged,
  onPublished,
}: WorkspaceDefinitionEditorProps) {
  const layoutHintId = useId();
  const [payload, setPayload] = useState<WorkspaceDefinitionPayload>(() =>
    initialPayload(projectId, definition, repositories),
  );
  const [expectedDefinitionVersion, setExpectedDefinitionVersion] = useState(
    definition.definitionVersion,
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(initialPayload(projectId, definition, repositories)),
  );
  const [validation, setValidation] = useState<WorkspaceDefinitionValidationResult | null>(null);
  const [savedDraft, setSavedDraft] = useState<{
    payloadDigest: string;
    definitionVersion: number;
    updatedAt: string | null;
  } | null>(null);
  const [issues, setIssues] = useState<WorkspaceDefinitionIssue[]>(
    definition.validation?.issues ?? [],
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<'validate' | 'draft' | 'publish' | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [reloadSuggested, setReloadSuggested] = useState(false);
  const signatureRef = useRef(definitionSignature(definition));

  // 发布成功或页面刷新后，服务端定义成为新基线；编辑器必须整体重载，不能覆盖新版本。
  useEffect(() => {
    const nextSignature = definitionSignature(definition);
    if (nextSignature === signatureRef.current) return;
    signatureRef.current = nextSignature;
    const nextPayload = initialPayload(projectId, definition, repositories);
    setPayload(nextPayload);
    setBaseline(JSON.stringify(nextPayload));
    setExpectedDefinitionVersion(definition.definitionVersion);
    setValidation(null);
    setSavedDraft(null);
    setIssues(definition.validation?.issues ?? []);
    setError('');
    setNotice('');
    setPublishOpen(false);
    setReloadSuggested(false);
    // repositories 仅用于预填，不参与“服务端定义已变化”的判断。
  }, [definition, projectId]);

  const kind = payload.layout?.kind ?? 'NONE';
  const rows = payload.repositories ?? [];
  const activeRepositories = repositories.filter((repo) => !repo.archivedAt);
  const usedRepositoryIds = new Set(rows.map((row) => row.projectRepositoryId));
  const dirty = JSON.stringify(payload) !== baseline;

  const canSaveDraft = Boolean(validation?.valid && validation.digest) && !savedDraft && !busy;
  const canPublish = Boolean(savedDraft && validation?.valid && projectVersion !== null) && !busy;

  const binding = useMemo<ActionBindingInput | null>(() => {
    if (!projectVersion || !savedDraft) return null;
    return {
      action: WORKSPACE_DEFINITION_PUBLISH_ACTION,
      projectId,
      targetType: 'PROJECT_WORKSPACE_DEFINITION',
      targetId: projectId,
      expectedVersion: projectVersion,
      roleSlot: null,
      payload: {
        expectedDefinitionVersion: savedDraft.definitionVersion,
        payloadDigest: savedDraft.payloadDigest,
      },
    };
  }, [projectId, projectVersion, savedDraft]);

  function resetTransient() {
    setValidation(null);
    setSavedDraft(null);
    setIssues([]);
    setError('');
    setNotice('');
    setReloadSuggested(false);
  }

  function updatePayload(next: WorkspaceDefinitionPayload) {
    setPayload(next);
    resetTransient();
  }

  function changeKind(nextKind: WorkspaceLayoutKind) {
    const nextRepositories =
      nextKind === 'NONE'
        ? []
        : nextKind === 'SINGLE_ROOT'
          ? rows.map((row) => ({ ...row, suggestedPath: '.' }))
          : rows.map((row) => (row.suggestedPath === '.' ? { ...row, suggestedPath: '' } : row));
    updatePayload({
      ...payload,
      layout: { ...payload.layout, kind: nextKind },
      repositories: nextRepositories,
    });
    if (nextKind === 'NONE' && rows.length > 0) {
      setNotice('无代码项目（NONE）不接受仓库；已清空定义中的仓库行。');
    }
  }

  function addRepositoryRow() {
    const candidate = activeRepositories.find((repo) => !usedRepositoryIds.has(repo.id));
    if (!candidate) {
      setError(
        activeRepositories.length === 0
          ? '项目还没有已声明的代码仓库；请先在上方声明仓库，再加入定义。'
          : '所有已声明仓库都已在定义中；重复引用同一仓库会被服务端拒绝。',
      );
      return;
    }
    const nextRows = [...rows, repositoryRow(candidate, '', new Set(rows.map((row) => row.key)))];
    const nextKind: WorkspaceLayoutKind =
      nextRows.length >= 2 ? 'MULTI_ROOT' : kind === 'NONE' ? 'SINGLE_ROOT' : kind;
    updatePayload({
      ...payload,
      layout: { ...payload.layout, kind: nextKind },
      repositories:
        nextKind === 'SINGLE_ROOT'
          ? nextRows.map((row) => ({ ...row, suggestedPath: '.' }))
          : nextRows,
    });
  }

  function removeRepositoryRow(index: number) {
    const nextRows = rows.filter((_, rowIndex) => rowIndex !== index);
    const nextKind: WorkspaceLayoutKind =
      nextRows.length === 0
        ? 'NONE'
        : nextRows.length === 1 && kind !== 'SINGLE_ROOT'
          ? 'SINGLE_ROOT'
          : kind;
    updatePayload({
      ...payload,
      layout: { ...payload.layout, kind: nextKind },
      repositories:
        nextKind === 'SINGLE_ROOT'
          ? nextRows.map((row) => ({ ...row, suggestedPath: '.' }))
          : nextRows,
    });
  }

  function updateRow(index: number, patch: Partial<WorkspaceDefinitionRepositoryRef>) {
    updatePayload({
      ...payload,
      repositories: rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    });
  }

  async function validate() {
    setBusy('validate');
    setError('');
    setNotice('');
    setIssues([]);
    setReloadSuggested(false);
    try {
      const result = await workspaceApi.validateDefinition(projectId, payload);
      setValidation(result);
      setIssues(result.issues);
      setSavedDraft(null);
      if (!result.valid) {
        setError(
          result.issues.length > 0
            ? `校验未通过：${result.issues.length} 项问题，详见下方“校验结果”。`
            : '校验未通过：服务端未返回具体问题，请检查定义内容。',
        );
        return;
      }
      if (!result.digest) {
        setError('服务端未返回规范化摘要，无法保存草稿；请重新校验。');
        return;
      }
      setNotice('校验通过：下一步保存草稿，然后发布。发布使用服务端保存的草稿与本次摘要。');
    } catch (caught) {
      setIssues(issuesFromError(caught));
      setError(describeDefinitionError(caught));
      setReloadSuggested(caught instanceof ApiError && conflictNeedsReload(caught));
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!validation?.valid || !validation.digest) return;
    setBusy('draft');
    setError('');
    setNotice('');
    setIssues([]);
    setReloadSuggested(false);
    try {
      const normalized = validation.definition ?? payload;
      const result = await workspaceApi.saveDraft(projectId, {
        expectedDefinitionVersion,
        payloadDigest: validation.digest,
        definition: normalized,
      });
      setPayload(normalized);
      setBaseline(JSON.stringify(normalized));
      setExpectedDefinitionVersion(result.definitionVersion);
      setSavedDraft({
        payloadDigest: validation.digest,
        definitionVersion: result.definitionVersion,
        updatedAt: result.updatedAt ?? null,
      });
      setNotice(
        `草稿已保存（定义版本 v${result.definitionVersion}）。发布将使用服务端保存的这份草稿；如再次编辑请重新校验并保存。`,
      );
    } catch (caught) {
      setIssues(issuesFromError(caught));
      setError(describeDefinitionError(caught));
      setReloadSuggested(caught instanceof ApiError && conflictNeedsReload(caught));
    } finally {
      setBusy(null);
    }
  }

  async function publish(confirmation: Confirmation) {
    if (!savedDraft || projectVersion === null) {
      setError('缺少已保存草稿或项目版本，无法发布；请重新校验并保存草稿。');
      return;
    }
    // 先关闭确认框：失败原因留在编辑器里，用户可按错误说明修正后重试。
    setPublishOpen(false);
    setBusy('publish');
    setError('');
    setNotice('');
    setIssues([]);
    setReloadSuggested(false);
    try {
      const result = await workspaceApi.publishDefinition(projectId, {
        expectedProjectVersion: projectVersion,
        expectedDefinitionVersion: savedDraft.definitionVersion,
        payloadDigest: savedDraft.payloadDigest,
        confirmation,
      });
      setExpectedDefinitionVersion(result.definitionVersion);
      setSavedDraft(null);
      setValidation(null);
      if (onPublished) {
        onPublished(result);
      } else {
        setNotice(
          `工作区定义已发布：revision v${result.revisionNo}，摘要 ${result.digest}，定义版本 v${result.definitionVersion}。`,
        );
      }
      await onChanged();
    } catch (caught) {
      setIssues(issuesFromError(caught));
      setError(describeDefinitionError(caught));
      setReloadSuggested(caught instanceof ApiError && conflictNeedsReload(caught));
      if (caught instanceof ApiError && hasCode(caught, 'DEFINITION_NOT_SAVED'))
        setSavedDraft(null);
    } finally {
      setBusy(null);
    }
  }

  async function reload() {
    setError('');
    setIssues([]);
    setReloadSuggested(false);
    await onChanged();
  }

  if (!canWrite) {
    return (
      <div className="table-card" aria-label="工作区定义（只读）">
        <div className="card-head">
          <h3>
            工作区定义
            <small>
              {definition.definitionStatus === 'CONFIGURED'
                ? `已发布 revision v${definition.revisionNo ?? '—'}`
                : '尚未发布'}
            </small>
          </h3>
        </div>
        <p className="page-sub">
          只读：仓库声明、定义编辑、校验与发布仅项目 OWNER/ADMIN
          可操作；任意活跃成员可生成一次性接入码。
        </p>
        {definition.definitionStatus !== 'CONFIGURED' ? (
          <p className="kb-notice" role="status">
            项目尚未发布工作区定义（PROJECT_UNCONFIGURED）。此时不能生成接入码，也不能执行 workspace
            init --join；成员仍可在现有知识/PRD 权限内工作。
          </p>
        ) : (
          <>
            <dl className="detail-list">
              <li>当前已发布 revision：v{definition.revisionNo ?? '—'}</li>
              <li>定义摘要：{definition.digest ?? '—'}</li>
              <li>
                发布时间：{definition.publishedAt ? formatDateTime(definition.publishedAt) : '—'}
              </li>
              <li>布局类型：{layoutKindLabel(definition.payload?.layout?.kind)}</li>
              <li>定义中的仓库：{definition.repositories.length} 个</li>
            </dl>
            {definition.repositories.length === 0 ? (
              <p className="page-sub">该定义未引用代码仓库（无代码项目）。</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table" aria-label="定义中的仓库映射">
                  <thead>
                    <tr>
                      <th>逻辑键</th>
                      <th>仓库</th>
                      <th>建议路径</th>
                      <th>身份</th>
                    </tr>
                  </thead>
                  <tbody>
                    {definition.repositories.map((repository) => (
                      <tr key={repository.key}>
                        <td className="cell-mono">{repository.key}</td>
                        <td>
                          {repository.owner}/{repository.name}
                        </td>
                        <td className="cell-mono">{repository.suggestedPath ?? '—'}</td>
                        <td>
                          <span className="status-tag">
                            {repositoryIdentityMode(repository) === 'DECLARED'
                              ? '人工声明（未核验）'
                              : '托管方登记'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const selectedKind = LAYOUT_KIND_OPTIONS.find((item) => item.value === kind);

  return (
    <div
      className="table-card workspace-definition-editor"
      aria-label="工作区定义编辑器"
      aria-busy={Boolean(busy)}
    >
      <div className="card-head">
        <h3>
          工作区定义
          <small>
            {definition.definitionStatus === 'CONFIGURED'
              ? `已发布 revision v${definition.revisionNo ?? '—'}`
              : '尚未发布'}
          </small>
        </h3>
        {dirty && <span className="status-tag">未保存修改</span>}
      </div>

      <p className="page-sub">
        配置工作区使用的仓库与目录。修改后依次校验、保存草稿并发布，成员才会使用新配置。
      </p>

      {definition.definitionStatus === 'CONFIGURED' && (
        <p className="page-sub">
          当前基线：revision v{definition.revisionNo ?? '—'} · 定义版本 v
          {definition.definitionVersion} · 摘要{' '}
          <span className="cell-mono">{definition.digest ?? '—'}</span> · 发布于{' '}
          {definition.publishedAt ? formatDateTime(definition.publishedAt) : '—'}
        </p>
      )}
      {definition.draft && (
        <p className="kb-notice" role="status">
          服务端已有草稿（定义版本 v{definition.draft.definitionVersion}，摘要{' '}
          {definition.draft.payloadDigest}
          {definition.draft.updatedAt
            ? `，保存于 ${formatDateTime(definition.draft.updatedAt)}`
            : ''}
          ）。编辑器已载入该草稿；编辑后需重新校验并保存。
        </p>
      )}

      <div className="form-grid workspace-definition-form">
        <div className="workspace-layout-setting">
          <label className="field">
            <span>布局类型</span>
            <select
              aria-label="布局类型"
              aria-describedby={layoutHintId}
              value={kind}
              disabled={Boolean(busy)}
              onChange={(event) => changeKind(event.target.value as WorkspaceLayoutKind)}
            >
              {LAYOUT_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="workspace-layout-hint" id={layoutHintId}>
            {selectedKind?.hint}
          </p>
        </div>

        {kind === 'NONE' ? (
          <p className="page-sub">
            当前定义不包含代码仓库。若项目需要代码，请切换为单根或多根布局并添加仓库。
          </p>
        ) : (
          <div className="workspace-repository-list">
            <div className="workspace-repositories-heading">
              <div>
                <h4>
                  仓库映射 <span>{rows.length} 个仓库</span>
                </h4>
                <p>为每个仓库设置逻辑键与本地相对路径。</p>
              </div>
              <button
                type="button"
                className="ghost workspace-add-repository"
                aria-label="添加仓库行"
                onClick={addRepositoryRow}
                disabled={Boolean(busy)}
              >
                <Plus size={16} aria-hidden="true" />
                添加仓库
              </button>
            </div>
            {rows.map((row, index) => {
              const referenced = repositories.find(
                (repository) => repository.id === row.projectRepositoryId,
              );
              const referencedArchived = Boolean(referenced?.archivedAt);
              return (
                <fieldset className="workspace-repository-card" key={`repository-row-${index}`}>
                  <legend className="workspace-repository-legend">仓库 {index + 1}</legend>
                  <div className="workspace-repository-heading">
                    <div className="workspace-repository-title">
                      <span className="workspace-repository-icon" aria-hidden="true">
                        <FolderGit2 size={18} />
                      </span>
                      <h5>仓库 {index + 1}</h5>
                      {row.key && <span className="workspace-repository-key">{row.key}</span>}
                    </div>
                    <button
                      type="button"
                      className="ghost workspace-remove-repository"
                      aria-label={`移除仓库行 ${index + 1}`}
                      onClick={() => removeRepositoryRow(index)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      移除
                    </button>
                  </div>
                  <div className="workspace-repository-fields">
                    <label className="field">
                      <span>逻辑键</span>
                      <input
                        value={row.key}
                        aria-label={`逻辑键 ${index + 1}`}
                        onChange={(event) => updateRow(index, { key: event.target.value })}
                        placeholder="web-client"
                      />
                    </label>
                    <label className="field">
                      <span>平台仓库</span>
                      <select
                        aria-label={`平台仓库 ${index + 1}`}
                        value={row.projectRepositoryId}
                        onChange={(event) =>
                          updateRow(index, { projectRepositoryId: event.target.value })
                        }
                      >
                        {referenced &&
                          (!activeRepositories.some((repo) => repo.id === referenced.id) ||
                            referencedArchived) && (
                            <option value={referenced.id}>
                              {referenced.owner}/{referenced.name}（已归档，需替换）
                            </option>
                          )}
                        {activeRepositories.map((repository) => (
                          <option key={repository.id} value={repository.id}>
                            {repository.owner}/{repository.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>建议路径</span>
                      <input
                        value={row.suggestedPath ?? ''}
                        aria-label={`建议路径 ${index + 1}`}
                        onChange={(event) =>
                          updateRow(index, { suggestedPath: event.target.value })
                        }
                        placeholder={kind === 'SINGLE_ROOT' ? '.' : 'services/api'}
                      />
                    </label>
                    <label className="field">
                      <span>
                        默认引用 <span className="workspace-field-optional">可选</span>
                      </span>
                      <input
                        value={row.defaultRef ?? ''}
                        aria-label={`默认引用 ${index + 1}`}
                        onChange={(event) => updateRow(index, { defaultRef: event.target.value })}
                        placeholder="main"
                      />
                    </label>
                    <label className="field workspace-repository-description">
                      <span>
                        职责说明 <span className="workspace-field-optional">可选</span>
                      </span>
                      <input
                        value={row.description ?? ''}
                        aria-label={`职责说明 ${index + 1}`}
                        onChange={(event) => updateRow(index, { description: event.target.value })}
                        placeholder="例如：用户界面、后端接口或公共组件"
                      />
                    </label>
                  </div>
                </fieldset>
              );
            })}
            {kind === 'SINGLE_ROOT' && rows.length !== 1 && (
              <p className="field-error" role="status">
                SINGLE_ROOT 要求恰好一个仓库；请保留一行，或改为 MULTI_ROOT / NONE。
              </p>
            )}
            {kind === 'MULTI_ROOT' && rows.length < 2 && (
              <p className="field-error" role="status">
                MULTI_ROOT 至少需要两个独立仓库；请添加仓库行，或改为 SINGLE_ROOT。
              </p>
            )}
          </div>
        )}

        <p className="modal-note">
          定义版本 v{expectedDefinitionVersion} · 项目版本 {projectVersion ?? '—'}
          。路径必须是安全的相对 POSIX 路径；SINGLE_ROOT 使用 “.”。文档引用只保存在 payload
          中，发布时由服务端校验存在性与访问权。
        </p>
      </div>

      {issues.length > 0 && (
        <div className="table-card" aria-label="校验结果">
          <div className="card-head">
            <h3>
              校验结果<small>{issues.length} 项问题</small>
            </h3>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>路径</th>
                  <th>代码</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue, index) => (
                  <tr key={`${issue.path}-${issue.code}-${index}`}>
                    <td className="cell-mono">{issue.path || '—'}</td>
                    <td>
                      <span className="status-tag">{issue.code || '—'}</span>
                    </td>
                    <td>{issue.message || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div className="form-grid">
          <p className="error" role="alert">
            {error}
          </p>
          {reloadSuggested && (
            <button className="ghost" type="button" onClick={() => void reload()}>
              重新加载定义
            </button>
          )}
        </div>
      )}
      {notice && <p className="kb-notice">{notice}</p>}
      {busy && (
        <InlineLoading
          label={
            busy === 'validate'
              ? '正在校验定义…'
              : busy === 'draft'
                ? '正在保存草稿…'
                : '正在发布工作区定义…'
          }
        />
      )}

      <div className="toolbar workspace-definition-actions">
        <button
          className="ghost"
          type="button"
          onClick={() => void validate()}
          disabled={Boolean(busy)}
        >
          {busy === 'validate' ? '校验中…' : '校验定义'}
        </button>
        <button
          className="primary"
          type="button"
          onClick={() => void saveDraft()}
          disabled={!canSaveDraft}
          title={canSaveDraft ? undefined : '先校验定义，取得服务端规范化摘要后才能保存草稿'}
        >
          {busy === 'draft' ? '保存中…' : '保存草稿'}
        </button>
        <button
          className="primary"
          type="button"
          onClick={() => setPublishOpen(true)}
          disabled={!canPublish}
          title={canPublish ? undefined : '先校验并保存草稿，再发布（需要二次验证）'}
        >
          {busy === 'publish' ? '发布中…' : '发布（需要二次验证）'}
        </button>
        <span className="page-sub">
          {savedDraft
            ? `草稿已保存：定义版本 v${savedDraft.definitionVersion}${
                savedDraft.updatedAt ? ` · ${formatDateTime(savedDraft.updatedAt)}` : ''
              }`
            : validation?.valid
              ? '校验通过；保存草稿后即可发布。'
              : '发布前必须校验并保存草稿。'}
        </span>
      </div>

      <ConfirmationPrompt
        open={publishOpen && Boolean(binding)}
        title="发布工作区定义"
        description={
          binding
            ? `将发布服务端已保存的草稿（定义版本 v${savedDraft?.definitionVersion ?? '—'}）。发布后 revision 不可变。`
            : ''
        }
        targetLabel={`项目 ${projectId} 的工作区定义`}
        binding={binding}
        submitLabel="确认发布工作区定义"
        impact={[
          '发布会新建一个不可变 revision，并递增定义版本与项目版本。',
          '发布前打开的旧编辑器再用新请求保存草稿会被 409 拒绝，不能覆盖新基线。',
          '定义中引用的文档不存在、越权或已归档时，服务端会以 422 拒绝发布。',
        ]}
        onClose={() => setPublishOpen(false)}
        onConfirmed={publish}
      />
    </div>
  );
}
