import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  answerQuestion,
  confirmUnderstanding,
  createProductRun,
  loadProductRun,
  saveProductRun,
  updateUnderstanding,
  writePrdDraft,
  promoteBrainstorm,
  selectBrainstormOption,
  updateBrainstorm,
} from './product';

const base = () =>
  createProductRun({
    requestId: 'REQ-001',
    requirementId: '00000000-0000-4000-8000-000000000001',
    projectId: '00000000-0000-4000-8000-000000000002',
    title: '批量导入',
    sourceText: '需要批量导入客户',
    mode: 'REQUIREMENT',
  });

describe('Product Agent protocol', () => {
  it('keeps brainstorming local until a selected option is promoted', () => {
    const run = createProductRun({
      requestId: 'B-001',
      projectId: '00000000-0000-4000-8000-000000000002',
      title: '客户导入',
      sourceText: '探索客户导入',
      mode: 'BRAINSTORM',
    });
    const explored = updateBrainstorm(run, {
      problem: { statement: '录入成本高', users: ['销售'], painPoints: ['重复录入'] },
      options: [
        {
          id: 'csv',
          summary: 'CSV 导入',
          benefits: ['快'],
          costs: [],
          risks: [],
          assumptions: ['用户有 CSV'],
          evidenceRefs: [],
          status: 'OPEN',
        },
      ],
      assumptions: ['需要验证字段格式'],
    });
    expect(explored.requirementId).toBeNull();
    const selected = selectBrainstormOption(explored, 'csv');
    const promoted = promoteBrainstorm(selected);
    expect(promoted.mode).toBe('REQUIREMENT');
    expect(promoted.requirementId).toBeNull();
    expect(promoted.understanding.goals).toEqual(['CSV 导入']);
    expect(promoted.brainstorm.selectedOptionId).toBe('csv');
  });
  it('persists a structured understanding and exposes only the first question', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-product-'));
    const run = updateUnderstanding(base(), {
      facts: ['客户需要批量导入'],
      questions: [
        {
          id: 'q-fields',
          text: '支持哪些字段？',
          requiresUserDecision: true,
          decisionReason: '影响校验',
          options: [{ value: 'core', label: '核心字段' }],
        },
        {
          id: 'q-dedupe',
          text: '是否去重？',
          requiresUserDecision: true,
          decisionReason: '影响规则',
          options: [{ value: 'yes', label: '是' }],
        },
      ],
    });
    await saveProductRun(dir, run);
    const restored = await loadProductRun(dir, 'REQ-001');
    expect(restored.status).toBe('WAITING_FOR_ANSWER');
    expect(restored.understanding.currentQuestionId).toBe('q-fields');
    expect(restored.understanding.questions).toHaveLength(2);
  });

  it('requires the current question and records answer application atomically', () => {
    const run = updateUnderstanding(base(), {
      questions: [
        {
          id: 'q1',
          text: '范围？',
          requiresUserDecision: true,
          decisionReason: '影响验收',
          options: [{ value: 'core', label: '核心' }],
        },
      ],
    });
    const next = answerQuestion(run, 'q1', '核心范围', ['scope.in[0]', 'acceptance[0]']);
    expect(next.understanding.questions).toEqual([]);
    expect(next.understanding.currentQuestionId).toBeNull();
    expect(next.understanding.answerApplications[0].appliedTo).toEqual([
      'scope.in[0]',
      'acceptance[0]',
    ]);
  });

  it('blocks confirmation while unknowns remain, then renders a draft after confirmation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-product-'));
    const ready = updateUnderstanding(base(), {
      goals: ['降低人工录入'],
      scope: { in: ['客户主字段'], out: [] },
      acceptance: [{ key: 'import-works', text: '可以导入文件', verification: 'TEST' }],
    });
    expect(() =>
      confirmUnderstanding({
        ...ready,
        understanding: { ...ready.understanding, unknowns: ['格式'] },
      }),
    ).toThrow();
    const confirmed = confirmUnderstanding(ready);
    expect(confirmed.status).toBe('READY_FOR_DRAFT');
    const draft = await writePrdDraft(dir, confirmed);
    expect(draft.status).toBe('PRD_DRAFT');
    expect(draft.prdDraftPath).toContain('REQ-001-prd-draft.md');
    expect(await readFile(draft.prdDraftPath!, 'utf8')).toContain('## 验收标准');
  });
});
