import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError } from './errors';

export type ProductMode = 'BRAINSTORM' | 'REQUIREMENT';
export type ProductStatus =
  | 'BRAINSTORMING'
  | 'RECEIVED'
  | 'UNDERSTANDING'
  | 'WAITING_FOR_ANSWER'
  | 'READY_FOR_DRAFT'
  | 'PRD_DRAFT';

export type BrainstormOption = {
  id: string;
  summary: string;
  benefits: string[];
  costs: string[];
  risks: string[];
  assumptions: string[];
  evidenceRefs: Array<{ source: string; note?: string }>;
  status: 'OPEN' | 'SELECTED' | 'REJECTED' | 'DEFERRED';
};

export type BrainstormState = {
  problem: { statement: string; users: string[]; painPoints: string[] };
  ideas: string[];
  options: BrainstormOption[];
  assumptions: string[];
  experiments: Array<{
    id: string;
    hypothesis: string;
    method: string;
    successSignal?: string;
    status: 'PROPOSED' | 'RUNNING' | 'DONE';
  }>;
  decisions: Array<{ text: string; basis?: string; at: string }>;
  selectedOptionId: string | null;
};

export type ProductQuestion = {
  id: string;
  text: string;
  requiresUserDecision: true;
  decisionReason: string;
  options: Array<{ value: string; label: string; description?: string }>;
  dependsOn?: string[];
};

export type ProductUnderstanding = {
  facts: string[];
  goals: string[];
  users: string[];
  scope: { in: string[]; out: string[] };
  businessRules: string[];
  acceptance: Array<{ key: string; text: string; verification?: 'TEST' | 'INSPECTION' | 'DEMO' }>;
  assumptions: string[];
  unknowns: string[];
  questions: ProductQuestion[];
  currentQuestionId: string | null;
  answerApplications: Array<{
    questionId: string;
    answer: string;
    appliedTo: string[];
    at: string;
  }>;
  evidenceRefs: Array<{ source: string; note?: string }>;
  confirmedAt: string | null;
};

export type ProductRun = {
  protocolVersion: '1.0';
  requestId: string;
  mode: ProductMode;
  requirementId: string | null;
  projectId: string;
  brainstorm: BrainstormState;
  title: string;
  sourceText: string;
  status: ProductStatus;
  revision: number;
  understanding: ProductUnderstanding;
  prdDraftPath: string | null;
  createdAt: string;
  updatedAt: string;
};

