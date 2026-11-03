/**
 * 内置标准交付流程模板。
 *
 * 存在的理由：WorkflowDefinition 只能通过「校验 → 人工确认票据 → 发布」建立，
 * 而空白项目没有任何定义可发布，主链会停在「需要一个已发布 workflow 修订」这一步。
 * 模板把这一跳从「手写 DAG JSON」降级为「载入 → 校验 → 发布」，但不绕过人工闸口：
 * 发布仍然是 HUMAN + 一次性票据的正式动作。
 *
 * 角色 key 取自项目创建时预置的六个业务角色（product/ui/frontend/backend/qa/ops），
 * 只使用其中的 product / frontend / qa / ops，使最小可跑链路需要的角色包数量最少。
 * 每个被步骤或审批槽引用的角色都必须有匹配的 package lock，模板本身不携带锁——
 * 锁必须来自已登记的真实角色包版本，由调用方按已安装版本填充。
 */

export const STANDARD_WORKFLOW_KEY = 'standard';

/** 模板引用到的业务角色 key；这些角色都需要已登记的角色包才能发布。 */
export const STANDARD_TEMPLATE_ROLE_KEYS = ['product', 'frontend', 'qa', 'ops'] as const;

export type StandardWorkflowTemplateOptions = {
  workflowKey?: string;
  title?: string;
};

/**
 * 返回一份全新的标准流程定义（可直接提交 `/workflow-definitions/validate`）。
 *
 * 结构说明：
 * - `understanding` / `prd` 是 PRODUCT 步骤，`baselinePolicy: NONE`，因此不得声明 IMPL。
 * - `impl` 声明 IMPL，服务端据此派生 `CODE_REVIEW_EVIDENCE` system gate（客户端不可自报）。
 * - `release` 必须带一个 `ALL` 且引用 `RELEASE_ACCEPTANCE` 槽位的审批门，否则编译失败。
 */
export function buildStandardWorkflowTemplate(
  options: StandardWorkflowTemplateOptions = {},
): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    protocolVersion: '1.0',
    workflowKey: options.workflowKey ?? STANDARD_WORKFLOW_KEY,
    title: options.title ?? '标准交付流程',
    baseRevisionId: null,
    roleExclusions: [],
    stepRemovals: [],
    roleSlots: [
      { key: 'understanding-owner', roleKey: 'product', kind: 'UNDERSTANDING_CONFIRM' },
      { key: 'prd-owner', roleKey: 'product', kind: 'PRD_PUBLICATION' },
      // 交付工件集的步骤必须声明任务验收槽：服务端在交付时按它派生验收评审请求，
      // 没有该闸门的步骤不允许交付（TASK_ACCEPTANCE_GATE_REQUIRED）。
      { key: 'task-acceptance', roleKey: 'product', kind: 'TASK_ACCEPTANCE' },
      { key: 'release-acceptance', roleKey: 'product', kind: 'RELEASE_ACCEPTANCE' },
    ],
    steps: [
      {
        key: 'understanding',
        roleKey: 'product',
        kind: 'PRODUCT',
        deps: [],
        outputKinds: ['UNDERSTANDING'],
        baselinePolicy: 'NONE',
        inputBindings: [
          {
            inputKey: 'business-knowledge',
            source: 'EXTERNAL_INPUT',
            externalKey: 'business-knowledge',
            reason: '由需求方提供的业务知识与约束',
          },
        ],
        gates: [{ mode: 'ALL', reviewerSlots: ['understanding-owner'] }],
      },
      {
        key: 'prd',
        roleKey: 'product',
        kind: 'PRODUCT',
        deps: ['understanding'],
        outputKinds: ['PRD'],
        baselinePolicy: 'NONE',
        inputBindings: [
          {
            inputKey: 'business-knowledge',
            source: 'EXTERNAL_INPUT',
            externalKey: 'business-knowledge',
            reason: '由需求方提供的业务知识与约束',
          },
        ],
        gates: [{ mode: 'ALL', reviewerSlots: ['prd-owner'] }],
      },
      {
        key: 'impl',
        roleKey: 'frontend',
        kind: 'DELIVERY',
        deps: ['prd'],
        outputKinds: ['IMPL'],
        baselinePolicy: 'PUBLISHED_PRD',
        inputBindings: [
          { inputKey: 'prd', source: 'UPSTREAM_ARTIFACT', fromStepKey: 'prd' },
          {
            inputKey: 'contract',
            source: 'EXTERNAL_INPUT',
            externalKey: 'api-contract',
            reason: '由项目已有接口规范提供',
          },
        ],
        gates: [{ mode: 'ALL', reviewerSlots: ['task-acceptance'] }],
      },
      {
        key: 'cases',
        roleKey: 'qa',
        kind: 'VERIFY',
        deps: ['impl'],
        outputKinds: ['CASES'],
        baselinePolicy: 'PUBLISHED_PRD',
        inputBindings: [{ inputKey: 'prd', source: 'UPSTREAM_ARTIFACT', fromStepKey: 'prd' }],
        gates: [{ mode: 'ALL', reviewerSlots: ['task-acceptance'] }],
      },
      {
        key: 'release',
        roleKey: 'ops',
        kind: 'RELEASE',
        deps: ['cases'],
        outputKinds: ['RELEASE'],
        inputBindings: [{ inputKey: 'prd', source: 'UPSTREAM_ARTIFACT', fromStepKey: 'prd' }],
        gates: [{ mode: 'ALL', reviewerSlots: ['task-acceptance', 'release-acceptance'] }],
      },
    ],
  };
}

