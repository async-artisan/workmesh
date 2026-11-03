import { canonicalJson } from './canonical-json';
import { sha256Bytes } from './bytes';
import type { RolePackageManifest } from './schemas';

export type WorkflowIssue = { path: string; code: string; message: string };

export function validateWorkflowDefinition(value: unknown): {
  valid: boolean;
  issues: WorkflowIssue[];
  digest: string | null;
} {
  const issues: WorkflowIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return {
      valid: false,
      issues: [{ path: '/', code: 'WORKFLOW_INVALID', message: 'workflow must be an object' }],
      digest: null,
    };
  const workflow = value as Record<string, unknown>;
  for (const key of [
    'schemaVersion',
    'protocolVersion',
    'workflowKey',
    'title',
    'baseRevisionId',
    'roleExclusions',
    'stepRemovals',
    'roleSlots',
    'steps',
  ]) {
    if (!(key in workflow))
      issues.push({ path: `/${key}`, code: 'REQUIRED', message: 'required field is missing' });
  }
  if (workflow.schemaVersion !== '1.0')
    issues.push({
      path: '/schemaVersion',
      code: 'VERSION_UNSUPPORTED',
      message: 'schemaVersion must be 1.0',
    });
  if (workflow.protocolVersion !== '1.0')
    issues.push({
      path: '/protocolVersion',
      code: 'VERSION_UNSUPPORTED',
      message: 'protocolVersion must be 1.0',
    });
  const steps = Array.isArray(workflow.steps)
    ? (workflow.steps as Array<Record<string, unknown>>)
    : [];
  const stepKeys = new Set<string>();
  for (const [index, step] of steps.entries()) {
    const key = step.key;
    if (typeof key !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(key))
      issues.push({
        path: `/steps/${index}/key`,
        code: 'KEY_INVALID',
        message: 'step key is invalid',
      });
    else if (!stepKeys.add(key))
      issues.push({
        path: `/steps/${index}/key`,
        code: 'DUPLICATE_KEY',
        message: 'step key is duplicated',
      });
    if (!Array.isArray(step.outputKinds))
      issues.push({
        path: `/steps/${index}/outputKinds`,
        code: 'WORKFLOW_OUTPUT_KINDS_INVALID',
        message: 'outputKinds must be an array, using [] for steps without outputs',
      });
    else {
      const seenOutputKinds = new Set<string>();
      for (const [outputIndex, outputKind] of step.outputKinds.entries()) {
        if (typeof outputKind !== 'string' || outputKind.trim().length === 0)
          issues.push({
            path: `/steps/${index}/outputKinds/${outputIndex}`,
            code: 'WORKFLOW_OUTPUT_KINDS_INVALID',
            message: 'output kind must be a non-empty string',
          });
        else if (seenOutputKinds.has(outputKind))
          issues.push({
            path: `/steps/${index}/outputKinds/${outputIndex}`,
            code: 'WORKFLOW_OUTPUT_KINDS_DUPLICATE',
            message: 'output kind is duplicated',
          });
        else seenOutputKinds.add(outputKind);
      }
    }
  }
  for (const [index, step] of steps.entries()) {
    if (!Array.isArray(step.deps)) continue;
    for (const dep of step.deps)
      if (typeof dep !== 'string' || !stepKeys.has(dep))
        issues.push({
          path: `/steps/${index}/deps`,
          code: 'DEPENDENCY_UNKNOWN',
          message: 'dependency does not reference a step',
        });
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byKey = new Map(
    steps.filter((step) => typeof step.key === 'string').map((step) => [step.key as string, step]),
  );
  const visit = (key: string) => {
    if (visiting.has(key)) {
      issues.push({
        path: '/steps',
        code: 'WORKFLOW_CYCLE',
        message: 'workflow dependencies contain a cycle',
      });
      return;
    }
    if (visited.has(key)) return;
    visiting.add(key);
    const deps = byKey.get(key)?.deps;
    if (Array.isArray(deps))
      for (const dep of deps) if (typeof dep === 'string' && byKey.has(dep)) visit(dep);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of byKey.keys()) visit(key);
  const hasRelease = steps.some((step) => step.kind === 'RELEASE');
  if (!hasRelease)
    issues.push({
      path: '/steps',
      code: 'WORKFLOW_RELEASE_GATE_REQUIRED',
      message: 'workflow must contain a release step',
    });
  let digest: string | null = null;
  if (issues.length === 0)
    digest = canonicalJson({
      definition: workflow,
      resolvedRoles: [],
      packageLocks: [],
      systemGates: [],
    });
  return { valid: issues.length === 0, issues, digest };
}

export type WorkflowPackageLock = {
  roleKey: string;
  packageId: string;
  version: string;
  packageDigest: string;
};

export type WorkflowSystemGate = {
  stepKey: string;
  kind: 'CODE_REVIEW_EVIDENCE';
  required: true;
};

export type WorkflowInputSource = {
  stepKey: string;
  inputKey: string;
  required: boolean;
  source: 'TASK_SNAPSHOT' | 'UPSTREAM_ARTIFACT' | 'PUBLISHED_KNOWLEDGE' | 'EXTERNAL_INPUT';
  reference: string;
  fromStepKey?: string;
  reason?: string;
};

export type WorkflowCompiledRules = {
  resolvedRoles: Array<{ stepKey: string; roleKey: string; roleId: string }>;
  packageLocks: WorkflowPackageLock[];
  systemGates: WorkflowSystemGate[];
  inputSources: WorkflowInputSource[];
};

export type WorkflowCompileResult = {
  valid: boolean;
  issues: WorkflowIssue[];
  digest: string | null;
  compiledRules: WorkflowCompiledRules | null;
};

export type WorkflowPackageContract = RolePackageManifest;

const STEP_KINDS = new Set(['PRODUCT', 'DELIVERY', 'VERIFY', 'RELEASE']);
const SLOT_KINDS = new Set([
  'UNDERSTANDING_CONFIRM',
  'PRD_PUBLICATION',
  'TASK_ACCEPTANCE',
  'RELEASE_ACCEPTANCE',
]);
const DIGEST_HEX = /^[0-9a-f]{64}$/;

/**
 * 编译流程：结构校验 → 角色/审批槽/发布门/实现门/包契约语义校验 → canonical digest。
 * 服务端生成 compiledRules，客户端不能自报 systemGates 或绕过 RELEASE_ACCEPTANCE。
 */
export async function compileWorkflowDefinition(
  value: unknown,
  input: {
    roleIdsByKey: Record<string, string>;
    packageLocks: WorkflowPackageLock[];
    /** 服务端编译时传入已登记包的不可变 manifest；纯结构单测可省略。 */
    packageContracts?: WorkflowPackageContract[];
  },
): Promise<WorkflowCompileResult> {
  const structural = validateWorkflowDefinition(value);
  if (!structural.valid)
    return { valid: false, issues: structural.issues, digest: null, compiledRules: null };

  const workflow = value as Record<string, unknown>;
  const issues: WorkflowIssue[] = [];
  const steps = workflow.steps as Array<Record<string, unknown>>;
  const slots = workflow.roleSlots as Array<Record<string, unknown>>;
  const exclusions = workflow.roleExclusions as Array<Record<string, unknown>>;
  const byKey = new Map(
    steps.filter((step) => typeof step.key === 'string').map((step) => [step.key as string, step]),
  );
  const packageContracts = new Map(
    (input.packageContracts ?? []).map((manifest) => [manifest.roleKey, manifest]),
  );

  // 客户端禁止提交 systemGates 等可执行/可绕过的服务端规则。
  for (const forbidden of ['systemGates', 'codeReviewRequired']) {
    if (forbidden in workflow)
      issues.push({
        path: `/${forbidden}`,
        code: 'WORKFLOW_UNKNOWN_FIELD',
        message: 'server-owned field must not be supplied',
      });
  }

  const slotKinds = new Map<string, string>();
  for (const [index, slot] of slots.entries()) {
    const key = slot.key;
    const roleKey = slot.roleKey;
    const kind = slot.kind;
    if (typeof key !== 'string')
      issues.push({
        path: `/roleSlots/${index}/key`,
        code: 'KEY_INVALID',
        message: 'role slot key is invalid',
      });
    else if (slotKinds.has(key))
      issues.push({
        path: `/roleSlots/${index}/key`,
        code: 'DUPLICATE_KEY',
        message: 'role slot key is duplicated',
      });
    else slotKinds.set(key, typeof kind === 'string' ? kind : '');
    if (typeof roleKey !== 'string' || !input.roleIdsByKey[roleKey])
      issues.push({
        path: `/roleSlots/${index}/roleKey`,
        code: 'WORKFLOW_ROLE_UNKNOWN',
        message: 'role slot references an unknown role',
      });
    if (typeof kind !== 'string' || !SLOT_KINDS.has(kind))
      issues.push({
        path: `/roleSlots/${index}/kind`,
        code: 'WORKFLOW_SLOT_KIND_INVALID',
        message: 'role slot kind is invalid',
      });
  }

  for (const [index, exclusion] of exclusions.entries()) {
    if (typeof exclusion.roleKey !== 'string' || !input.roleIdsByKey[exclusion.roleKey])
      issues.push({
        path: `/roleExclusions/${index}/roleKey`,
        code: 'WORKFLOW_ROLE_UNKNOWN',
        message: 'excluded role is unknown',
      });
  }

  const usedRoleKeys = new Set<string>();
  const resolvedRoles: WorkflowCompiledRules['resolvedRoles'] = [];
  const systemGates: WorkflowSystemGate[] = [];
  const inputSources: WorkflowInputSource[] = [];

  for (const [index, step] of steps.entries()) {
    const key = step.key as string;
    const roleKey = step.roleKey;
    const kind = step.kind;
    if (typeof roleKey !== 'string' || !input.roleIdsByKey[roleKey])
      issues.push({
        path: `/steps/${index}/roleKey`,
        code: 'WORKFLOW_ROLE_UNKNOWN',
        message: 'step references an unknown role',
      });
    else {
      usedRoleKeys.add(roleKey);
      resolvedRoles.push({ stepKey: key, roleKey, roleId: input.roleIdsByKey[roleKey] });
    }
    if (kind !== undefined && (typeof kind !== 'string' || !STEP_KINDS.has(kind)))
      issues.push({
        path: `/steps/${index}/kind`,
        code: 'WORKFLOW_STEP_KIND_INVALID',
        message: 'step kind is invalid',
      });

    // PRODUCT/NONE 基线不得产出 IMPL：实现范围不能被伪豁免。
    const outputKinds = Array.isArray(step.outputKinds) ? step.outputKinds : [];
    const manifest = typeof roleKey === 'string' ? packageContracts.get(roleKey) : undefined;
    if (manifest) {
      const declaredOutputs = new Set(
        manifest.outputs.filter((output) => output.channel === 'CANDIDATE').map((output) => output.kind),
      );
      for (const [outputIndex, outputKind] of outputKinds.entries()) {
        if (typeof outputKind !== 'string' || !declaredOutputs.has(outputKind))
          issues.push({
            path: `/steps/${index}/outputKinds/${outputIndex}`,
            code: 'WORKFLOW_OUTPUT_CONTRACT_MISMATCH',
            message: `step output ${String(outputKind)} is not declared by role package ${roleKey}`,
          });
      }
      const deps = Array.isArray(step.deps)
        ? step.deps.filter((dep): dep is string => typeof dep === 'string')
        : [];
      const ancestors = new Set<string>();
      const collectAncestors = (depKey: string) => {
        if (ancestors.has(depKey)) return;
        ancestors.add(depKey);
        const depStep = byKey.get(depKey);
        const depDeps = Array.isArray(depStep?.deps)
          ? depStep.deps.filter((dep): dep is string => typeof dep === 'string')
          : [];
        for (const ancestor of depDeps) collectAncestors(ancestor);
      };
      for (const dep of deps) collectAncestors(dep);
      const rawBindings = step.inputBindings;
      if (rawBindings !== undefined && !Array.isArray(rawBindings))
        issues.push({
          path: `/steps/${index}/inputBindings`,
          code: 'WORKFLOW_INPUT_BINDING_INVALID',
          message: 'inputBindings must be an array',
        });
      const bindings = Array.isArray(rawBindings)
        ? rawBindings.filter(
            (entry): entry is Record<string, unknown> =>
              Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)),
          )
        : [];
      if (Array.isArray(rawBindings) && bindings.length !== rawBindings.length)
        issues.push({
          path: `/steps/${index}/inputBindings`,
          code: 'WORKFLOW_INPUT_BINDING_INVALID',
          message: 'each input binding must be an object',
        });
      const bindingByKey = new Map<string, Record<string, unknown>>();
      for (const [bindingIndex, binding] of bindings.entries()) {
        const inputKey = binding.inputKey;
        if (typeof inputKey !== 'string' || !manifest.inputs.some((entry) => entry.key === inputKey))
          issues.push({
            path: `/steps/${index}/inputBindings/${bindingIndex}/inputKey`,
            code: 'WORKFLOW_INPUT_UNKNOWN',
            message: 'input binding references an unknown package input',
          });
        else if (bindingByKey.has(inputKey))
          issues.push({
            path: `/steps/${index}/inputBindings/${bindingIndex}/inputKey`,
            code: 'WORKFLOW_INPUT_DUPLICATE',
            message: 'package input has more than one source binding',
          });
        else bindingByKey.set(inputKey, binding);
      }
      for (const packageInput of manifest.inputs) {
        const binding = bindingByKey.get(packageInput.key);
        if (packageInput.source === 'TASK_SNAPSHOT' || packageInput.kind === 'CONTEXT') {
          if (binding)
            issues.push({
              path: `/steps/${index}/inputBindings`,
              code: 'WORKFLOW_INPUT_BINDING_INVALID',
              message: `system input ${packageInput.key} is supplied by the task snapshot`,
            });
          if (packageInput.required)
            inputSources.push({
              stepKey: key,
              inputKey: packageInput.key,
              required: packageInput.required,
              source: 'TASK_SNAPSHOT',
              reference: 'task-context',
            });
          continue;
        }
        if (!binding) {
          if (packageInput.required)
            issues.push({
              path: `/steps/${index}/inputBindings`,
              code: 'WORKFLOW_INPUT_UNSATISFIED',
              message: `required input ${packageInput.key} (${packageInput.kind}) has no declared source`,
            });
          continue;
        }
        const source = binding.source;
        if (!['UPSTREAM_ARTIFACT', 'PUBLISHED_KNOWLEDGE', 'EXTERNAL_INPUT'].includes(String(source))) {
          issues.push({
            path: `/steps/${index}/inputBindings`,
            code: 'WORKFLOW_INPUT_BINDING_INVALID',
            message: `input ${packageInput.key} has an unsupported source`,
          });
          continue;
        }
        if (packageInput.source !== 'KNOWLEDGE') {
          issues.push({
            path: `/steps/${index}/inputBindings`,
            code: 'WORKFLOW_INPUT_BINDING_INVALID',
            message: `input ${packageInput.key} does not accept knowledge sources`,
          });
          continue;
        }
        if (source === 'UPSTREAM_ARTIFACT') {
          const fromStepKey = binding.fromStepKey;
          const producer = typeof fromStepKey === 'string' ? byKey.get(fromStepKey) : undefined;
          const producerKinds = Array.isArray(producer?.outputKinds)
            ? producer.outputKinds.filter((kind): kind is string => typeof kind === 'string')
            : [];
          if (
            typeof fromStepKey !== 'string' ||
            !ancestors.has(fromStepKey) ||
            !producerKinds.includes(packageInput.kind)
          ) {
            issues.push({
              path: `/steps/${index}/inputBindings`,
              code: 'WORKFLOW_INPUT_SOURCE_UNAVAILABLE',
              message: `input ${packageInput.key} must reference an ancestor step producing ${packageInput.kind}`,
            });
            continue;
          }
          inputSources.push({
            stepKey: key,
            inputKey: packageInput.key,
            required: packageInput.required,
            source: 'UPSTREAM_ARTIFACT',
            reference: packageInput.kind,
            fromStepKey,
          });
        } else if (source === 'PUBLISHED_KNOWLEDGE') {
          const knowledgeKey = binding.knowledgeKey;
          if (typeof knowledgeKey !== 'string' || knowledgeKey.trim().length === 0 || knowledgeKey.length > 120) {
            issues.push({
              path: `/steps/${index}/inputBindings`,
              code: 'WORKFLOW_INPUT_BINDING_INVALID',
              message: `published knowledge binding for ${packageInput.key} requires a reference`,
            });
            continue;
          }
          inputSources.push({
            stepKey: key,
            inputKey: packageInput.key,
            required: packageInput.required,
            source: 'PUBLISHED_KNOWLEDGE',
            reference: knowledgeKey,
          });
        } else {
          const externalKey = binding.externalKey;
          const reason = binding.reason;
          if (
            typeof externalKey !== 'string' ||
            externalKey.trim().length === 0 ||
            externalKey.length > 120 ||
            typeof reason !== 'string' ||
            reason.trim().length === 0 ||
            reason.length > 500
          ) {
            issues.push({
              path: `/steps/${index}/inputBindings`,
              code: 'WORKFLOW_INPUT_BINDING_INVALID',
              message: `external input ${packageInput.key} requires an externalKey and reason`,
            });
            continue;
          }
          inputSources.push({
            stepKey: key,
            inputKey: packageInput.key,
            required: packageInput.required,
            source: 'EXTERNAL_INPUT',
            reference: externalKey,
            reason,
          });
        }
      }
    }
    if (step.baselinePolicy === 'NONE' && kind === 'PRODUCT' && outputKinds.includes('IMPL'))
      issues.push({
        path: `/steps/${index}/outputKinds`,
        code: 'WORKFLOW_SCOPE_MISMATCH',
        message: 'PRODUCT/NONE step cannot declare IMPL',
      });
    if (outputKinds.includes('IMPL'))
      systemGates.push({ stepKey: key, kind: 'CODE_REVIEW_EVIDENCE', required: true });

    const gates = Array.isArray(step.gates) ? (step.gates as Array<Record<string, unknown>>) : [];
    for (const [gateIndex, gate] of gates.entries()) {
      if (gate.mode !== 'ALL')
        issues.push({
          path: `/steps/${index}/gates/${gateIndex}/mode`,
          code: 'WORKFLOW_APPROVAL_MODE_UNSUPPORTED',
          message: 'only ALL approval mode is supported',
        });
      const reviewers = Array.isArray(gate.reviewerSlots) ? gate.reviewerSlots : [];
      if (reviewers.length === 0)
        issues.push({
          path: `/steps/${index}/gates/${gateIndex}/reviewerSlots`,
          code: 'WORKFLOW_REVIEWER_REQUIRED',
          message: 'gate must reference at least one role slot',
        });
      for (const reviewer of reviewers) {
        if (typeof reviewer !== 'string' || !slotKinds.has(reviewer))
          issues.push({
            path: `/steps/${index}/gates/${gateIndex}/reviewerSlots`,
            code: 'WORKFLOW_SLOT_UNKNOWN',
            message: 'gate references an unknown role slot',
          });
      }
    }
    if (kind === 'RELEASE') {
      const releaseGates = gates.filter((gate) =>
        (Array.isArray(gate.reviewerSlots) ? gate.reviewerSlots : []).some(
          (reviewer) =>
            typeof reviewer === 'string' && slotKinds.get(reviewer) === 'RELEASE_ACCEPTANCE',
        ),
      );
      if (releaseGates.length === 0)
        issues.push({
          path: `/steps/${index}/gates`,
          code: 'WORKFLOW_RELEASE_GATE_REQUIRED',
          message: 'release step requires an ALL RELEASE_ACCEPTANCE gate',
        });
      else if (releaseGates.some((gate) => gate.mode !== 'ALL'))
        issues.push({
          path: `/steps/${index}/gates`,
          code: 'WORKFLOW_APPROVAL_QUALIFIER_INVALID',
          message: 'release gate must be ALL',
        });
    }
  }

  // 有可用 QA 角色时，跳过 VERIFY 必须写入结构化理由与审计引用；否则发布者无法解释
  // 为什么流程越过验证门。该规则只在服务端带有角色包契约时启用，保持纯结构编辑器兼容。
  const hasVerifyStep = steps.some((step) => step.kind === 'VERIFY');
  if (packageContracts.size > 0 && !hasVerifyStep) {
    const exemption = workflow.verificationExemption;
    const reason =
      exemption && typeof exemption === 'object'
        ? (exemption as Record<string, unknown>).reason
        : undefined;
    const auditRef =
      exemption && typeof exemption === 'object'
        ? (exemption as Record<string, unknown>).auditRef
        : undefined;
    if (
      typeof reason !== 'string' ||
      reason.trim().length === 0 ||
      reason.length > 500 ||
      typeof auditRef !== 'string' ||
      auditRef.trim().length === 0 ||
      auditRef.length > 240
    )
      issues.push({
        path: '/verificationExemption',
        code: 'WORKFLOW_VERIFY_GATE_REQUIRED',
        message: 'skipping VERIFY requires a reason and auditRef',
      });
  } else if (packageContracts.size > 0 && hasVerifyStep && workflow.verificationExemption !== undefined) {
    issues.push({
      path: '/verificationExemption',
      code: 'WORKFLOW_VERIFY_EXEMPTION_UNNEEDED',
      message: 'verification exemption is not allowed when a VERIFY step is present',
    });
  }

  for (const [index, exclusion] of exclusions.entries()) {
    if (typeof exclusion.roleKey === 'string' && usedRoleKeys.has(exclusion.roleKey))
      issues.push({
        path: `/roleExclusions/${index}/roleKey`,
        code: 'WORKFLOW_SCOPE_MISMATCH',
        message: 'excluded role is still used by a step or slot',
      });
  }

  const lockKeys = new Map<string, WorkflowPackageLock>();
  for (const [index, lock] of input.packageLocks.entries()) {
    if (!lock || typeof lock.roleKey !== 'string' || !input.roleIdsByKey[lock.roleKey]) {
      issues.push({
        path: `/packageLocks/${index}/roleKey`,
        code: 'WORKFLOW_PACKAGE_INCOMPATIBLE',
        message: 'package lock references an unknown role',
      });
      continue;
    }
    if (!DIGEST_HEX.test(String(lock.packageDigest ?? '')))
      issues.push({
        path: `/packageLocks/${index}/packageDigest`,
        code: 'WORKFLOW_PACKAGE_INCOMPATIBLE',
        message: 'package digest must be 64 lowercase hex',
      });
    if (lockKeys.has(lock.roleKey))
      issues.push({
        path: `/packageLocks/${index}/roleKey`,
        code: 'WORKFLOW_PACKAGE_INCOMPATIBLE',
        message: 'role has more than one package lock',
      });
    lockKeys.set(lock.roleKey, lock);
  }
  /**
   * 审批槽可能引用只出现在槽位里的角色（没有任何步骤使用它）。
   * 这类角色同样要进 resolvedRoles：否则创建实例时 roleSlotBinding 无法解析，
   * 会以"角色与槽位声明不一致（resolved: null）"被拒。
   * stepKey 留空，表示"不是步骤角色，仅用于审批槽解析"。
   */
  for (const slot of slots) {
    const roleKey = slot.roleKey;
    if (typeof roleKey !== 'string' || !input.roleIdsByKey[roleKey]) continue;
    usedRoleKeys.add(roleKey);
    if (!resolvedRoles.some((item) => item.roleKey === roleKey))
      resolvedRoles.push({ stepKey: '', roleKey, roleId: input.roleIdsByKey[roleKey] });
  }

  for (const roleKey of usedRoleKeys) {
    if (!lockKeys.has(roleKey))
      issues.push({
        path: '/packageLocks',
        code: 'WORKFLOW_PACKAGE_INCOMPATIBLE',
        message: `role ${roleKey} has no package lock`,
      });
  }

  if (issues.length > 0) return { valid: false, issues, digest: null, compiledRules: null };

  const sortedLocks = [...lockKeys.values()].sort((left, right) =>
    left.roleKey.localeCompare(right.roleKey),
  );
  const compiledRules: WorkflowCompiledRules = {
    resolvedRoles: resolvedRoles.sort((left, right) => left.stepKey.localeCompare(right.stepKey)),
    packageLocks: sortedLocks,
    systemGates: systemGates.sort((left, right) => left.stepKey.localeCompare(right.stepKey)),
    inputSources: inputSources.sort(
      (left, right) =>
        left.stepKey.localeCompare(right.stepKey) || left.inputKey.localeCompare(right.inputKey),
    ),
  };
  const digest = await sha256Bytes(
    new TextEncoder().encode(canonicalJson({ definition: workflow, ...compiledRules })),
  );
  return { valid: true, issues: [], digest, compiledRules };
}