const EMPTY: ProductUnderstanding = {
  facts: [],
  goals: [],
  users: [],
  scope: { in: [], out: [] },
  businessRules: [],
  acceptance: [],
  assumptions: [],
  unknowns: [],
  questions: [],
  currentQuestionId: null,
  answerApplications: [],
  evidenceRefs: [],
  confirmedAt: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertRun(value: unknown): ProductRun {
  if (
    !isRecord(value) ||
    value.protocolVersion !== '1.0' ||
    typeof value.requestId !== 'string' ||
    (value.mode !== 'BRAINSTORM' && value.mode !== 'REQUIREMENT') ||
    (value.requirementId !== null && typeof value.requirementId !== 'string') ||
    !isRecord(value.brainstorm) ||
    !isRecord(value.understanding)
  )
    throw new CliError('PROTOCOL_INVALID', 'Product Agent 状态文件结构非法');
  const understanding = value.understanding as Record<string, unknown>;
  if (!Array.isArray(understanding.questions) || !Array.isArray(understanding.answerApplications))
    throw new CliError('PROTOCOL_INVALID', '理解稿缺少 questions 或 answerApplications');
  return value as unknown as ProductRun;
}

function stateDir(workspaceDir: string): string {
  return join(workspaceDir, '.workmesh', 'product');
}
function statePath(workspaceDir: string, requestId: string): string {
  return join(stateDir(workspaceDir), `${requestId}.json`);
}

export async function saveProductRun(workspaceDir: string, run: ProductRun): Promise<void> {
  await mkdir(stateDir(workspaceDir), { recursive: true });
  await writeFile(
    statePath(workspaceDir, run.requestId),
    `${JSON.stringify(run, null, 2)}\n`,
    'utf8',
  );
}

export async function loadProductRun(workspaceDir: string, requestId: string): Promise<ProductRun> {
  try {
    return assertRun(JSON.parse(await readFile(statePath(workspaceDir, requestId), 'utf8')));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('RESOURCE_NOT_FOUND', `Product Agent 需求不存在：${requestId}`);
  }
}

const EMPTY_BRAINSTORM: BrainstormState = {
  problem: { statement: '', users: [], painPoints: [] },
  ideas: [],
  options: [],
  assumptions: [],
  experiments: [],
  decisions: [],
  selectedOptionId: null,
};

export function createProductRun(input: {
  requestId: string;
  requirementId?: string | null;
  projectId: string;
  title: string;
  sourceText: string;
  mode?: ProductMode;
}): ProductRun {
  const now = new Date().toISOString();
  const mode = input.mode ?? 'BRAINSTORM';
  return {
    protocolVersion: '1.0',
    requestId: input.requestId,
    mode,
    requirementId: input.requirementId ?? null,
    projectId: input.projectId,
    title: input.title,
    sourceText: input.sourceText,
    brainstorm: structuredClone(EMPTY_BRAINSTORM),
    status: mode === 'BRAINSTORM' ? 'BRAINSTORMING' : 'RECEIVED',
    revision: 1,
    understanding: structuredClone(EMPTY),
    prdDraftPath: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateBrainstorm(run: ProductRun, patch: Partial<BrainstormState>): ProductRun {
  if (run.mode !== 'BRAINSTORM') throw new CliError('VALIDATION_FAILED', '当前不是头脑风暴模式');
  return {
    ...run,
    brainstorm: {
      ...run.brainstorm,
      ...patch,
      problem: patch.problem
        ? { ...run.brainstorm.problem, ...patch.problem }
        : run.brainstorm.problem,
    },
    revision: run.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function selectBrainstormOption(run: ProductRun, optionId: string): ProductRun {
  if (run.mode !== 'BRAINSTORM') throw new CliError('VALIDATION_FAILED', '当前不是头脑风暴模式');
  const option = run.brainstorm.options.find((item) => item.id === optionId);
  if (!option) throw new CliError('RESOURCE_NOT_FOUND', `方案不存在：${optionId}`);
  const options = run.brainstorm.options.map((item) => ({
    ...item,
    status:
      item.id === optionId
        ? ('SELECTED' as const)
        : item.status === 'SELECTED'
          ? ('OPEN' as const)
          : item.status,
  }));
  return {
    ...run,
    brainstorm: { ...run.brainstorm, options, selectedOptionId: optionId },
    revision: run.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function promoteBrainstorm(run: ProductRun): ProductRun {
  if (run.mode !== 'BRAINSTORM') throw new CliError('VALIDATION_FAILED', '当前已经是需求模式');
  const selected = run.brainstorm.selectedOptionId;
  if (!selected) throw new CliError('VALIDATION_FAILED', '请先选择一个要推进的方案');
  const option = run.brainstorm.options.find((item) => item.id === selected);
  if (!option) throw new CliError('PROTOCOL_INVALID', '已选择的方案不存在');
  const facts = [run.brainstorm.problem.statement, ...run.brainstorm.problem.painPoints].filter(
    Boolean,
  );
  const goals = [option.summary];
  const now = new Date().toISOString();
  return {
    ...run,
    mode: 'REQUIREMENT',
    status: 'UNDERSTANDING',
    brainstorm: {
      ...run.brainstorm,
      decisions: [
        ...run.brainstorm.decisions,
        { text: `推进方案：${option.summary}`, basis: option.assumptions.join('；'), at: now },
      ],
    },
    understanding: {
      ...run.understanding,
      facts,
      goals,
      users: run.brainstorm.problem.users,
      assumptions: [...run.brainstorm.assumptions, ...option.assumptions],
      evidenceRefs: option.evidenceRefs,
    },
    revision: run.revision + 1,
    updatedAt: now,
  };
}

export function updateUnderstanding(
  run: ProductRun,
  patch: Partial<ProductUnderstanding>,
): ProductRun {
  const next = {
    ...run,
    understanding: {
      ...run.understanding,
      ...patch,
      scope: patch.scope ? { ...run.understanding.scope, ...patch.scope } : run.understanding.scope,
    },
    revision: run.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  const current = next.understanding.questions[0];
  next.understanding.currentQuestionId = current?.id ?? null;
  next.status = current ? 'WAITING_FOR_ANSWER' : 'UNDERSTANDING';
  return next;
}

export function answerQuestion(
  run: ProductRun,
  questionId: string,
  answer: string,
  appliedTo: string[],
): ProductRun {
  const question = run.understanding.questions.find((item) => item.id === questionId);
  if (!question) throw new CliError('VALIDATION_FAILED', `当前问题不存在：${questionId}`);
  if (run.understanding.currentQuestionId !== questionId)
    throw new CliError(
      'VERSION_CONFLICT',
      `只能回答当前问题：${run.understanding.currentQuestionId ?? '(无)'}`,
    );
  const now = new Date().toISOString();
  const remaining = run.understanding.questions.filter((item) => item.id !== questionId);
  const next = {
    ...run,
    understanding: {
      ...run.understanding,
      questions: remaining,
      currentQuestionId: remaining[0]?.id ?? null,
      answerApplications: [
        ...run.understanding.answerApplications,
        { questionId, answer, appliedTo, at: now },
      ],
    },
    revision: run.revision + 1,
    updatedAt: now,
  };
  next.status = remaining.length ? 'WAITING_FOR_ANSWER' : 'UNDERSTANDING';
  return next;
}

export function confirmUnderstanding(run: ProductRun): ProductRun {
  if (run.mode !== 'REQUIREMENT')
    throw new CliError('VALIDATION_FAILED', '头脑风暴仍在探索阶段，请先选择方案并执行 promote');
  if (run.understanding.questions.length || run.understanding.unknowns.length)
    throw new CliError('VALIDATION_FAILED', '仍有未解决问题或未知项，不能确认理解');
  const now = new Date().toISOString();
  return {
    ...run,
    status: 'READY_FOR_DRAFT',
    revision: run.revision + 1,
    understanding: { ...run.understanding, confirmedAt: now },
    updatedAt: now,
  };
}

export function renderPrd(run: ProductRun): string {
  if (run.status !== 'READY_FOR_DRAFT' && run.status !== 'PRD_DRAFT')
    throw new CliError('VALIDATION_FAILED', '只有确认理解后才能生成 PRD 草稿');
  const u = run.understanding;
  const bullets = (items: string[]) =>
    items.length ? items.map((item) => `- ${item}`).join('\n') : '- （未提供）';
  const acceptance = u.acceptance.length
    ? u.acceptance
        .map(
          (item) =>
            `- ${item.key}: ${item.text}${item.verification ? `（${item.verification}）` : ''}`,
        )
        .join('\n')
    : '- （待补充）';
  return `# ${run.title}\n\n> Product Agent PRD draft · request ${run.requestId} · understanding revision ${run.revision}\n\n## 背景与事实\n${bullets(u.facts)}\n\n## 目标\n${bullets(u.goals)}\n\n## 用户\n${bullets(u.users)}\n\n## 范围\n### 做什么\n${bullets(u.scope.in)}\n### 不做什么\n${bullets(u.scope.out)}\n\n## 业务规则\n${bullets(u.businessRules)}\n\n## 假设与依据\n### 假设\n${bullets(u.assumptions)}\n### 依据\n${u.evidenceRefs.length ? u.evidenceRefs.map((item) => `- ${item.source}${item.note ? `：${item.note}` : ''}`).join('\n') : '- （未提供）'}\n\n## 验收标准\n${acceptance}\n`;
}

export async function writePrdDraft(
  workspaceDir: string,
  run: ProductRun,
  fileName?: string,
): Promise<ProductRun> {
  const file = fileName ?? join(stateDir(workspaceDir), `${run.requestId}-prd-draft.md`);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, renderPrd(run), 'utf8');
  const next = {
    ...run,
    status: 'PRD_DRAFT' as const,
    prdDraftPath: file,
    revision: run.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await saveProductRun(workspaceDir, next);
  return next;
}