/**
 * 软件交付默认模板：PRD 之后 UI / 用例 / 前后端并行，最后合流验收再发布。
 * 与 `standard` 的区别是显式包含 backend 与 ui，用于真实的多角色团队。
 */
export const SOFTWARE_DELIVERY_WORKFLOW_KEY = 'software-delivery';
export const SOFTWARE_DELIVERY_ROLE_KEYS = [
  'product',
  'ui',
  'frontend',
  'backend',
  'qa',
  'ops',
] as const;

export type SoftwareDeliveryTemplateOptions = {
  workflowKey?: string;
  title?: string;
  /** 复用既有设计、无新增视觉时排除 ui，并移除 design 步骤。 */
  excludeUi?: boolean;
};

export function buildSoftwareDeliveryWorkflowTemplate(
  options: SoftwareDeliveryTemplateOptions = {},
): Record<string, unknown> {
  const excludeUi = options.excludeUi === true;
  const implGates = [{ mode: 'ALL', reviewerSlots: ['task-acceptance'] }];
  return {
    schemaVersion: '1.0',
    protocolVersion: '1.0',
    workflowKey: options.workflowKey ?? SOFTWARE_DELIVERY_WORKFLOW_KEY,
    title: options.title ?? '软件交付流程',
    baseRevisionId: null,
    roleExclusions: excludeUi
      ? [{ roleKey: 'ui', reason: '本次不涉及新视觉或新交互，复用现有设计' }]
      : [],
    stepRemovals: [],
    roleSlots: [
      { key: 'prd-owner', roleKey: 'product', kind: 'PRD_PUBLICATION' },
      { key: 'task-acceptance', roleKey: 'qa', kind: 'TASK_ACCEPTANCE' },
      { key: 'release-acceptance', roleKey: 'product', kind: 'RELEASE_ACCEPTANCE' },
    ],
    steps: [
      {
        key: 'prd',
        roleKey: 'product',
        kind: 'PRODUCT',
        deps: [],
        outputKinds: ['PRD'],
        baselinePolicy: 'NONE',
        inputBindings: [
          {
            inputKey: 'business-knowledge',
            source: 'EXTERNAL_INPUT',
            externalKey: 'business-knowledge',
            reason: '由需求方提供的业务知识与约束',
          },
        ],
        gates: [{ mode: 'ALL', reviewerSlots: ['prd-owner'] }],
      },
      ...(excludeUi
        ? []
        : [
            {
              key: 'design',
              roleKey: 'ui',
              kind: 'PRODUCT',
              deps: ['prd'],
              outputKinds: ['DESIGN'],
              baselinePolicy: 'NONE',
              inputBindings: [{ inputKey: 'prd', source: 'UPSTREAM_ARTIFACT', fromStepKey: 'prd' }],
              gates: implGates,
            },
          ]),
      {
        key: 'cases',
        roleKey: 'qa',
        kind: 'VERIFY',
        deps: ['prd'],
        outputKinds: ['CASES'],
        baselinePolicy: 'PUBLISHED_PRD',
        inputBindings: [{ inputKey: 'prd', source: 'UPSTREAM_ARTIFACT', fromStepKey: 'prd' }],
        gates: implGates,
      },
      {
        key: 'backend',
        roleKey: 'backend',
        kind: 'DELIVERY',
        deps: ['prd'],
        outputKinds: ['IMPL'],
        baselinePolicy: 'PUBLISHED_PRD',
        inputBindings: [
          { inputKey: 'prd', source: 'UPSTREAM_ARTIFACT', fromStepKey: 'prd' },
          { inputKey: 'unit-card', source: 'PUBLISHED_KNOWLEDGE', knowledgeKey: 'unit-card' },
        ],
        gates: implGates,
      },
      {
        key: 'frontend',
        roleKey: 'frontend',
        kind: 'DELIVERY',
        deps: excludeUi ? ['prd'] : ['prd', 'design'],
        outputKinds: ['IMPL'],
        baselinePolicy: 'PUBLISHED_PRD',
        inputBindings: [
          { inputKey: 'prd', source: 'UPSTREAM_ARTIFACT', fromStepKey: 'prd' },
          { inputKey: 'contract', source: 'PUBLISHED_KNOWLEDGE', knowledgeKey: 'api-contract' },
          ...(!excludeUi
            ? [{ inputKey: 'design', source: 'UPSTREAM_ARTIFACT', fromStepKey: 'design' }]
            : []),
        ],
        gates: implGates,
      },
      {
        key: 'accept',
        roleKey: 'qa',
        kind: 'VERIFY',
        deps: ['backend', 'frontend', 'cases'],
        outputKinds: [],
        baselinePolicy: 'PUBLISHED_PRD',
        inputBindings: [{ inputKey: 'prd', source: 'UPSTREAM_ARTIFACT', fromStepKey: 'prd' }],
        gates: implGates,
      },
      {
        key: 'release',
        roleKey: 'ops',
        kind: 'RELEASE',
        deps: ['accept'],
        outputKinds: ['RELEASE'],
        inputBindings: [{ inputKey: 'prd', source: 'UPSTREAM_ARTIFACT', fromStepKey: 'prd' }],
        gates: [{ mode: 'ALL', reviewerSlots: ['task-acceptance', 'release-acceptance'] }],
      },
    ],
  };
}

/**
 * 从任意流程定义里取出被引用的角色 key（步骤 + 审批槽），去重后按字典序返回。
 * 用于在发布前判断哪些角色缺少角色包锁——缺锁是编译期就会失败的硬条件。
 */
export function usedWorkflowRoleKeys(definition: unknown): string[] {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return [];
  const workflow = definition as { steps?: unknown; roleSlots?: unknown };
  const keys = new Set<string>();
  for (const entry of [workflow.steps, workflow.roleSlots]) {
    if (!Array.isArray(entry)) continue;
    for (const item of entry) {
      const roleKey = (item as { roleKey?: unknown } | null)?.roleKey;
      if (typeof roleKey === 'string' && roleKey) keys.add(roleKey);
    }
  }
  return [...keys].sort();
}
