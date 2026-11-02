#!/usr/bin/env node
// 在隔离且没有环境文件的工作目录中执行 Prisma validate / generate，
// 避免 Prisma CLI 自动加载仓库现有的 .env（06 §3.1）。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(new URL('../../', import.meta.url).pathname);
const apiDir = join(repoRoot, 'apps', 'api');
const sourceSchema = join(apiDir, 'prisma', 'schema.prisma');

if (!existsSync(sourceSchema)) {
  process.stderr.write(`${JSON.stringify({ suite: 'isolated-prisma', status: 'FAILED', reason: 'formal schema is missing' }, null, 2)}\n`);
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'workmesh-v1-prisma-'));
const isolatedSchema = join(workDir, 'schema.prisma');
const isolatedOutput = join(workDir, 'generated-client');

// 显式占位连接串：只用于 CLI 解析 datasource，不指向任何真实实例，也不是秘密。
const PLACEHOLDER_URL = 'postgresql://placeholder@127.0.0.1:5432/placeholder?schema=workmesh_v1';

const original = readFileSync(sourceSchema, 'utf8');
const rewritten = original
  .replace(/output\s*=\s*"[^"]*"/, `output = "${isolatedOutput.replace(/\\/g, '/')}"`)
  .replace(/previewFeatures\s*=\s*\[[^\]]*\]/, 'previewFeatures = ["multiSchema"]');
writeFileSync(isolatedSchema, rewritten);

// 让 @prisma/client 在隔离目录内可解析，避免 Prisma 触发 npm 自动安装（会联网）。
// 只做目录符号链接，不复制依赖，也不产生任何 .env。
const isolatedNodeModules = join(workDir, 'node_modules');
mkdirSync(join(isolatedNodeModules, '@prisma'), { recursive: true });
symlinkSync(join(apiDir, 'node_modules', '@prisma', 'client'), join(isolatedNodeModules, '@prisma', 'client'), 'dir');
writeFileSync(
  join(workDir, 'package.json'),
  `${JSON.stringify({ name: 'workmesh-v1-isolated-generate', private: true, version: '0.0.0' }, null, 2)}\n`,
);

const env = {
  ...process.env,
  WORKMESH_V1_DATABASE_URL: PLACEHOLDER_URL,
  DATABASE_URL: PLACEHOLDER_URL,
  PRISMA_HIDE_UPDATE_MESSAGE: 'true',
  CHECKPOINT_DISABLE: '1',
};

// 直接调用仓库内的 prisma 二进制，cwd 设为隔离目录：
// 这样 Prisma CLI 找不到任何 .env，也就不会自动加载现有环境文件。
const prismaBin = join(apiDir, 'node_modules', '.bin', 'prisma');
const run = (args) =>
  spawnSync(prismaBin, args, { cwd: workDir, env, encoding: 'utf8' });

const findings = [];
const expectNoEnvFile = ['schema.prisma', join(workDir, '.env'), join(workDir, '.env.local')];
const leakedEnvFiles = expectNoEnvFile.filter((file) => file.endsWith('.env') && existsSync(file));
if (leakedEnvFiles.length > 0) findings.push(`unexpected env files in isolated dir: ${leakedEnvFiles.join(', ')}`);

const validate = run(['validate', '--schema', isolatedSchema]);
const generate = validate.status === 0 ? run(['generate', '--schema', isolatedSchema]) : null;

const ok = validate.status === 0 && generate?.status === 0 && findings.length === 0;
const payload = {
  suite: 'isolated-prisma',
  status: ok ? 'PASSED' : 'FAILED',
  workDir,
  envFilePresent: existsSync(join(workDir, '.env')),
  validate: { exitCode: validate.status, stderr: (validate.stderr ?? '').trim().slice(0, 2000) },
  generate: generate
    ? { exitCode: generate.status, stderr: (generate.stderr ?? '').trim().slice(0, 2000), output: existsSync(join(isolatedOutput, 'index.js')) }
    : { skipped: 'validate failed' },
  findings,
};
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

rmSync(workDir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
