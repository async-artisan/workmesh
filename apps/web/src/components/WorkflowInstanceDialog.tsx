import { useEffect, useMemo, useState } from 'react';
import { formatApiError } from '../api/client';
import {
  repositoryApi,
  requirementApi,
  workflowApi,
  type MemberView,
  type ProjectRepositoryView,
  type RequirementView,
  type RoleView,
  type WorkflowDefinitionView,
  type WorkflowRevisionView,
  type WorkflowSlotDefinition,
  type WorkflowStepDefinition,
} from '../api/resources';
import {
  buildInstanceBindings,
  defaultAcceptanceOwners,
  isImplStep,
} from '../lib/workflowInstance';
import { Modal } from './Modal';

interface WorkflowInstanceDialogProps {
  open: boolean;
  requirement: RequirementView | null;
  definitions: WorkflowDefinitionView[];
  roles: RoleView[];
  members: MemberView[];
  onClose: () => void;
  onCreated: (message: string) => void;
}

function isStep(value: unknown): value is WorkflowStepDefinition {
  if (!value || typeof value !== 'object') return false;
  const step = value as Record<string, unknown>;
  return typeof step.key === 'string' && typeof step.roleKey === 'string';
}

function isSlot(value: unknown): value is WorkflowSlotDefinition {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Record<string, unknown>;
  return typeof slot.key === 'string' && typeof slot.roleKey === 'string';
}

function readSteps(definition: Record<string, unknown>): WorkflowStepDefinition[] {
  return Array.isArray(definition.steps) ? definition.steps.filter(isStep) : [];
}

function readSlots(definition: Record<string, unknown>): WorkflowSlotDefinition[] {
  return Array.isArray(definition.roleSlots) ? definition.roleSlots.filter(isSlot) : [];
}

/**
 * 管理员初始化流程实例：责任人、审批人、代码仓库与验收归属都必须逐项显式选择。
 * 同角色的审批槽审批人不得与步骤责任人相同，避免把“作者自审”做成默认值。
 *
 * 这里的四类输入与服务端的四条硬规则一一对应：
 * - 步骤责任人 → 任务的责任人（人，不是角色）；
 * - IMPL 步骤的仓库 → 交付的 GIT_REF 必须落在已登记仓库里；
 * - 验收条目归属 → PRD 的每条验收至少被一个任务覆盖；
 * - 审批槽审批人 → 不能是该步骤责任人。
 */
