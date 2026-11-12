#!/usr/bin/env node
// 在隔离且没有环境文件的工作目录中执行 Prisma validate / generate，
// 避免 Prisma CLI 自动加载仓库现有的 .env（06 §3.1）。
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prismaClientLinkType, repoRootFromModuleUrl } from './isolated-prisma-paths.mjs';

// URL.pathname starts with `/C:/...` on Windows. Converting the file URL first
// avoids treating the drive-qualified pathname as a relative path and makes
// this script work when the checkout path contains spaces or non-ASCII text.
const repoRoot = repoRootFromModuleUrl(import.meta.url);
const apiDir = join(repoRoot, 'apps', 'api');
const sourceSchema = join(apiDir, 'prisma', 'schema.prisma');

if (!existsSync(sourceSchema)) {
  process.stderr.write(
    `${JSON.stringify({ suite: 'isolated-prisma', status: 'FAILED', reason: 'formal schema is missing' }, null, 2)}\n`,
  );
  process.exit(1);
}

// 显式占位连接串：只用于 CLI 解析 datasource，不指向任何真实实例，也不是秘密。
const PLACEHOLDER_URL = 'postgresql://placeholder@127.0.0.1:5432/placeholder?schema=workmesh_v1';
let workDir;
let payload;
let exitCode = 1;
let cleanupError;

try {
  workDir = mkdtempSync(join(tmpdir(), 'workmesh-v1-prisma-'));
  const isolatedSchema = join(workDir, 'schema.prisma');
  const isolatedOutput = join(workDir, 'generated-client');

  const original = readFileSync(sourceSchema, 'utf8');
  const rewritten = original.replace(
    /output\s*=\s*"[^"]*"/,
    'output = "' + isolatedOutput.replace(/\\/g, '/') + '"',
  );
  writeFileSync(isolatedSchema, rewritten);

  // 让 @prisma/client 在隔离目录内可解析，避免 Prisma 触发 npm 自动安装（会联网）。
  // 只做目录符号链接，不复制依赖，也不产生任何 .env。
  const isolatedNodeModules = join(workDir, 'node_modules');
  mkdirSync(join(isolatedNodeModules, '@prisma'), { recursive: true });
  const prismaClientSource = join(apiDir, 'node_modules', '@prisma', 'client');
  const prismaClientLink = join(isolatedNodeModules, '@prisma', 'client');
  // Junctions do not require elevated symlink privileges on Windows and still
  // keep the isolated directory from copying or mutating the installed client.
  symlinkSync(prismaClientSource, prismaClientLink, prismaClientLinkType());
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

  // Directly invoke the installed Prisma entry point instead of `.bin/prisma`.
  // The latter is a shell wrapper on Windows (`prisma.CMD`) and cannot be passed
  // portably to spawnSync without enabling a shell. Running Node directly also
  // avoids shell interpolation of paths containing spaces or non-ASCII text.
  const prismaEntry = join(apiDir, 'node_modules', 'prisma', 'build', 'index.js');
  if (!existsSync(prismaEntry)) throw new Error(`Prisma CLI entry is missing: ${prismaEntry}`);
  const run = (args) =>
    spawnSync(process.execPath, [prismaEntry, ...args], {
      cwd: workDir,
      env,
      encoding: 'utf8',
      windowsHide: true,
    });

  const findings = [];
  const expectNoEnvFile = [join(workDir, '.env'), join(workDir, '.env.local')];
  const leakedEnvFiles = expectNoEnvFile.filter((file) => existsSync(file));
  if (leakedEnvFiles.length > 0)
    findings.push(`unexpected env files in isolated dir: ${leakedEnvFiles.join(', ')}`);

  const validate = run(['validate', '--schema', isolatedSchema]);
  const generate = validate.status === 0 ? run(['generate', '--schema', isolatedSchema]) : null;
  const generatedOutput = existsSync(join(isolatedOutput, 'index.js'));
  const validateError = validate.error ? String(validate.error) : '';
  const generateError = generate?.error ? String(generate.error) : '';

  const ok =
    validate.status === 0 &&
    generate?.status === 0 &&
    generatedOutput &&
    findings.length === 0 &&
    !validate.error &&
    !generate?.error;
  payload = {
    suite: 'isolated-prisma',
    status: ok ? 'PASSED' : 'FAILED',
    workDir,
    envFilePresent: expectNoEnvFile.some((file) => existsSync(file)),
    validate: {
      exitCode: validate.status,
      stderr: (validate.stderr ?? '').trim().slice(0, 2000),
      error: validateError || undefined,
    },
    generate: generate
      ? {
          exitCode: generate.status,
          stderr: (generate.stderr ?? '').trim().slice(0, 2000),
          error: generateError || undefined,
          output: generatedOutput,
        }
      : { skipped: 'validate failed', output: false },
    findings,
  };
  exitCode = ok ? 0 : 1;
} catch (error) {
  payload = {
    suite: 'isolated-prisma',
    status: 'FAILED',
    workDir,
    reason: error instanceof Error ? error.message : String(error),
  };
} finally {
  if (workDir) {
    try {
      // workDir is the exact directory created by this invocation's mkdtempSync.
      rmSync(workDir, { recursive: true, force: true });
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : String(error);
    }
  }
}

if (cleanupError) {
  payload = {
    ...payload,
    status: 'FAILED',
    reason: `${payload.reason ? `${payload.reason}; ` : ''}isolated directory cleanup failed: ${cleanupError}`,
  };
  exitCode = 1;
}
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
process.exit(exitCode);
