import { describe, expect, it } from 'vitest';
import {
  validateAcceptanceTemplates,
  validateCaseTemplate,
  validateResourceRecords,
  validateSkillFrontmatter,
} from './validation.mjs';

describe('artifact template contracts', () => {
  const item = { key: 'ac-01', text: '可观测结果', verification: 'TEST' };
  const yamlSource = 'acceptance:\n  - key: ac-01\n    text: 可观测结果\n    verification: TEST\n';
  it('accepts matching YAML and directly submittable JSON', () => {
    expect(validateAcceptanceTemplates(yamlSource, JSON.stringify([item]))).toEqual([item]);
  });
  it('rejects invalid keys, unsupported fields and a drifted JSON copy', () => {
    expect(() =>
      validateAcceptanceTemplates(yamlSource.replace('ac-01', 'A1'), JSON.stringify([item])),
    ).toThrow(/key/);
    expect(() =>
      validateAcceptanceTemplates(
        yamlSource + '    category: FUNCTIONAL\n',
        JSON.stringify([item]),
      ),
    ).toThrow(/not persisted/);
    expect(() =>
      validateAcceptanceTemplates(yamlSource, JSON.stringify([{ ...item, text: '不同结果' }])),
    ).toThrow(/same acceptance/);
    expect(() =>
      validateAcceptanceTemplates(
        yamlSource.replace('key: ac-01', 'key: 123'),
        JSON.stringify([item]),
      ),
    ).toThrow(/key/);
  });
  it('rejects case keys or verification modes that drift from the acceptance template', () => {
    const source = 'cases:\n  - id: TC-01\n    covers: [ac-01]\n    kind: TEST\n';
    expect(() => validateCaseTemplate(source, [item])).not.toThrow();
    expect(() => validateCaseTemplate(source.replace('ac-01', 'ac-99'), [item])).toThrow(
      /references/,
    );
    expect(() => validateCaseTemplate(source.replace('TEST', 'DEMO'), [item])).toThrow(
      /verification/,
    );
    expect(() => validateCaseTemplate(source, [item, { ...item, key: 'ac-02' }])).toThrow(
      /every example acceptance/,
    );
  });
});

describe('validateSkillFrontmatter', () => {
  it('accepts the required scalar metadata when the name matches its directory', () => {
    expect(
      validateSkillFrontmatter(
        '---\nname: write-prd\ndescription: Draft a PRD when requirements are confirmed.\n---\n# Write PRD\n',
        { sourcePath: 'skills/write-prd/SKILL.md', expectedName: 'write-prd' },
      ),
    ).toEqual({ name: 'write-prd', description: 'Draft a PRD when requirements are confirmed.' });
  });

  it.each([
    ['missing opening delimiter', 'name: x\ndescription: y\n'],
    ['missing closing delimiter', '---\nname: x\ndescription: y\n'],
    ['missing name', '---\ndescription: y\n---\n'],
    ['missing description', '---\nname: x\n---\n'],
    ['empty description', '---\nname: x\ndescription:   \n---\n'],
    ['duplicate name', '---\nname: x\nname: x\ndescription: y\n---\n'],
    ['invalid name', '---\nname: Write_PRD\ndescription: y\n---\n'],
    ['unterminated quoted description', '---\nname: x\ndescription: "y\n---\n'],
  ])('rejects %s', (_label, source) => {
    expect(() => validateSkillFrontmatter(source, { sourcePath: 'skills/x/SKILL.md' })).toThrow();
  });

  it('accepts a valid YAML block scalar description', () => {
    expect(
      validateSkillFrontmatter('---\nname: x\ndescription: >\n  Use for task context.\n---\n')
        .description,
    ).toMatch(/^Use for task context\./);
  });

  it('rejects a name that disagrees with the skill directory', () => {
    expect(() =>
      validateSkillFrontmatter('---\nname: wrong\ndescription: y\n---\n', {
        sourcePath: 'skills/right/SKILL.md',
        expectedName: 'right',
      }),
    ).toThrow(/must match skill directory/);
  });
});

describe('validateResourceRecords', () => {
  it('accepts unique resources under the selected role directory', () => {
    expect(() =>
      validateResourceRecords('product', [
        { id: 'guide', path: 'roles/product/guide.md', byteLength: 12 },
        { id: 'skill-write-prd', path: 'roles/product/skills/write-prd/SKILL.md', byteLength: 20 },
      ]),
    ).not.toThrow();
  });

  it.each([
    ['parent traversal', [{ id: 'x', path: 'roles/product/../secret', byteLength: 1 }]],
    ['absolute path', [{ id: 'x', path: '/roles/product/a', byteLength: 1 }]],
    ['wrong role path', [{ id: 'x', path: 'roles/backend/a', byteLength: 1 }]],
    ['oversized resource', [{ id: 'x', path: 'roles/product/a', byteLength: 4 * 1024 * 1024 + 1 }]],
    [
      'duplicate ids',
      [
        { id: 'same', path: 'roles/product/a', byteLength: 1 },
        { id: 'same', path: 'roles/product/b', byteLength: 1 },
      ],
    ],
  ])('rejects %s', (_label, resources) => {
    expect(() => validateResourceRecords('product', resources)).toThrow();
  });
});