export function WorkflowInstanceDialog({
  open,
  requirement,
  definitions,
  roles,
  members,
  onClose,
  onCreated,
}: WorkflowInstanceDialogProps) {
  const [revisionId, setRevisionId] = useState('');
  const [revision, setRevision] = useState<WorkflowRevisionView | null>(null);
  const [steps, setSteps] = useState<WorkflowStepDefinition[]>([]);
  const [slots, setSlots] = useState<WorkflowSlotDefinition[]>([]);
  const [stepUsers, setStepUsers] = useState<Record<string, string>>({});
  const [slotUsers, setSlotUsers] = useState<Record<string, string>>({});
  const [repositories, setRepositories] = useState<ProjectRepositoryView[]>([]);
  const [repoSelect, setRepoSelect] = useState<Record<string, string[]>>({});
  const [acceptanceKeys, setAcceptanceKeys] = useState<string[]>([]);
  const [acceptanceOwners, setAcceptanceOwners] = useState<Record<string, string>>({});
  const [repoForm, setRepoForm] = useState({
    owner: '',
    name: '',
    externalId: '',
    defaultBranch: 'main',
  });
  const [repoBusy, setRepoBusy] = useState(false);
  const [repoError, setRepoError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const published = definitions.filter((definition) => definition.currentPublishedRevisionId);
  const implSteps = useMemo(() => steps.filter(isImplStep), [steps]);

  useEffect(() => {
    if (!open) return;
    const first = published[0]?.currentPublishedRevisionId ?? '';
    setRevisionId(first);
    setRevision(null);
    setSteps([]);
    setSlots([]);
    setStepUsers({});
    setSlotUsers({});
    setRepositories([]);
    setRepoSelect({});
    setAcceptanceKeys([]);
    setAcceptanceOwners({});
    setRepoForm({ owner: '', name: '', externalId: '', defaultBranch: 'main' });
    setRepoError('');
    setError('');
    // `published` 由父级 definitions 派生；打开时取第一个已发布修订即可。
  }, [open, requirement?.id, definitions]);

  // 仓库范围与验收条目来自项目与需求本身，与流程修订无关，打开时各取一次。
  // 两个请求互不阻塞：仓库取不到只影响 IMPL 步骤，验收取不到就当没有 PRD。
  useEffect(() => {
    if (!open || !requirement) return;
    let alive = true;
    setRepoError('');
    Promise.allSettled([
      repositoryApi.list(requirement.projectId),
      requirementApi.detail(requirement.projectId, requirement.id),
    ]).then(([repoResult, detailResult]) => {
      if (!alive) return;
      if (repoResult.status === 'fulfilled') setRepositories(repoResult.value);
      else setRepoError(formatApiError(repoResult.reason));
      if (detailResult.status === 'fulfilled')
        setAcceptanceKeys(detailResult.value.acceptanceKeys ?? []);
      else setAcceptanceKeys([]);
    });
    return () => {
      alive = false;
    };
  }, [open, requirement?.id, requirement?.projectId]);

  useEffect(() => {
    if (!open || !revisionId) {
      setRevision(null);
      return;
    }
    let alive = true;
    setRevision(null);
    setSteps([]);
    setSlots([]);
    setStepUsers({});
    setSlotUsers({});
    setRepoSelect({});
    setAcceptanceOwners({});
    setError('');
    workflowApi
      .revision(revisionId)
      .then((value) => {
        if (!alive) return;
        const nextSteps = readSteps(value.definition);
        const nextSlots = readSlots(value.definition);
        setRevision(value);
        setSteps(nextSteps);
        setSlots(nextSlots);
        if (nextSteps.length === 0) setError('该流程定义没有步骤，无法创建实例。');
      })
      .catch((caught: unknown) => {
        if (alive) setError(formatApiError(caught));
      });
    return () => {
      alive = false;
    };
  }, [open, revisionId]);

  // 默认值只补空位：项目只有一个仓库时自动勾上，验收默认归到验证步骤。
  useEffect(() => {
    if (!revision) return;
    setRepoSelect((current) => {
      const only = repositories.length === 1 ? repositories[0].id : null;
      let changed = false;
      const next = { ...current };
      for (const step of steps) {
        if (!isImplStep(step)) continue;
        if ((next[step.key] ?? []).length > 0) continue;
        if (!only) continue;
        next[step.key] = [only];
        changed = true;
      }
      return changed ? next : current;
    });
    setAcceptanceOwners((current) => {
      const defaults = defaultAcceptanceOwners(acceptanceKeys, steps);
      let changed = false;
      const next = { ...current };
      for (const [key, owner] of Object.entries(defaults)) {
        if (next[key]) continue;
        next[key] = owner;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [revision, repositories, steps, acceptanceKeys]);

  const roleTitle = useMemo(() => {
    const byKey = new Map(roles.map((role) => [role.key, role.title]));
    return (roleKey: string) => byKey.get(roleKey) ?? roleKey;
  }, [roles]);

  const conflicts = useMemo(() => {
    const messages: string[] = [];
    for (const slot of slots) {
      const approver = slotUsers[slot.key];
      if (!approver) continue;
      for (const step of steps) {
        if (step.roleKey !== slot.roleKey) continue;
        if (stepUsers[step.key] === approver) {
          messages.push(`「${slot.key}」的审批人与「${step.key}」的责任人相同`);
        }
      }
    }
    return messages;
  }, [slots, steps, slotUsers, stepUsers]);

  const missing =
    steps.some((step) => !stepUsers[step.key]) || slots.some((slot) => !slotUsers[slot.key]);
  const repoMissing = implSteps.some((step) => (repoSelect[step.key] ?? []).length === 0);
  const acceptanceMissing = acceptanceKeys.some((key) => !acceptanceOwners[key]);
  const canSubmit = Boolean(
    requirement &&
    revision &&
    !busy &&
    !missing &&
    !repoMissing &&
    !acceptanceMissing &&
    conflicts.length === 0 &&
    steps.length > 0,
  );

  function toggleRepo(stepKey: string, repositoryId: string, checked: boolean) {
    setRepoSelect((current) => {
      const chosen = new Set(current[stepKey] ?? []);
      if (checked) chosen.add(repositoryId);
      else chosen.delete(repositoryId);
      return { ...current, [stepKey]: [...chosen] };
    });
  }

  async function registerRepository() {
    if (!requirement) return;
    const owner = repoForm.owner.trim();
    const name = repoForm.name.trim();
    if (!owner || !name) {
      setRepoError('仓库 owner 与 name 都要填。');
      return;
    }
    setRepoBusy(true);
    setRepoError('');
    try {
      const created = await repositoryApi.create(requirement.projectId, {
        owner,
        name,
        externalId: repoForm.externalId.trim() || `${owner}/${name}`,
        defaultBranch: repoForm.defaultBranch.trim() || undefined,
      });
      setRepositories((current) => [...current, created]);
      setRepoSelect((current) => {
        const next = { ...current };
        for (const step of implSteps) {
          next[step.key] = [...new Set([...(next[step.key] ?? []), created.id])];
        }
        return next;
      });
      setRepoForm({ owner: '', name: '', externalId: '', defaultBranch: 'main' });
    } catch (caught) {
      setRepoError(formatApiError(caught));
    } finally {
      setRepoBusy(false);
    }
  }

  async function submit() {
    if (!requirement || !revisionId) return;
    setBusy(true);
    setError('');
    try {
      const { stepBindings, roleSlotBindings } = buildInstanceBindings({
        steps,
        slots,
        roles,
        stepUsers,
        slotUsers,
        repositories: repoSelect,
        acceptanceKeys,
        acceptanceOwners,
      });
      await workflowApi.createInstance(requirement.id, {
        definitionRevisionId: revisionId,
        expectedRequirementVersion: requirement.version,
        stepBindings,
        roleSlotBindings,
      });
      onCreated(`需求 ${requirement.code} 的流程实例已创建。`);
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="初始化流程实例"
      description={requirement ? `${requirement.code} · ${requirement.title}` : ''}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="primary" onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? '创建中…' : '确认创建'}
          </button>
        </>
      }
    >
      {published.length === 0 ? (
        <p className="page-card muted">
          该项目还没有已发布的流程定义。先到「流程」页发布，再回来初始化实例。
        </p>
      ) : (
        <div className="form-grid">
          <div className="field">
            <span>已发布流程</span>
            <select
              className="select"
              aria-label="已发布流程"
              value={revisionId}
              onChange={(event) => setRevisionId(event.target.value)}
            >
              {published.map((definition) => (
                <option
                  key={definition.workflowKey}
                  value={definition.currentPublishedRevisionId ?? ''}
                >
                  {definition.title}（{definition.workflowKey} · 第 {definition.currentRevision}{' '}
                  版）
                </option>
              ))}
            </select>
          </div>

          {!revision && !error && <p className="modal-note">正在读取流程定义…</p>}

          {revision && steps.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>步骤</th>
                    <th>角色</th>
                    <th>责任人</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((step) => (
                    <tr key={step.key}>
                      <td>
                        <span className="cell-mono">{step.key}</span>
                      </td>
                      <td>{roleTitle(step.roleKey)}</td>
                      <td>
                        <select
                          className="select"
                          aria-label={`步骤 ${step.key} 责任人`}
                          value={stepUsers[step.key] ?? ''}
                          onChange={(event) =>
                            setStepUsers((current) => ({
                              ...current,
                              [step.key]: event.target.value,
                            }))
                          }
                        >
                          <option value="">选择责任人</option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name || member.email}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {revision && implSteps.length > 0 && (
            <div className="field">
              <span>代码仓库范围（IMPL 步骤必须声明）</span>
              {repositories.length === 0 ? (
                <div className="page-card muted">
                  <p>
                    这个项目还没有登记代码仓库。IMPL
                    步骤交付的提交必须落回已登记的仓库，先登记一个：
                  </p>
                  <div className="form-grid">
                    <label className="field">
                      <span>仓库 owner</span>
                      <input
                        aria-label="仓库 owner"
                        value={repoForm.owner}
                        placeholder="例如 yesgoo"
                        onChange={(event) =>
                          setRepoForm((current) => ({ ...current, owner: event.target.value }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>仓库 name</span>
                      <input
                        aria-label="仓库 name"
                        value={repoForm.name}
                        placeholder="例如 yifanfan"
                        onChange={(event) =>
                          setRepoForm((current) => ({ ...current, name: event.target.value }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>默认分支</span>
                      <input
                        aria-label="默认分支"
                        value={repoForm.defaultBranch}
                        onChange={(event) =>
                          setRepoForm((current) => ({
                            ...current,
                            defaultBranch: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>GitHub 仓库 ID（可留空）</span>
                      <input
                        aria-label="GitHub 仓库 ID"
                        value={repoForm.externalId}
                        placeholder="留空则用 owner/name"
                        onChange={(event) =>
                          setRepoForm((current) => ({ ...current, externalId: event.target.value }))
                        }
                      />
                    </label>
                  </div>
                  <button
                    className="ghost"
                    onClick={() => void registerRepository()}
                    disabled={repoBusy}
                  >
                    {repoBusy ? '登记中…' : '登记仓库'}
                  </button>
                  {repoError && (
                    <p className="modal-error" role="alert">
                      {repoError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="form-grid">
                  {implSteps.map((step) => (
                    <div key={step.key} className="field">
                      <span className="cell-mono">{step.key}</span>
                      <div className="role-chips">
                        {repositories.map((repository) => {
                          const chosen = (repoSelect[step.key] ?? []).includes(repository.id);
                          return (
                            <label
                              key={repository.id}
                              className={`chip${chosen ? ' is-active' : ''}`}
                            >
                              <input
                                type="checkbox"
                                aria-label={`步骤 ${step.key} 仓库 ${repository.owner}/${repository.name}`}
                                checked={chosen}
                                onChange={(event) =>
                                  toggleRepo(step.key, repository.id, event.target.checked)
                                }
                              />
                              {repository.owner}/{repository.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {revision && slots.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>审批槽</th>
                    <th>角色</th>
                    <th>审批人</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => (
                    <tr key={slot.key}>
                      <td>
                        <span className="cell-mono">{slot.key}</span>
                      </td>
                      <td>{roleTitle(slot.roleKey)}</td>
                      <td>
                        <select
                          className="select"
                          aria-label={`审批槽 ${slot.key} 审批人`}
                          value={slotUsers[slot.key] ?? ''}
                          onChange={(event) =>
                            setSlotUsers((current) => ({
                              ...current,
                              [slot.key]: event.target.value,
                            }))
                          }
                        >
                          <option value="">选择审批人</option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name || member.email}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {revision && acceptanceKeys.length > 0 && (
            <div className="field">
              <span>验收条目归属（每条验收至少由一个任务覆盖）</span>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>验收 key</th>
                      <th>由哪个任务负责</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acceptanceKeys.map((key) => (
                      <tr key={key}>
                        <td>
                          <span className="cell-mono">{key}</span>
                        </td>
                        <td>
                          <select
                            className="select"
                            aria-label={`验收 ${key} 归属步骤`}
                            value={acceptanceOwners[key] ?? ''}
                            onChange={(event) =>
                              setAcceptanceOwners((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                          >
                            <option value="">选择步骤</option>
                            {steps.map((step) => (
                              <option key={step.key} value={step.key}>
                                {step.key}（{roleTitle(step.roleKey)}）
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="modal-note">
            责任人与审批人必须逐项选择；同角色的审批槽审批人不能与步骤责任人相同，否则会被判定为自审。
            {implSteps.length > 0 && repositories.length > 0
              ? ' IMPL 步骤至少选一个代码仓库；验收条目默认归到验证步骤，可按需调整。'
              : ''}
          </p>

          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          {conflicts.length > 0 && (
            <p className="modal-error" role="alert">
              不能自审：{conflicts.join('；')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
