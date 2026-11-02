import { useEffect, useMemo, useState } from 'react';
import { formatApiError } from '../api/client';
import {
  workflowApi,
  type MemberView,
  type RequirementView,
  type RoleView,
  type WorkflowDefinitionView,
  type WorkflowRevisionView,
  type WorkflowSlotDefinition,
  type WorkflowStepDefinition,
} from '../api/resources';
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
 * 管理员初始化流程实例：责任人、审批人必须逐项显式选择。
 * 同角色的审批槽审批人不得与步骤责任人相同，避免把“作者自审”做成默认值。
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const published = definitions.filter((definition) => definition.currentPublishedRevisionId);

  useEffect(() => {
    if (!open) return;
    const first = published[0]?.currentPublishedRevisionId ?? '';
    setRevisionId(first);
    setRevision(null);
    setSteps([]);
    setSlots([]);
    setStepUsers({});
    setSlotUsers({});
    setError('');
    // `published` 由父级 definitions 派生；打开时取第一个已发布修订即可。
  }, [open, requirement?.id, definitions]);

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
  const canSubmit = Boolean(
    requirement && revision && !busy && !missing && conflicts.length === 0 && steps.length > 0,
  );

  async function submit() {
    if (!requirement || !revisionId) return;
    setBusy(true);
    setError('');
    try {
      const roleIdByKey = new Map(
        roles.filter((role) => role.isActive !== false).map((role) => [role.key, role.id]),
      );
      const stepBindings = steps.map((step) => {
        const roleId = roleIdByKey.get(step.roleKey);
        if (!roleId) throw new Error(`步骤 ${step.key} 的角色 ${step.roleKey} 未登记`);
        const responsibleUserId = stepUsers[step.key];
        if (!responsibleUserId) throw new Error(`步骤 ${step.key} 未选择责任人`);
        return { stepKey: step.key, roleId, responsibleUserId, repositoryIds: [] };
      });
      const roleSlotBindings = slots.map((slot) => {
        const roleId = roleIdByKey.get(slot.roleKey);
        if (!roleId) throw new Error(`审批槽 ${slot.key} 的角色 ${slot.roleKey} 未登记`);
        const userId = slotUsers[slot.key];
        if (!userId) throw new Error(`审批槽 ${slot.key} 未选择审批人`);
        return { slotKey: slot.key, roleId, userId };
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

          <p className="modal-note">
            责任人与审批人必须逐项选择；同角色的审批槽审批人不能与步骤责任人相同，否则会被判定为自审。
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
