import { Injectable } from '@nestjs/common';

export interface ParsedCommit {
  type: string;
  scope?: string;
  subject: string;
  requirementIds: string[];
  prdIds: string[];
  issueIds: string[];
}

@Injectable()
export class CommitParserService {
  parse(message: string): ParsedCommit {
    const first = message.split('\n')[0] ?? '';
    const match = first.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
    return {
      type: match?.[1] ?? 'other',
      scope: match?.[2],
      subject: match?.[3] ?? first,
      requirementIds: this.ids(message, /\b([A-Z]{2,6}-REQ-\d+)\b/g),
      prdIds: this.ids(message, /PRD-([A-Za-z0-9_-]+)/g),
      issueIds: this.ids(message, /#(\d+)/g),
    };
  }
  validate(message: string) {
    const parsed = this.parse(message);
    const errors: string[] = [];
    if (!['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'].includes(parsed.type))
      errors.push('提交类型无效');
    if (!/^(\w+)(?:\([^)]+\))?:\s*.+/.test(message))
      errors.push('提交格式应为 type(scope): subject');
    if (parsed.subject.length > 72) errors.push('主题不能超过 72 个字符');
    return { valid: errors.length === 0, errors };
  }
  private ids(message: string, pattern: RegExp) {
    return [...message.matchAll(pattern)]
      .map((match) => match[1])
      .filter((id, index, ids) => ids.indexOf(id) === index);
  }
}
