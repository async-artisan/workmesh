import { useEffect, useMemo, useState } from 'react';
import { buildStandardWorkflowTemplate, usedWorkflowRoleKeys } from '@workmesh/shared';
import { formatApiError } from '../api/client';
import type { ActionBindingInput } from '../api/auth';
import {
  projectApi,
  rolePackageApi,
  workflowApi,
  type RolePackageListItem,
  type RoleView,
  type WorkflowCompileResult,
  type WorkflowDefinitionView,
  type WorkflowPackageLock,
} from '../api/resources';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import { ProjectSelect } from '../components/ProjectSelect';
import { loadProjects } from '../store/project';
import { useProjectContext } from '../hooks/useProjectContext';

export const WORKFLOW_PUBLISH_ACTION = 'WORKFLOW_CONFIG_PUBLISH';
export const WORKFLOW_DEFINITION_TARGET = 'WORKFLOW_DEFINITION';

type PublishTarget = {
  workflowKey: string;
  expectedCurrentRevision: number;
  definition: Record<string, unknown>;
  locks: WorkflowPackageLock[];
  digest: string;
};

/** 角色包版本只用于"挑一个可锁定的版本"，因此按语义化版本的数值段比较，非法版本退化为字符串比较。 */
function compareVersion(left: string, right: string): number {
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10));
  const a = parse(left);
  const b = parse(right);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return left.localeCompare(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 为定义里被引用的每个角色挑选一个已登记的角色包版本作为锁。
 * 缺锁的角色单独返回：缺锁是编译期的硬失败，必须让用户在发布前看到。
 */
export function pickPackageLocks(
  roleKeys: readonly string[],
  packages: readonly RolePackageListItem[],
) {
  const locks: WorkflowPackageLock[] = [];
  const missing: string[] = [];
  for (const roleKey of roleKeys) {
    const candidates = packages.filter((item) => item.roleKey === roleKey);
    if (candidates.length === 0) {
      missing.push(roleKey);
      continue;
    }
    const best = candidates.reduce((left, right) =>
      compareVersion(left.version, right.version) >= 0 ? left : right,
    );
    locks.push({
      roleKey,
      packageId: best.packageId,
      version: best.version,
      packageDigest: best.manifestDigest,
    });
  }
  // 服务端按 roleKey 排序后计算动作摘要，客户端必须给出同样的顺序。
  locks.sort((left, right) => left.roleKey.localeCompare(right.roleKey));
  return { locks, missing };
}

function parseDefinition(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('流程定义不是合法 JSON。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('流程定义必须是 JSON 对象。');
  const workflowKey = (parsed as { workflowKey?: unknown }).workflowKey;
  if (typeof workflowKey !== 'string' || !workflowKey)
    throw new Error('流程定义缺少 workflowKey。');
  return parsed as Record<string, unknown>;
}

/**
 * 流程配置页：把「校验 → 人工确认票据 → 发布」这条本来只能靠手工 API 走的路径搬进浏览器。
 *
 * 页面不自己决定合法性：模板只做预填，编译与摘要由服务端计算；
 * 发布必须经过一次性票据，票据 payload 里的 compiledDigest 就是校验返回的摘要，
 * 因此任何在预览之后修改定义的行为都会得到 ACTION_CHANGED。
 */
export function Workflows() {
  const { projects, projectId } = useProjectContext();
  const [definitions, setDefinitions] = useState<WorkflowDefinitionView[]>([]);
  const [packages, setPackages] = useState<RolePackageListItem[]>([]);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [projectVersion, setProjectVersion] = useState<number | null>(null);
  const [editorText, setEditorText] = useState('');
  const [expectedCurrentRevision, setExpectedCurrentRevision] = useState(0);
  const [validation, setValidation] = useState<WorkflowCompileResult | null>(null);
  const [missingLocks, setMissingLocks] = useState<string[]>([]);
  const [pending, setPending] = useState<PublishTarget | null>(null);
  const [publishTarget, setPublishTarget] = useState<PublishTarget | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const roleTitles = useMemo(() => new Map(roles.map((role) => [role.key, role.title])), [roles]);

  useEffect(() => {
    const found = projects.find((project) => project.id === projectId);
    if (found) setProjectVersion(found.version);
  }, [projects, projectId]);

  async function load() {
    if (!projectId) {
      setDefinitions([]);
      setPackages([]);
      setRoles([]);
      return;
    }
    try {
      const [definitionPage, packagePage, roleList] = await Promise.all([
        workflowApi.listDefinitions(projectId),
        rolePackageApi.list(projectId),
        projectApi.roles(projectId),
      ]);
      setDefinitions(definitionPage.items);
      setPackages(packagePage.items);
      setRoles(roleList);
      setError('');
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  function resetDraft(text: string, currentRevision = 0) {
    setEditorText(text);
    setExpectedCurrentRevision(currentRevision);
    setValidation(null);
    setMissingLocks([]);
    setPending(null);
    setNotice('');
    setError('');
  }

  function loadTemplate() {
    resetDraft(JSON.stringify(buildStandardWorkflowTemplate(), null, 2), 0);
    setNotice('已载入标准流程模板，下一步做校验。');
  }

  /** 以已发布修订为基线：baseRevisionId 必须指回当前已发布修订，否则服务端会判定基线不一致。 */
  async function loadPublishedRevision(definition: WorkflowDefinitionView) {
    if (!definition.currentPublishedRevisionId) {
      setError('该定义还没有已发布的修订，先发布第一版。');
      return;
    }
    setBusy(true);
    try {
      const revision = await workflowApi.revision(definition.currentPublishedRevisionId);
      const next = {
        ...revision.definition,
        baseRevisionId: definition.currentPublishedRevisionId,
      };
      resetDraft(JSON.stringify(next, null, 2), definition.currentRevision);
      setNotice(
        `已载入 ${definition.workflowKey} 第 ${definition.currentRevision} 版作为下一版基线；baseRevisionId 已指向当前已发布修订。`,
      );
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function validate() {
    if (!projectId) return;
    setBusy(true);
    setError('');
    setNotice('');
    setValidation(null);
    setPending(null);
    try {
      const definition = parseDefinition(editorText);
      const roleKeys = usedWorkflowRoleKeys(definition);
      const { locks, missing } = pickPackageLocks(roleKeys, packages);
      setMissingLocks(missing);
      const result = await workflowApi.validate(projectId, { definition, packageLocks: locks });
      setValidation(result);
      if (!result.valid) return;
      if (missing.length > 0) return;
      if (!result.digest) {
        setError('服务端未返回编译摘要，无法签发发布票据。');
        return;
      }
      setPending({
        workflowKey: String(definition.workflowKey),
        expectedCurrentRevision,
        definition,
        locks,
        digest: result.digest,
      });
      setNotice('校验通过：可以发布。发布前会要求二次验证并签发一次性票据。');
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function publish(
    target: PublishTarget,
    confirmation: { ticketId: string; ticketSecret: string },
  ) {
    if (!projectId || projectVersion === null) throw new Error('缺少项目版本，无法发布。');
    await workflowApi.publish(projectId, target.workflowKey, {
      expectedVersion: projectVersion,
      expectedCurrentRevision: target.expectedCurrentRevision,
      definition: target.definition,
      packageLocks: target.locks,
      confirmation,
    });
    const refreshed = await loadProjects(true);
    const current = refreshed.find((project) => project.id === projectId);
    if (current) setProjectVersion(current.version);
    setNotice(`流程 ${target.workflowKey} 已发布。需求页即可用该修订创建流程实例。`);
    setValidation(null);
    setPending(null);
    await load();
  }

  const binding: ActionBindingInput | null =
    publishTarget && projectId && projectVersion !== null
      ? {
          action: WORKFLOW_PUBLISH_ACTION,
          projectId,
          targetType: WORKFLOW_DEFINITION_TARGET,
          targetId: publishTarget.workflowKey,
          expectedVersion: projectVersion,
          roleSlot: null,
          payload: {
            expectedCurrentRevision: publishTarget.expectedCurrentRevision,
            compiledDigest: publishTarget.digest,
            packageLocks: publishTarget.locks.map((lock) => ({
              roleKey: lock.roleKey,
              packageId: lock.packageId,
              version: lock.version,
              packageDigest: lock.packageDigest,
            })),
          },
        }
      : null;

  const canPublish =
    Boolean(pending) && pending !== null && missingLocks.length === 0 && projectVersion !== null;

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>流程配置</h2>
          <p className="page-sub">
            流程定义必须先发布，需求才能创建实例。发布是人工确认动作：校验 → 二次验证 → 一次性票据。
          </p>
        </div>
        <div className="page-actions">
          <ProjectSelect onChange={() => setDefinitions([])} />
          <button className="ghost" disabled={!projectId || busy} onClick={() => void load()}>
            刷新
          </button>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="kb-notice">{notice}</p>}
      {!projectId && <p className="page-card muted">先选择项目。</p>}

      <div className="table-card">
        <div className="card-head">
          <h3>标准流程模板</h3>
        </div>
        <p className="page-sub">
          模板只在本地预填，不会被直接信任：服务端会用项目当前的活动角色与角色包重新编译。
          被引用的角色必须有已登记的角色包版本，否则编译期就会失败。
        </p>
        <div className="toolbar">
          <button className="ghost" disabled={!projectId || busy} onClick={loadTemplate}>
            载入标准模板
          </button>
          <button
            className="primary"
            disabled={!projectId || busy || !editorText.trim()}
            onClick={() => void validate()}
          >
            {busy ? '校验中…' : '校验并准备发布'}
          </button>
          <span className="page-sub">
            期望当前修订 {expectedCurrentRevision} · 项目版本 {projectVersion ?? '—'}
          </span>
        </div>
        <div className="field">
          <span>流程定义（JSON）</span>
          <textarea
            className="cell-mono"
            aria-label="流程定义 JSON"
            rows={16}
            value={editorText}
            onChange={(event) => {
              setEditorText(event.target.value);
              setValidation(null);
              setPending(null);
            }}
            placeholder="点击「载入标准模板」开始，或粘贴已有的流程定义。"
          />
        </div>
      </div>

      {missingLocks.length > 0 && (
        <div className="table-card">
          <div className="card-head">
            <h3>缺少角色包</h3>
          </div>
          <p className="error" role="alert">
            以下角色还没有已登记的角色包版本，工作流无法发布：
            {missingLocks
              .map((roleKey) => `${roleKey}（${roleTitles.get(roleKey) ?? '未命名角色'}）`)
              .join('、')}
            。
          </p>
          <p className="page-sub">
            用 <code>workmesh roles install --package &lt;dir&gt; --project {projectId}</code>{' '}
            登记角色包后回到本页刷新。
          </p>
        </div>
      )}

      {validation && (
        <div className="table-card">
          <div className="card-head">
            <h3>
              校验结果
              <small>{validation.valid ? '通过' : '未通过'}</small>
            </h3>
          </div>
          {validation.digest && (
            <p className="page-sub">
              编译摘要 <span className="cell-mono">{validation.digest}</span>
            </p>
          )}
          {validation.issues.length === 0 ? (
            <p className="page-sub">结构与语义校验全部通过。</p>
          ) : (
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
                  {validation.issues.map((issue, index) => (
                    <tr key={`${issue.path}-${issue.code}-${index}`}>
                      <td className="cell-mono">{issue.path}</td>
                      <td>
                        <span className="status-tag">{issue.code}</span>
                      </td>
                      <td>{issue.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="toolbar">
            <button
              className="primary"
              disabled={!canPublish || busy}
              onClick={() => {
                if (pending) setPublishTarget(pending);
              }}
            >
              发布（需要二次验证）
            </button>
          </div>
        </div>
      )}

      <div className="table-card">
        <div className="card-head">
          <h3>
            流程定义<small>{definitions.length}</small>
          </h3>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>workflowKey</th>
                <th>标题</th>
                <th>当前修订</th>
                <th>已发布修订</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {definitions.map((definition) => (
                <tr key={definition.workflowKey}>
                  <td className="cell-mono">{definition.workflowKey}</td>
                  <td>{definition.title}</td>
                  <td className="cell-num">v{definition.currentRevision}</td>
                  <td className="cell-mono">{definition.currentPublishedRevisionId ?? '未发布'}</td>
                  <td className="col-actions">
                    <button
                      className="ghost"
                      disabled={busy || !definition.currentPublishedRevisionId}
                      onClick={() => void loadPublishedRevision(definition)}
                    >
                      载入为下一版
                    </button>
                  </td>
                </tr>
              ))}
              {definitions.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={5}>
                    {projectId ? '还没有已发布的流程定义，先载入标准模板并发布。' : '先选择项目。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmationPrompt
        open={Boolean(publishTarget)}
        title="发布流程定义"
        description={
          publishTarget
            ? `将发布 ${publishTarget.workflowKey}，绑定 ${publishTarget.locks.length} 个角色包锁。摘要变化或版本变化都会被服务端拒绝。`
            : ''
        }
        binding={binding}
        submitLabel="确认发布流程"
        onClose={() => setPublishTarget(null)}
        onConfirmed={async (confirmation) => {
          if (!publishTarget) return;
          await publish(publishTarget, confirmation);
          setPublishTarget(null);
        }}
      />
    </section>
  );
}
