import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { AiService } from '../src/ai/ai.service';

const MAX_CHUNK_CHARS = 1200;
const MIN_CHUNK_CHARS = 400;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const EMBEDDING_BATCH = 16;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

interface Section {
  path: string[];
  lines: string[];
}

function readArg(name: string) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(`--${name}=`.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL 未设置，使用 pnpm --filter @reqflow/api db:import-kb 或 tsx --env-file=.env 启动',
    );
  }
  if (!LOCAL_HOSTS.includes(new URL(databaseUrl).hostname)) {
    throw new Error('导入脚本只允许连接本地数据库');
  }
}

async function listMarkdown(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = join(root, entry.name);
      if (entry.isDirectory()) return listMarkdown(full);
      return entry.name.toLowerCase().endsWith('.md') ? [full] : [];
    }),
  );
  return files.flat().sort();
}

function collectSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const headings: string[] = [];
  let current: Section = { path: [], lines: [] };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) {
      current.lines.push(line);
      continue;
    }
    if (current.lines.join('').trim()) sections.push(current);
    const level = heading[1].length;
    headings.length = Math.min(headings.length, level - 1);
    headings[level - 1] = heading[2];
    current = { path: headings.slice(0, level).filter(Boolean), lines: [] };
  }
  if (current.lines.join('').trim()) sections.push(current);
  return sections;
}

function cutParagraph(paragraph: string) {
  const window = paragraph.slice(0, MAX_CHUNK_CHARS);
  const boundary = Math.max(
    window.lastIndexOf('。'),
    window.lastIndexOf('；'),
    window.lastIndexOf('\n'),
    window.lastIndexOf('|'),
    window.lastIndexOf(' '),
  );
  return boundary > MAX_CHUNK_CHARS / 2 ? boundary + 1 : MAX_CHUNK_CHARS;
}

function chunkSection(section: Section): string[] {
  const label = section.path.join(' > ');
  const body = section.lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!body) return [];
  const prefix = label ? `【${label}】\n` : '';
  const chunks: string[] = [];
  let buffer = '';
  for (const paragraph of body.split(/\n{2,}/)) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length <= MAX_CHUNK_CHARS) {
      buffer = candidate;
      continue;
    }
    if (buffer) chunks.push(`${prefix}${buffer}`);
    if (paragraph.length <= MAX_CHUNK_CHARS) {
      buffer = paragraph;
      continue;
    }
    let rest = paragraph;
    while (rest.length > MAX_CHUNK_CHARS) {
      const cut = cutParagraph(rest);
      chunks.push(`${prefix}${rest.slice(0, cut).trim()}`);
      rest = rest.slice(cut);
    }
    buffer = rest;
  }
  if (buffer.trim()) chunks.push(`${prefix}${buffer.trim()}`);
  return chunks;
}

function mergeTinyChunks(chunks: string[]) {
  const merged: string[] = [];
  for (const chunk of chunks) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.length < MIN_CHUNK_CHARS &&
      previous.length + chunk.length <= MAX_CHUNK_CHARS
    ) {
      merged[merged.length - 1] = `${previous}\n${chunk}`;
      continue;
    }
    merged.push(chunk);
  }
  return merged;
}

function buildChunks(markdown: string) {
  return mergeTinyChunks(collectSections(markdown).flatMap(chunkSection));
}

async function embedChunks(ai: AiService, chunks: string[]) {
  const vectors: number[][] = [];
  for (let index = 0; index < chunks.length; index += EMBEDDING_BATCH) {
    const batch = chunks.slice(index, index + EMBEDDING_BATCH);
    const result = await ai.embeddings(batch);
    if (result.length !== batch.length) throw new Error('Embedding 返回数量与文本数量不一致');
    vectors.push(...result);
  }
  return vectors;
}

async function main() {
  const sourceArg = readArg('source');
  if (!sourceArg) {
    console.error(
      '用法: pnpm --filter @reqflow/api db:import-kb --source=<知识库根目录> [--project-key=DEMO] [--name=知识库名称] [--dry-run]',
    );
    process.exit(1);
  }
  requireLocalDatabase();

  const source = resolve(sourceArg);
  const prdRoot = join(source, 'raw', 'prd');
  const projectKey = readArg('project-key') ?? 'DEMO';
  const baseName = readArg('name') ?? '易番番产品知识库';
  const dryRun = process.argv.includes('--dry-run');
  const startedAt = Date.now();
  const prisma = new PrismaClient();
  const ai = new AiService(new ConfigService(process.env));

  try {
    const files = await listMarkdown(prdRoot);
    if (files.length === 0) throw new Error(`未在 ${prdRoot} 找到 Markdown 文档`);

    const project = await prisma.project.findFirst({
      where: { key: projectKey },
      select: { id: true, name: true },
    });
    if (!project)
      throw new Error(
        `项目 ${projectKey} 不存在，先运行 pnpm --filter @reqflow/api db:seed 或改用 --project-key 指定已有项目`,
      );

    const prepared: Array<{ filename: string; content: string; chunks: string[] }> = [];
    const skipped: Array<{ filename: string; reason: string }> = [];
    for (const file of files) {
      const filename = relative(prdRoot, file);
      const content = (await readFile(file, 'utf8')).trim();
      if (!content) {
        skipped.push({ filename, reason: '空文件' });
        continue;
      }
      if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) {
        skipped.push({ filename, reason: '超过 10MB' });
        continue;
      }
      const chunks = buildChunks(content);
      if (chunks.length === 0) {
        skipped.push({ filename, reason: '无可切分内容' });
        continue;
      }
      prepared.push({ filename, content, chunks });
      if (dryRun) console.log(`${filename}\t${content.length} 字符\t${chunks.length} 块`);
    }

    const totalChunks = prepared.reduce((sum, item) => sum + item.chunks.length, 0);
    let knowledgeBaseId: string | null = null;
    let importedDocuments = 0;

    if (!dryRun) {
      const existing = await prisma.knowledgeBase.findFirst({
        where: { projectId: project.id, name: baseName },
        select: { id: true },
      });
      const base =
        existing ??
        (await prisma.knowledgeBase.create({
          data: {
            projectId: project.id,
            name: baseName,
            description: `由 ${source} 的 raw/prd 导入，文件名保留版本目录`,
          },
          select: { id: true },
        }));
      knowledgeBaseId = base.id;

      for (const item of prepared) {
        const vectors = await embedChunks(ai, item.chunks);
        await prisma.$transaction(async (tx) => {
          await tx.knowledgeDocument.deleteMany({
            where: { knowledgeBaseId: base.id, filename: item.filename },
          });
          const document = await tx.knowledgeDocument.create({
            data: {
              knowledgeBaseId: base.id,
              filename: item.filename,
              mimeType: 'text/markdown',
              content: item.content,
            },
            select: { id: true },
          });
          await tx.documentChunk.createMany({
            data: item.chunks.map((chunk, position) => ({
              documentId: document.id,
              position,
              content: chunk,
              embedding: vectors[position],
            })),
          });
        });
        importedDocuments += 1;
      }
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          source,
          project: { key: projectKey, name: project.name },
          knowledgeBase: { id: knowledgeBaseId, name: baseName },
          documents: dryRun ? prepared.length : importedDocuments,
          chunks: totalChunks,
          skipped,
          embedding: process.env.OPENAI_API_KEY ? 'openai' : 'local-hash',
          durationMs: Date.now() - startedAt,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
