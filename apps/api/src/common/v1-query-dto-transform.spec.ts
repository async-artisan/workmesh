import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 查询参数永远来自 URL，是字符串。`@IsInt()` 拿到的却是 `'20'`，
 * 只要漏掉 `@Type(() => Number)`，这个接口就会以 400 拒绝所有请求——
 * `changes` 的 limit 就是这么坏的，而且因为默认值也走同一条路，连不带参数都失败。
 *
 * 这里用一条静态检查兜住整类问题：任何 *QueryDto 里的数值字段，
 * 必须自带 `@Type(() => Number)`。
 */
const SRC = join(__dirname, '..');

function controllerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...controllerFiles(path));
      continue;
    }
    if (entry.endsWith('.controller.ts')) found.push(path);
  }
  return found;
}

function queryDtoBlocks(source: string): Array<{ name: string; body: string }> {
  const blocks: Array<{ name: string; body: string }> = [];
  const pattern = /class\s+(\w+QueryDto)\s*\{([\s\S]*?)\n\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    blocks.push({ name: match[1]!, body: match[2]! });
  }
  return blocks;
}

function numericFieldsMissingTransform(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /@IsInt\(\)|@IsNumber\(\)/.test(line))
    .filter((line) => !/@Type\(\(\) => Number\)/.test(line));
}

describe('查询 DTO 的数值字段必须显式转换', () => {
  it('所有 *QueryDto 的数值字段都带 @Type(() => Number)', () => {
    const offenders: string[] = [];
    for (const file of controllerFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const block of queryDtoBlocks(source)) {
        for (const field of numericFieldsMissingTransform(block.body)) {
          offenders.push(`${file.replace(SRC, 'src')} ${block.name}: ${field}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('这条检查本身能抓到缺转换的写法', () => {
    const broken = `
      class DemoQueryDto {
        @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
        @IsOptional() @IsInt() @Min(1) page?: number;
      }
    `;
    const blocks = queryDtoBlocks(broken);
    expect(blocks).toHaveLength(1);
    expect(numericFieldsMissingTransform(blocks[0]!.body)).toHaveLength(1);
  });
});
