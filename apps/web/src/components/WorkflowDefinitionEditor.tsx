import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import './workflow-definition-editor.css';

export interface WorkflowEditorRole {
  key: string;
  title: string;
}

type JsonObject = Record<string, unknown>;
type Step = JsonObject;
type ObjectEntry = { value: JsonObject; rawIndex: number };

export interface WorkflowEditorIssue {
  path: string;
  code: string;
  message: string;
}

const STEP_KIND_LABELS: Record<string, string> = {
  PRODUCT: '产品',
  DELIVERY: '交付',
  VERIFY: '验证',
  RELEASE: '发布',
};

const SLOT_KIND_LABELS: Record<string, string> = {
  UNDERSTANDING_CONFIRM: '理解确认',
  PRD_PUBLICATION: '需求发布',
  TASK_ACCEPTANCE: '任务验收',
  RELEASE_ACCEPTANCE: '发布验收',
};

const ISSUE_MESSAGES: Record<string, string> = {
  REQUIRED: '此字段为必填项。',
  KEY_INVALID: '标识必须符合格式要求。',
  DUPLICATE_KEY: '标识不能重复。',
  DEPENDENCY_UNKNOWN: '前置依赖引用了不存在的步骤。',
  WORKFLOW_CYCLE: '步骤依赖存在循环，请调整前置依赖。',
  WORKFLOW_ROLE_UNKNOWN: '所选责任角色不存在或已不可用，请重新选择。',
  WORKFLOW_STEP_KIND_INVALID: '步骤类型不受支持，请选择产品、交付、验证或发布。',
  WORKFLOW_SLOT_KIND_INVALID: '评审槽位用途不受支持，请重新选择。',
  WORKFLOW_SLOT_UNKNOWN: '验收规则引用了不存在的评审槽位。',
  WORKFLOW_REVIEWER_REQUIRED: '验收规则至少需要一个评审槽位。',
  WORKFLOW_APPROVAL_MODE_UNSUPPORTED: '当前服务端只支持“全部通过（ALL）”门槛。',
  WORKFLOW_APPROVAL_QUALIFIER_INVALID: '发布验收门槛必须使用“全部通过（ALL）”。',
  WORKFLOW_RELEASE_GATE_REQUIRED: '发布步骤必须配置发布验收门槛。',
  WORKFLOW_VERIFY_GATE_REQUIRED: '跳过验证步骤时必须填写原因和审计引用。',
  WORKFLOW_VERIFY_EXEMPTION_UNNEEDED: '已有验证步骤时不能再填写验证豁免。',
  WORKFLOW_OUTPUT_KINDS_INVALID: '输出工件类型必须是有效的字符串列表。',
  WORKFLOW_OUTPUT_KINDS_DUPLICATE: '输出工件类型不能重复。',
  WORKFLOW_STEP_DISPLAY_NAME_INVALID: '显示名称不能为空白，且不能超过 120 个字符。',
  WORKFLOW_OUTPUT_CONTRACT_MISMATCH: '输出工件类型与责任角色的能力契约不匹配。',
  WORKFLOW_SCOPE_MISMATCH: '当前配置与角色范围不匹配。',
  WORKFLOW_INPUT_BINDING_INVALID: '输入绑定缺少必要信息或格式不正确。',
  WORKFLOW_INPUT_UNKNOWN: '引用了角色包未声明的输入。',
  WORKFLOW_INPUT_DUPLICATE: '输入绑定不能重复。',
  WORKFLOW_INPUT_UNSATISFIED: '必需输入尚未满足。',
  WORKFLOW_INPUT_SOURCE_UNAVAILABLE: '输入来源当前不可用。',
  WORKFLOW_PACKAGE_INCOMPATIBLE: '角色包版本与当前流程不兼容。',
  WORKFLOW_UNKNOWN_FIELD: '此字段由服务端管理，不能在流程定义中提交。',
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseObject(value: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : null;
  } catch {
    return null;
  }
}

function objectEntries(value: unknown): ObjectEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, rawIndex) => (isObject(item) ? [{ value: item, rawIndex }] : []));
}

function objects(value: unknown): JsonObject[] {
  return objectEntries(value).map((entry) => entry.value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Replace the editable string members of an array while retaining values from
 * newer/unknown schema revisions. The structured controls only understand
 * strings, but they must never discard other JSON values supplied by a server
 * or an advanced JSON editor.
 */
function replaceStrings(value: unknown, nextStrings: string[]): unknown[] {
  const unknownMembers = Array.isArray(value)
    ? value.filter((item) => typeof item !== 'string')
    : [];
  return [...nextStrings, ...unknownMembers];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function hasCycle(steps: Step[]): boolean {
  const byKey = new Map(steps.map((step) => [stringValue(step.key), step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(key: string): boolean {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const dep of strings(byKey.get(key)?.deps)) {
      if (byKey.has(dep) && visit(dep)) return true;
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  }
  return Array.from(byKey.keys()).some(visit);
}

function rolesFor(roles: WorkflowEditorRole[], current: string): WorkflowEditorRole[] {
  if (current && !roles.some((role) => role.key === current)) {
    return [{ key: current, title: current + '（当前配置）' }, ...roles];
  }
  return roles;
}

export function WorkflowDefinitionEditor(props: {
  value: string;
  onChange: (value: string) => void;
  roles: WorkflowEditorRole[];
  error?: string;
  issues?: readonly WorkflowEditorIssue[];
  errorId?: string;
  errorRef?: (node: HTMLParagraphElement | null) => void;
  disabled?: boolean;
}) {
  const { value, onChange, roles, error, issues = [], errorId, errorRef, disabled = false } = props;
  const [mode, setMode] = useState<'structured' | 'json'>('json');
  const definition = useMemo(() => parseObject(value), [value]);
  const stepEntries = objectEntries(definition?.steps);
  const steps = stepEntries.map((entry) => entry.value);
  const slotEntries = objectEntries(definition?.roleSlots);
  const slots = slotEntries.map((entry) => entry.value);
  const stepKeys = steps.map((step) => stringValue(step.key));
  const duplicateKeys = new Set(
    stepKeys.filter((key, index) => key && stepKeys.indexOf(key) !== index),
  );
  const cycle = hasCycle(steps);

  function fieldIssues(...paths: string[]): WorkflowEditorIssue[] {
    return issues.filter((issue) =>
      paths.some((path) => issue.path === path || issue.path.startsWith(path + '/')),
    );
  }

  function fieldIssueId(path: string): string {
    return `workflow-issue-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`;
  }

  function issueDescription(path: string, ...aliases: string[]) {
    const matched = fieldIssues(path, ...aliases);
    if (matched.length === 0) return null;
    const id = fieldIssueId(path);
    return (
      <p className="error workflow-field-error" id={id} role="alert">
        {matched
          .map((issue) => {
            const message =
              issue.code === 'WORKFLOW_RELEASE_GATE_REQUIRED'
                ? issue.path === '/steps'
                  ? '流程定义必须包含至少一个发布步骤。'
                  : '发布步骤必须配置发布验收门槛。'
                : (ISSUE_MESSAGES[issue.code] ?? issue.message);
            return `${issue.code}：${message}`;
          })
          .join('；')}
      </p>
    );
  }

  function exactIssueDescription(path: string) {
    const matched = issues.filter((issue) => issue.path === path);
    if (matched.length === 0) return null;
    const id = fieldIssueId(path);
    return (
      <p className="error workflow-field-error" id={id} role="alert">
        {matched
          .map((issue) => {
            const message =
              issue.code === 'WORKFLOW_RELEASE_GATE_REQUIRED'
                ? '流程定义必须包含至少一个发布步骤。'
                : (ISSUE_MESSAGES[issue.code] ?? issue.message);
            return `${issue.code}：${message}`;
          })
          .join('；')}
      </p>
    );
  }

  function update(mutator: (draft: JsonObject) => void) {
    const draft = parseObject(value);
    if (!draft) return;
    mutator(draft);
    onChange(JSON.stringify(draft, null, 2));
  }

  function updateStep(rawIndex: number, mutator: (step: Step) => void) {
    update((draft) => {
      const raw = Array.isArray(draft.steps) ? [...draft.steps] : [];
      if (!isObject(raw[rawIndex])) return;
      const next = { ...raw[rawIndex] };
      mutator(next);
      raw[rawIndex] = next;
      draft.steps = raw;
    });
  }

  function updateSlot(rawIndex: number, mutator: (slot: JsonObject) => void) {
    update((draft) => {
      const raw = Array.isArray(draft.roleSlots) ? [...draft.roleSlots] : [];
      if (!isObject(raw[rawIndex])) return;
      const next = { ...raw[rawIndex] };
      mutator(next);
      raw[rawIndex] = next;
      draft.roleSlots = raw;
    });
  }

  function updateGate(
    stepRawIndex: number,
    gateRawIndex: number,
    mutator: (gate: JsonObject) => void,
  ) {
    updateStep(stepRawIndex, (step) => {
      const raw = Array.isArray(step.gates) ? [...step.gates] : [];
      if (!isObject(raw[gateRawIndex])) return;
      const next = { ...raw[gateRawIndex] };
      mutator(next);
      raw[gateRawIndex] = next;
      step.gates = raw;
    });
  }

  function dependencyWouldCycle(stepIndex: number, dependency: string): boolean {
    const target = steps[stepIndex];
    if (!target || !dependency) return false;
    const next = steps.map((step, index) =>
      index === stepIndex
        ? {
            ...step,
            deps: replaceStrings(
              step.deps,
              Array.from(new Set([...strings(step.deps), dependency])),
            ),
          }
        : step,
    );
    return hasCycle(next);
  }

  function stepError(index: number): string | null {
    const key = stringValue(steps[index]?.key);
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(key))
      return '步骤 key 必须以小写字母开头，且只含小写字母、数字和连字符。';
    if (duplicateKeys.has(key)) return '步骤 key 重复。';
    const deps = strings(steps[index]?.deps);
    if (deps.includes(key)) return '步骤不能依赖自身。';
    if (deps.some((dep) => !stepKeys.includes(dep))) return '前置依赖必须选择当前已有步骤。';
    if (cycle) return '步骤依赖存在循环，请调整前置依赖。';
    return null;
  }

  return (
    <div className="workflow-definition-editor">
      <div className="workflow-editor-heading">
        <div>
          <h3>流程定义</h3>
          <p>结构化编辑会保留未识别配置；高级 JSON 可直接查看和修改完整定义。</p>
          <p>
            步骤 <code>key</code> 是稳定的机器标识；可选的显示名称只用于业务界面展示。未填写时，
            页面沿用既有映射，无法映射时回退到步骤 key。
          </p>
        </div>
        <div className="workflow-editor-modes" role="group" aria-label="编辑模式">
          <button
            type="button"
            className={mode === 'structured' ? 'active' : ''}
            aria-pressed={mode === 'structured'}
            onClick={() => setMode('structured')}
          >
            结构化编辑
          </button>
          <button
            type="button"
            className={mode === 'json' ? 'active' : ''}
            aria-pressed={mode === 'json'}
            onClick={() => setMode('json')}
          >
            高级 JSON
          </button>
        </div>
      </div>

      {mode === 'json' ? (
        <label className="field workflow-json-field">
          <span>流程定义 JSON</span>
          <textarea
            id="workflow-editor"
            className="cell-mono"
            aria-label="流程定义 JSON"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            rows={16}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            placeholder="点击「载入标准模板」开始，或粘贴已有的流程定义。"
          />
        </label>
      ) : !definition ? (
        <div className="workflow-editor-invalid" role="status">
          当前内容不是 JSON 对象。请切换到“高级 JSON”修复内容；原始文本会保留。
        </div>
      ) : (
        <div className="workflow-structured-form">
          <fieldset disabled={disabled}>
            <legend>发布配置</legend>
            <div className="workflow-editor-grid">
              <label>
                流程 Key
                <input
                  aria-label="流程 Key"
                  aria-invalid={Boolean(fieldIssues('/workflowKey').length)}
                  aria-describedby={
                    fieldIssues('/workflowKey').length ? fieldIssueId('/workflowKey') : undefined
                  }
                  value={stringValue(definition.workflowKey)}
                  onChange={(event) =>
                    update((draft) => {
                      draft.workflowKey = event.target.value;
                    })
                  }
                />
                {issueDescription('/workflowKey')}
              </label>
              <label>
                流程名称
                <input
                  aria-label="流程名称"
                  aria-invalid={Boolean(fieldIssues('/title').length)}
                  aria-describedby={
                    fieldIssues('/title').length ? fieldIssueId('/title') : undefined
                  }
                  value={stringValue(definition.title)}
                  onChange={(event) =>
                    update((draft) => {
                      draft.title = event.target.value;
                    })
                  }
                />
                {issueDescription('/title')}
              </label>
              <label>
                Schema 版本
                <input
                  aria-label="Schema 版本"
                  aria-invalid={Boolean(fieldIssues('/schemaVersion').length)}
                  aria-describedby={
                    fieldIssues('/schemaVersion').length
                      ? fieldIssueId('/schemaVersion')
                      : undefined
                  }
                  value={stringValue(definition.schemaVersion)}
                  onChange={(event) =>
                    update((draft) => {
                      draft.schemaVersion = event.target.value;
                    })
                  }
                />
                {issueDescription('/schemaVersion')}
              </label>
              <label>
                协议版本
                <input
                  aria-label="协议版本"
                  aria-invalid={Boolean(fieldIssues('/protocolVersion').length)}
                  aria-describedby={
                    fieldIssues('/protocolVersion').length
                      ? fieldIssueId('/protocolVersion')
                      : undefined
                  }
                  value={stringValue(definition.protocolVersion)}
                  onChange={(event) =>
                    update((draft) => {
                      draft.protocolVersion = event.target.value;
                    })
                  }
                />
                {issueDescription('/protocolVersion')}
              </label>
              <label className="workflow-wide">
                基础修订 ID
                <input
                  aria-label="基础修订 ID"
                  aria-invalid={Boolean(fieldIssues('/baseRevisionId').length)}
                  aria-describedby={
                    fieldIssues('/baseRevisionId').length
                      ? fieldIssueId('/baseRevisionId')
                      : undefined
                  }
                  value={stringValue(definition.baseRevisionId)}
                  placeholder={definition.baseRevisionId === null ? '首次发布（null）' : ''}
                  onChange={(event) =>
                    update((draft) => {
                      draft.baseRevisionId = event.target.value || null;
                    })
                  }
                />
                {issueDescription('/baseRevisionId')}
              </label>
            </div>
          </fieldset>

          <fieldset disabled={disabled}>
            <legend>步骤</legend>
            {exactIssueDescription('/steps')}
            <div className="workflow-editor-list">
              {steps.map((step, index) => {
                const stepRawIndex = stepEntries[index]?.rawIndex ?? index;
                const currentRole = stringValue(step.roleKey);
                const gateEntries = objectEntries(step.gates);
                const gates = gateEntries.map((entry) => entry.value);
                const currentError = stepError(index);
                return (
                  <section className="workflow-step-editor" key={index}>
                    <div className="workflow-step-heading">
                      <h4>步骤 {index + 1}</h4>
                      <button
                        type="button"
                        className="ghost"
                        aria-label={'删除步骤 ' + (stringValue(step.key) || String(index + 1))}
                        onClick={() =>
                          update((draft) => {
                            const raw = Array.isArray(draft.steps) ? [...draft.steps] : [];
                            const removed = isObject(raw[stepRawIndex])
                              ? stringValue(raw[stepRawIndex].key)
                              : '';
                            raw.splice(stepRawIndex, 1);
                            draft.steps = raw.map((item) => {
                              if (!isObject(item) || !Array.isArray(item.deps)) return item;
                              return {
                                ...item,
                                deps: item.deps.filter((dep) => dep !== removed),
                              };
                            });
                          })
                        }
                      >
                        删除步骤
                      </button>
                    </div>
                    <div className="workflow-editor-grid">
                      <label>
                        步骤 key（服务端唯一标识）
                        <input
                          aria-label={'步骤 ' + (index + 1) + ' key'}
                          aria-invalid={Boolean(
                            currentError || fieldIssues(`/steps/${stepRawIndex}/key`).length,
                          )}
                          aria-describedby={
                            fieldIssues(`/steps/${stepRawIndex}/key`).length
                              ? fieldIssueId(`/steps/${stepRawIndex}/key`)
                              : undefined
                          }
                          value={stringValue(step.key)}
                          onChange={(event) =>
                            update((draft) => {
                              const raw = Array.isArray(draft.steps) ? [...draft.steps] : [];
                              const prior = raw[stepRawIndex];
                              if (!isObject(prior)) return;
                              const oldKey = stringValue(prior.key);
                              const nextKey = event.target.value;
                              raw[stepRawIndex] = { ...prior, key: nextKey };
                              // Keep dependent references aligned when a valid key is renamed.
                              // Empty/invalid keys remain repairable without rewriting unrelated data.
                              if (nextKey && nextKey !== oldKey) {
                                draft.steps = raw.map((item) => {
                                  if (!isObject(item) || !Array.isArray(item.deps)) return item;
                                  return {
                                    ...item,
                                    deps: item.deps.map((dep) => (dep === oldKey ? nextKey : dep)),
                                  };
                                });
                              } else {
                                draft.steps = raw;
                              }
                            })
                          }
                        />
                        {issueDescription(`/steps/${stepRawIndex}/key`)}
                      </label>
                      <label>
                        步骤显示名称（可选）
                        <input
                          aria-label={'步骤 ' + (index + 1) + ' 显示名称'}
                          aria-invalid={Boolean(
                            fieldIssues(`/steps/${stepRawIndex}/displayName`).length,
                          )}
                          aria-describedby={
                            fieldIssues(`/steps/${stepRawIndex}/displayName`).length
                              ? fieldIssueId(`/steps/${stepRawIndex}/displayName`)
                              : undefined
                          }
                          value={stringValue(step.displayName)}
                          placeholder={
                            STEP_KIND_LABELS[stringValue(step.kind)] ?? '按步骤 key 显示'
                          }
                          onChange={(event) =>
                            updateStep(stepRawIndex, (item) => {
                              const rawDisplayName = event.target.value;
                              // 保留输入中的首尾空格，避免 controlled 输入在逐字输入时丢失字符；
                              // 纯空白在失焦时再清理为未设置。
                              if (rawDisplayName === '') delete item.displayName;
                              else item.displayName = rawDisplayName;
                            })
                          }
                          onBlur={(event) => {
                            if (!event.target.value.trim()) {
                              updateStep(stepRawIndex, (item) => {
                                delete item.displayName;
                              });
                            }
                          }}
                        />
                        {issueDescription(`/steps/${stepRawIndex}/displayName`)}
                      </label>
                      <label>
                        责任角色
                        <select
                          aria-label={'步骤 ' + (index + 1) + ' 责任角色'}
                          aria-invalid={Boolean(
                            fieldIssues(`/steps/${stepRawIndex}/roleKey`).length,
                          )}
                          aria-describedby={
                            fieldIssues(`/steps/${stepRawIndex}/roleKey`).length
                              ? fieldIssueId(`/steps/${stepRawIndex}/roleKey`)
                              : undefined
                          }
                          value={currentRole}
                          onChange={(event) =>
                            updateStep(stepRawIndex, (item) => {
                              item.roleKey = event.target.value;
                            })
                          }
                        >
                          <option value="">选择角色</option>
                          {rolesFor(roles, currentRole).map((role) => (
                            <option key={role.key} value={role.key}>
                              {role.title}（{role.key}）
                            </option>
                          ))}
                        </select>
                        {issueDescription(`/steps/${stepRawIndex}/roleKey`)}
                      </label>
                      <label>
                        步骤类型
                        <select
                          aria-label={'步骤 ' + (index + 1) + ' 类型'}
                          aria-invalid={Boolean(fieldIssues(`/steps/${stepRawIndex}/kind`).length)}
                          aria-describedby={
                            fieldIssues(`/steps/${stepRawIndex}/kind`).length
                              ? fieldIssueId(`/steps/${stepRawIndex}/kind`)
                              : undefined
                          }
                          value={stringValue(step.kind)}
                          onChange={(event) =>
                            updateStep(stepRawIndex, (item) => {
                              item.kind = event.target.value;
                            })
                          }
                        >
                          {['PRODUCT', 'DELIVERY', 'VERIFY', 'RELEASE'].map((kind) => (
                            <option key={kind} value={kind} title={kind}>
                              {STEP_KIND_LABELS[kind]}
                            </option>
                          ))}
                        </select>
                        {issueDescription(`/steps/${stepRawIndex}/kind`)}
                      </label>
                      <label>
                        输出工件类型
                        <textarea
                          aria-label={'步骤 ' + (index + 1) + ' 输出工件类型'}
                          aria-invalid={Boolean(
                            fieldIssues(`/steps/${stepRawIndex}/outputKinds`).length,
                          )}
                          aria-describedby={
                            fieldIssues(`/steps/${stepRawIndex}/outputKinds`).length
                              ? fieldIssueId(`/steps/${stepRawIndex}/outputKinds`)
                              : undefined
                          }
                          rows={2}
                          value={strings(step.outputKinds).join('\n')}
                          onChange={(event) =>
                            updateStep(stepRawIndex, (item) => {
                              item.outputKinds = replaceStrings(
                                item.outputKinds,
                                event.target.value
                                  .split(/[\n,]/)
                                  .map((entry) => entry.trim())
                                  .filter(Boolean),
                              );
                            })
                          }
                        />
                        {issueDescription(`/steps/${stepRawIndex}/outputKinds`)}
                      </label>
                      <div className="workflow-wide workflow-dependencies">
                        <span className="workflow-field-label">前置依赖</span>
                        {steps.map((candidate, candidateIndex) =>
                          candidateIndex === index ? null : (
                            <label className="workflow-check" key={candidateIndex}>
                              {(() => {
                                const candidateKey = stringValue(candidate.key);
                                const candidateInvalid =
                                  !candidateKey || duplicateKeys.has(candidateKey);
                                const checked = strings(step.deps).includes(candidateKey);
                                return (
                                  <>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={
                                        !checked &&
                                        (candidateInvalid ||
                                          dependencyWouldCycle(index, candidateKey))
                                      }
                                      onChange={(event) =>
                                        updateStep(stepRawIndex, (item) => {
                                          const deps = new Set(strings(item.deps));
                                          const dep = candidateKey;
                                          if (event.target.checked) deps.add(dep);
                                          else deps.delete(dep);
                                          item.deps = replaceStrings(item.deps, Array.from(deps));
                                        })
                                      }
                                    />
                                    {candidateKey || '未命名步骤'}
                                    {candidateInvalid && '（key 无效或重复）'}
                                  </>
                                );
                              })()}
                            </label>
                          ),
                        )}
                        {issueDescription(`/steps/${stepRawIndex}/deps`)}
                      </div>
                      {currentError && (
                        <p className="error workflow-wide" role="alert">
                          {currentError}
                        </p>
                      )}
                      <div className="workflow-wide workflow-gates">
                        <div className="workflow-gates-heading">
                          <div>
                            <h5>验收规则与评审槽位</h5>
                            <p>选择本步骤需要通过的评审槽位。</p>
                          </div>
                          <button
                            type="button"
                            className="ghost workflow-gate-add"
                            onClick={() =>
                              updateStep(stepRawIndex, (item) => {
                                item.gates = [
                                  ...(Array.isArray(item.gates) ? item.gates : []),
                                  { mode: 'ALL', reviewerSlots: [] },
                                ];
                              })
                            }
                          >
                            <Plus size={16} aria-hidden="true" />
                            添加验收/评审规则
                          </button>
                        </div>
                        {gates.length === 0 && (
                          <p className="workflow-gates-empty">尚未配置验收/评审规则。</p>
                        )}
                        {gates.map((gate, gateIndex) => {
                          const gateRawIndex = gateEntries[gateIndex]?.rawIndex ?? gateIndex;
                          return (
                            <div className="workflow-gate-row" key={gateIndex}>
                              <div className="workflow-gate-heading">
                                <span>规则 {gateIndex + 1}</span>
                                <button
                                  type="button"
                                  className="ghost workflow-gate-remove"
                                  aria-label={
                                    '删除步骤 ' + (index + 1) + ' 评审门槛 ' + (gateIndex + 1)
                                  }
                                  onClick={() =>
                                    updateStep(stepRawIndex, (item) => {
                                      const next = Array.isArray(item.gates) ? [...item.gates] : [];
                                      next.splice(gateRawIndex, 1);
                                      item.gates = next;
                                    })
                                  }
                                >
                                  <Trash2 size={15} aria-hidden="true" />
                                  移除
                                </button>
                              </div>
                              <div className="workflow-gate-fields">
                                <label className="workflow-gate-mode">
                                  通过门槛
                                  <select
                                    aria-label={
                                      '步骤 ' + (index + 1) + ' 评审门槛 ' + (gateIndex + 1)
                                    }
                                    aria-invalid={Boolean(
                                      fieldIssues(
                                        `/steps/${stepRawIndex}/gates/${gateRawIndex}/mode`,
                                      ).length,
                                    )}
                                    aria-describedby={
                                      fieldIssues(
                                        `/steps/${stepRawIndex}/gates/${gateRawIndex}/mode`,
                                      ).length
                                        ? fieldIssueId(
                                            `/steps/${stepRawIndex}/gates/${gateRawIndex}/mode`,
                                          )
                                        : undefined
                                    }
                                    value={stringValue(gate.mode) || 'ALL'}
                                    onChange={(event) =>
                                      updateGate(stepRawIndex, gateRawIndex, (item) => {
                                        item.mode = event.target.value;
                                      })
                                    }
                                  >
                                    <option value="ALL">全部通过（ALL）</option>
                                    <option value="ANY" disabled>
                                      任一通过（ANY，当前服务端不支持）
                                    </option>
                                  </select>
                                  {issueDescription(
                                    `/steps/${stepRawIndex}/gates/${gateRawIndex}/mode`,
                                  )}
                                </label>
                                <div
                                  className="workflow-slot-checks"
                                  role="group"
                                  aria-label={
                                    '步骤 ' +
                                    (index + 1) +
                                    ' 规则 ' +
                                    (gateIndex + 1) +
                                    ' 的评审槽位'
                                  }
                                >
                                  <div className="workflow-slot-checks-heading">
                                    <span>评审槽位</span>
                                    <span>
                                      已选{' '}
                                      {
                                        slots.filter((slot) =>
                                          strings(gate.reviewerSlots).includes(
                                            stringValue(slot.key),
                                          ),
                                        ).length
                                      }{' '}
                                      项
                                    </span>
                                  </div>
                                  <div className="workflow-slot-options">
                                    {slots.map((slot, slotIndex) => {
                                      const slotKey = stringValue(slot.key);
                                      const selected = strings(gate.reviewerSlots).includes(
                                        slotKey,
                                      );
                                      const purpose =
                                        SLOT_KIND_LABELS[stringValue(slot.kind)] ||
                                        slotKey ||
                                        '未命名槽位';
                                      const roleKey = stringValue(slot.roleKey);
                                      const roleTitle =
                                        roles.find((role) => role.key === roleKey)?.title ||
                                        roleKey;
                                      return (
                                        <label
                                          className={
                                            'workflow-check workflow-review-slot' +
                                            (selected ? ' is-selected' : '')
                                          }
                                          key={slotIndex}
                                        >
                                          <input
                                            type="checkbox"
                                            aria-label={slotKey || '未命名槽位'}
                                            aria-invalid={Boolean(
                                              fieldIssues(
                                                `/steps/${stepRawIndex}/gates/${gateRawIndex}/reviewerSlots`,
                                              ).length,
                                            )}
                                            aria-describedby={
                                              fieldIssues(
                                                `/steps/${stepRawIndex}/gates/${gateRawIndex}/reviewerSlots`,
                                              ).length
                                                ? fieldIssueId(
                                                    `/steps/${stepRawIndex}/gates/${gateRawIndex}/reviewerSlots`,
                                                  )
                                                : undefined
                                            }
                                            checked={selected}
                                            onChange={(event) =>
                                              updateGate(stepRawIndex, gateRawIndex, (item) => {
                                                const selected = new Set(
                                                  strings(item.reviewerSlots),
                                                );
                                                const slotKey = stringValue(slot.key);
                                                if (event.target.checked) selected.add(slotKey);
                                                else selected.delete(slotKey);
                                                item.reviewerSlots = replaceStrings(
                                                  item.reviewerSlots,
                                                  Array.from(selected),
                                                );
                                              })
                                            }
                                          />
                                          <span className="workflow-review-slot-copy">
                                            <span className="workflow-review-slot-title">
                                              {purpose}
                                              {roleTitle && <span> · {roleTitle}</span>}
                                            </span>
                                            <code>{slotKey || '未命名槽位'}</code>
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                  {slots.length === 0 && (
                                    <p className="workflow-slot-empty">
                                      暂无评审槽位，请先在下方添加。
                                    </p>
                                  )}
                                  {issueDescription(
                                    `/steps/${stepRawIndex}/gates/${gateRawIndex}/reviewerSlots`,
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                update((draft) => {
                  const next = Array.isArray(draft.steps) ? [...draft.steps] : [];
                  let number = next.length + 1;
                  let key = 'step-' + number;
                  while (stepKeys.includes(key)) {
                    number += 1;
                    key = 'step-' + number;
                  }
                  draft.steps = [
                    ...next,
                    {
                      key,
                      roleKey: roles[0]?.key || '',
                      kind: 'PRODUCT',
                      deps: [],
                      outputKinds: [],
                      gates: [],
                    },
                  ];
                })
              }
            >
              添加步骤
            </button>
          </fieldset>

          <fieldset disabled={disabled}>
            <legend>评审槽位</legend>
            {slots.map((slot, index) => {
              const slotRawIndex = slotEntries[index]?.rawIndex ?? index;
              const currentRole = stringValue(slot.roleKey);
              return (
                <div className="workflow-slot-row" key={index}>
                  <label>
                    槽位 key
                    <input
                      aria-label={'评审槽位 ' + (index + 1) + ' key'}
                      aria-invalid={Boolean(fieldIssues(`/roleSlots/${slotRawIndex}/key`).length)}
                      aria-describedby={
                        fieldIssues(`/roleSlots/${slotRawIndex}/key`).length
                          ? fieldIssueId(`/roleSlots/${slotRawIndex}/key`)
                          : undefined
                      }
                      value={stringValue(slot.key)}
                      onChange={(event) =>
                        updateSlot(slotRawIndex, (item) => {
                          item.key = event.target.value;
                        })
                      }
                    />
                    {issueDescription(`/roleSlots/${slotRawIndex}/key`)}
                  </label>
                  <label>
                    责任角色
                    <select
                      aria-label={'评审槽位 ' + (index + 1) + ' 责任角色'}
                      aria-invalid={Boolean(
                        fieldIssues(`/roleSlots/${slotRawIndex}/roleKey`).length,
                      )}
                      aria-describedby={
                        fieldIssues(`/roleSlots/${slotRawIndex}/roleKey`).length
                          ? fieldIssueId(`/roleSlots/${slotRawIndex}/roleKey`)
                          : undefined
                      }
                      value={currentRole}
                      onChange={(event) =>
                        updateSlot(slotRawIndex, (item) => {
                          item.roleKey = event.target.value;
                        })
                      }
                    >
                      <option value="">选择角色</option>
                      {rolesFor(roles, currentRole).map((role) => (
                        <option key={role.key} value={role.key}>
                          {role.title}（{role.key}）
                        </option>
                      ))}
                    </select>
                    {issueDescription(`/roleSlots/${slotRawIndex}/roleKey`)}
                  </label>
                  <label>
                    用途
                    <select
                      aria-label={'评审槽位 ' + (index + 1) + ' 用途'}
                      aria-invalid={Boolean(fieldIssues(`/roleSlots/${slotRawIndex}/kind`).length)}
                      aria-describedby={
                        fieldIssues(`/roleSlots/${slotRawIndex}/kind`).length
                          ? fieldIssueId(`/roleSlots/${slotRawIndex}/kind`)
                          : undefined
                      }
                      value={stringValue(slot.kind)}
                      onChange={(event) =>
                        updateSlot(slotRawIndex, (item) => {
                          item.kind = event.target.value;
                        })
                      }
                    >
                      {[
                        'UNDERSTANDING_CONFIRM',
                        'PRD_PUBLICATION',
                        'TASK_ACCEPTANCE',
                        'RELEASE_ACCEPTANCE',
                      ].map((kind) => (
                        <option key={kind} value={kind}>
                          {SLOT_KIND_LABELS[kind]}（{kind}）
                        </option>
                      ))}
                    </select>
                    {issueDescription(`/roleSlots/${slotRawIndex}/kind`)}
                  </label>
                  <button
                    type="button"
                    className="ghost"
                    aria-label={'删除评审槽位 ' + stringValue(slot.key)}
                    onClick={() =>
                      update((draft) => {
                        const next = Array.isArray(draft.roleSlots) ? [...draft.roleSlots] : [];
                        next.splice(slotRawIndex, 1);
                        draft.roleSlots = next;
                      })
                    }
                  >
                    删除槽位
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="ghost"
              onClick={() =>
                update((draft) => {
                  draft.roleSlots = [
                    ...(Array.isArray(draft.roleSlots) ? draft.roleSlots : []),
                    {
                      key: 'review-' + (slots.length + 1),
                      roleKey: roles[0]?.key || '',
                      kind: 'TASK_ACCEPTANCE',
                    },
                  ];
                })
              }
            >
              添加评审槽位
            </button>
          </fieldset>

          <details className="workflow-advanced-fields">
            <summary>其他发布规则</summary>
            <label>
              角色排除（每行一个角色 key）
              <textarea
                aria-label="角色排除"
                aria-invalid={Boolean(fieldIssues('/roleExclusions').length)}
                aria-describedby={
                  fieldIssues('/roleExclusions').length
                    ? fieldIssueId('/roleExclusions')
                    : undefined
                }
                rows={3}
                value={objects(definition.roleExclusions)
                  .map((item) => stringValue(item.roleKey))
                  .join('\n')}
                onChange={(event) =>
                  update((draft) => {
                    const raw = Array.isArray(draft.roleExclusions)
                      ? [...draft.roleExclusions]
                      : [];
                    const existing = objects(raw);
                    const byKey = new Map(
                      existing.map((item) => [stringValue(item.roleKey), item]),
                    );
                    const next = event.target.value
                      .split('\n')
                      .map((key) => key.trim())
                      .filter(Boolean)
                      .map((roleKey) => ({ ...(byKey.get(roleKey) || {}), roleKey }));
                    draft.roleExclusions = [
                      ...raw.filter((item) => !isObject(item) || !stringValue(item.roleKey)),
                      ...next,
                    ];
                  })
                }
              />
              {issueDescription('/roleExclusions')}
            </label>
            <label>
              步骤移除记录（每行“stepKey | reason”）
              <textarea
                aria-label="步骤移除记录"
                aria-invalid={Boolean(fieldIssues('/stepRemovals').length)}
                aria-describedby={
                  fieldIssues('/stepRemovals').length ? fieldIssueId('/stepRemovals') : undefined
                }
                rows={3}
                value={objects(definition.stepRemovals)
                  .map((item) => stringValue(item.stepKey) + ' | ' + stringValue(item.reason))
                  .join('\n')}
                onChange={(event) =>
                  update((draft) => {
                    const raw = Array.isArray(draft.stepRemovals) ? [...draft.stepRemovals] : [];
                    const existing = objects(raw);
                    const byKey = new Map(
                      existing.map((item) => [stringValue(item.stepKey), item]),
                    );
                    const next = event.target.value
                      .split('\n')
                      .map((line) => line.split('|'))
                      .filter((parts) => parts[0]?.trim())
                      .map(([stepKey, reason]) => ({
                        ...(byKey.get(stepKey.trim()) || {}),
                        stepKey: stepKey.trim(),
                        ...(reason?.trim() ? { reason: reason.trim() } : {}),
                      }));
                    draft.stepRemovals = [
                      ...raw.filter((item) => !isObject(item) || !stringValue(item.stepKey)),
                      ...next,
                    ];
                  })
                }
              />
              {issueDescription('/stepRemovals')}
            </label>
            <div className="workflow-editor-grid">
              <label>
                跳过验证的原因
                <input
                  aria-label="跳过验证的原因"
                  aria-invalid={Boolean(
                    fieldIssues('/verificationExemption/reason', '/verificationExemption').length,
                  )}
                  aria-describedby={
                    fieldIssues('/verificationExemption/reason', '/verificationExemption').length
                      ? fieldIssueId('/verificationExemption/reason')
                      : undefined
                  }
                  value={stringValue(
                    (definition.verificationExemption as JsonObject | undefined)?.reason,
                  )}
                  onChange={(event) =>
                    update((draft) => {
                      const prior =
                        draft.verificationExemption &&
                        typeof draft.verificationExemption === 'object'
                          ? (draft.verificationExemption as JsonObject)
                          : {};
                      draft.verificationExemption = { ...prior, reason: event.target.value };
                    })
                  }
                />
                {issueDescription('/verificationExemption/reason', '/verificationExemption')}
              </label>
              <label>
                验证豁免审计引用
                <input
                  aria-label="验证豁免审计引用"
                  aria-invalid={Boolean(
                    fieldIssues('/verificationExemption/auditRef', '/verificationExemption').length,
                  )}
                  aria-describedby={
                    fieldIssues('/verificationExemption/auditRef', '/verificationExemption').length
                      ? fieldIssueId('/verificationExemption/auditRef')
                      : undefined
                  }
                  value={stringValue(
                    (definition.verificationExemption as JsonObject | undefined)?.auditRef,
                  )}
                  onChange={(event) =>
                    update((draft) => {
                      const prior =
                        draft.verificationExemption &&
                        typeof draft.verificationExemption === 'object'
                          ? (draft.verificationExemption as JsonObject)
                          : {};
                      draft.verificationExemption = { ...prior, auditRef: event.target.value };
                    })
                  }
                />
                {issueDescription('/verificationExemption/auditRef', '/verificationExemption')}
              </label>
            </div>
          </details>
          <p className="workflow-editor-note">
            结构化编辑不会绕过服务端编译、角色包契约或发布票据；未知字段会原样保留。
          </p>
        </div>
      )}
      {error && (
        <p className="error" id={errorId} role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      )}
    </div>
  );
}
