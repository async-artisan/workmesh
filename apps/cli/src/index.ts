#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  bearerOf,
  findCredential,
  isExpired,
  listCredentials,
  removeCredentialFile,
  credentialPath,
  type AgentCredential,
} from './credential-store';
import { deviceLogin } from './auth';
import { V1Client } from './client';
import {
  CLI_VERSION,
  assertUuid,
  configHome,
  hostSupported,
  resolvePlatform,
  type WorkspaceConfig,
} from './config';
import { CliError, asCliError, errorEnvelopeOf } from './errors';
import { materializeSnapshot, fetchSnapshot } from './context';
import { renderInputStatus } from './input-status';
import {
  diagnoseRoleContext,
  renderRoleContext,
  type RoleContextDiagnostics,
} from './role-context-diagnostics';
import { renderChangeGuidance } from './change-guidance';
import { renderCodeEvidence } from './code-evidence';
import type { CodeEvidenceDiagnostics } from '@workmesh/shared';
import type { TaskInputStatusView } from '@workmesh/shared';
import { buildCandidate, parseCandidateJson, type CandidateKind } from './candidate';
import { buildDeliver } from './deliver';
import { checkQualityFile } from './quality';
import {
  answerQuestion,
  confirmUnderstanding,
  createProductRun,
  promoteBrainstorm,
  selectBrainstormOption,
  updateBrainstorm,
  loadProductRun,
  saveProductRun,
  updateUnderstanding,
  writePrdDraft,
  type ProductUnderstanding,
} from './product';
import { installRolePackage } from './roles';
import { runSetup } from './setup';
import { assertDoctorReady, renderDoctor, runDoctor } from './doctor';
import { runWorkspaceRecover, type WorkspaceRecoverReport } from './workspace-recover';
import { confirmFileStore } from './consent';
import { executeReceiptWrite } from './operation-write';
import { reconcileOperation } from './operation-reconcile';
import {
  assertExecutionReady,
  listExecutions,
  resolveExecution,
  withExecutionLock,
} from './execution-state';
import {
  readReceipt,
  listReceipts,
  scopeKeyOf,
  type SourceFile,
  type ExecutionLink,
} from './receipts';
import {
  detectWorkspaceState,
  dualConfigError,
  legacyWorkspaceView,
  resolveActiveWorkspace,
} from './workspace-config';
import { runWorkspaceDiscover, type WorkspaceDiscoverResult } from './workspace-discover';
import { runWorkspaceBind, type WorkspaceBindResult } from './workspace-bind';
import { runWorkspaceStatus, type WorkspaceStatusReport } from './workspace-status';
import {
  runMigrationApply,
  runMigrationDryRun,
  runMigrationInspect,
  runMigrationResolve,
} from './workspace-migrate';
import {
  runWorkspaceInit,
  type WorkspaceInitResult,
  type WorkspaceInitStage,
} from './workspace-init';

type Options = Record<string, unknown>;
type Connection = {
  workspaceDir: string;
  workspace: WorkspaceConfig;
  home: string;
  credential: AgentCredential;
  credentialId: string;
  scopeKey: string;
  client: V1Client;
};

const DESCRIPTION = 'WorkMesh command line tools';
const INIT_STAGE_LABELS: Record<WorkspaceInitStage, string> = {
  PREFLIGHT: '检查本机环境和服务',
  CONSENT: '确认本地凭据存储',
  LOCK: '取得初始化锁',
  ENROLLMENT: '校验并消费接入码',
  AUTHORIZATION: '等待浏览器授权',
  DEFINITION: '读取并校验项目定义',
  WORKSPACE: '保存工作区配置',
  INDEX: '登记本机工作区索引',
  CACHE: '保存定义缓存',
  COMPLETE: '接入完成',
};

function renderWorkspaceRecovery(result: WorkspaceRecoverReport): void {
  console.log(`初始化恢复：${result.state}（${result.mode}）`);
  console.log(
    `配置一致=${result.checks.workspace}；索引一致=${result.checks.userIndex}；计划摘要一致=${result.checks.planDigest}`,
  );
  for (const reason of result.reasonCodes) console.log(`提示：${reason}`);
  for (const file of result.writes) console.log(`已处理：${file}`);
  console.log(`下一步：${result.nextAction}`);
}

/**
 * commander 12 把 `--credential-store` 存成 `credentialStore`，只认 camelCase。
 * 这里统一按 kebab 键读，再回退到 camelCase，避免多词参数被静默忽略。
 */
function readOption(options: Options, key: string): unknown {
  const direct = options[key];
  if (direct !== undefined) return direct;
  return options[key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())];
}

function str(options: Options, key: string): string | undefined {
  const value = readOption(options, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function flag(options: Options, key: string): boolean {
  return readOption(options, key) === true;
}

function listOf(options: Options, key: string): string[] {
  const value = readOption(options, key);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** 每个叶子命令都带同一组 I/O 选项，避免全局/局部同名选项的覆盖歧义。 */
function withIO(command: Command): Command {
  return command
    .option('--json', 'machine readable output', false)
    .option('--dir <dir>', '业务工作目录（默认当前目录）')
    .option('--config-home <dir>', 'absolute user config root (default ~/.workmesh)')
    .option('--api <base>', 'platform base ending in /api/v1 (defaults to workspace config)');
}

function optionsOf(command: Command): Options {
  return command.opts() as Options;
}

function jsonMode(command: Command): boolean {
  return flag(optionsOf(command), 'json');
}

function emit(command: Command, data: unknown, requestId: string, render: () => void): void {
  if (jsonMode(command)) {
    console.log(JSON.stringify({ data, meta: { requestId } }, null, 2));
    return;
  }
  render();
}

function emitLocal(command: Command, data: unknown, render: () => void): void {
  emit(command, data, randomUUID(), render);
}

function operationIdOf(value?: string): string {
  if (!value) return randomUUID();
  assertUuid(value, '--operation');
  return value;
}

function positiveVersion(options: Options, key: string): number {
  const raw = readOption(options, key);
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new CliError('VALIDATION_FAILED', `--${key} 必须是 >= 1 的整数`);
  return value;
}

function discussionText(options: Options, key: string, max: number): string {
  const value = str(options, key)?.trim();
  if (!value || value.length > max)
    throw new CliError('VALIDATION_FAILED', `--${key} 必须为 1..${max} 字符的非空文本`);
  return value;
}

export function reviewSubjectOf(
  artifactSet: string | undefined,
  revision: string | undefined,
): { kind: 'TASK_ARTIFACT_SET'; id: string } | { kind: 'DOCUMENT_REVISION'; id: string } {
  const hasArtifactSet = artifactSet !== undefined;
  const hasRevision = revision !== undefined;
  if (hasArtifactSet === hasRevision)
    throw new CliError('INVALID_REQUEST', '必须且只能提供 --artifact-set 或 --document-revision');
  return hasArtifactSet
    ? { kind: 'TASK_ARTIFACT_SET', id: assertUuid(artifactSet ?? '', '--artifact-set') }
    : { kind: 'DOCUMENT_REVISION', id: assertUuid(revision ?? '', '--document-revision') };
}

function workspaceDirOf(options: Options): string {
  return resolve(str(options, 'dir') ?? process.cwd());
}

async function connect(command: Command): Promise<Connection> {
  const options = optionsOf(command);
  const workspaceDir = workspaceDirOf(options);
  const active = await resolveActiveWorkspace(workspaceDir);
  const workspace = active.kind === 'V1' ? active.config : legacyWorkspaceView(active.config);
  const platform = resolvePlatform(workspace, str(options, 'api'));
  if (
    platform.origin !== workspace.platform.origin ||
    platform.apiBasePath !== workspace.platform.apiBasePath
  )
    throw new CliError(
      'AUTH_REQUIRED',
      '显式 --api 与工作区平台不一致；跨平台需要匹配的新设备授权，不借用已有凭据',
    );
  const home = configHome(str(options, 'config-home'));
  const credential = await findCredential(home, {
    origin: platform.origin,
    apiBasePath: platform.apiBasePath,
    projectId: workspace.projectId,
    roleKey: workspace.roleKey,
  });
  return {
    workspaceDir,
    workspace,
    home,
    credential,
    credentialId: credential.credentialId,
    scopeKey: scopeKeyOf({
      origin: platform.origin,
      apiBasePath: platform.apiBasePath,
      projectId: workspace.projectId,
      roleKey: workspace.roleKey,
      credentialId: credential.credentialId,
    }),
    client: new V1Client({ platform, bearer: bearerOf(credential) }),
  };
}

type WriteInput = {
  method: 'POST' | 'PATCH' | 'PUT';
  route: string;
  body: unknown;
  sourceFiles?: SourceFile[];
  operation?: string;
  resultRefs?: (data: unknown) => Record<string, string | number | null>;
  execution?: ExecutionLink;
};

function committedTaskState(record: Record<string, unknown>) {
  const state =
    record.committedState && typeof record.committedState === 'object'
      ? (record.committedState as Record<string, unknown>)
      : record.replayed === true
        ? {}
        : record.task && typeof record.task === 'object'
          ? {
              taskVersion: (record.task as Record<string, unknown>).version,
              taskGeneration: (record.task as Record<string, unknown>).generation,
            }
          : {};
  return {
    taskVersion: typeof state.taskVersion === 'number' ? state.taskVersion : null,
    taskGeneration: typeof state.taskGeneration === 'number' ? state.taskGeneration : null,
  };
}

/** 写请求前先落 PENDING receipt；同 --operation 只在摘要完全一致时复用。 */
async function writeWithReceipt(
  connection: Connection,
  command: Command,
  input: WriteInput,
): Promise<{ data: unknown; requestId: string; operationId: string }> {
  const operationId = operationIdOf(input.operation);
  try {
    return await executeReceiptWrite({
      ...input,
      workspaceDir: connection.workspaceDir,
      scopeKey: connection.scopeKey,
      credentialId: connection.credentialId,
      operationId,
      request: (key) =>
        connection.client.request<unknown>(input.method, input.route, {
          body: input.body,
          idempotencyKey: key,
        }),
    });
  } catch (error) {
    const failure = asCliError(error);
    if (!failure.details?.operationId) throw failure;
    throw new CliError(failure.code, failure.message, {
      status: failure.status,
      requestId: failure.requestId,
      exitCode: failure.exitCode,
      details: {
        ...failure.details,
        recoveryDirectory: connection.workspaceDir,
        recoveryConfigHome: connection.home,
        recoveryCommand: [
          'receipt',
          'reconcile',
          '--operation',
          operationId,
          '--dir',
          connection.workspaceDir,
          '--config-home',
          connection.home,
        ],
      },
    });
  }
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('PROTOCOL_INVALID', message);
  return value as Record<string, unknown>;
}

function pick(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) if (record[key] !== undefined) result[key] = record[key];
  return result;
}

type LoginOptions = {
  credentialStore?: string;
  clientName?: string;
  timeout?: string;
};

async function runLogin(options: LoginOptions, command: Command): Promise<void> {
  if (!hostSupported())
    throw new CliError('HOST_OS_UNSUPPORTED', '当前操作系统不支持安全的凭据文件存储');
  const io = optionsOf(command);
  const workspaceDir = workspaceDirOf(io);
  const active = await resolveActiveWorkspace(workspaceDir);
  const workspace = active.kind === 'V1' ? active.config : legacyWorkspaceView(active.config);
  const platform = resolvePlatform(workspace, str(io, 'api'));
  if (options.credentialStore === undefined) await confirmFileStore();
  else if (options.credentialStore !== 'file')
    throw new CliError('VALIDATION_FAILED', '仅支持 --credential-store file');
  const timeoutSeconds = options.timeout ? Number(options.timeout) : undefined;
  if (timeoutSeconds !== undefined && (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0))
    throw new CliError('VALIDATION_FAILED', '--timeout 必须是正数秒');
  const result = await deviceLogin({
    platform,
    configHome: configHome(str(io, 'config-home')),
    projectId: workspace.projectId,
    roleKey: workspace.roleKey,
    clientName: options.clientName ?? 'workmesh-cli',
    timeoutMs: timeoutSeconds ? Math.floor(timeoutSeconds * 1000) : undefined,
    onPrompt: (prompt) => {
      process.stderr.write(`在浏览器打开：${prompt.url}\n输入代码：${prompt.userCode}\n`);
      process.stderr.write(`有效期至 ${prompt.expiresAt}；CLI 会每 5 秒检查一次。\n`);
    },
    onNotice: (text) => process.stderr.write(`${text}\n`),
  });
  emit(
    command,
    {
      credentialId: result.credential.credentialId,
      userId: result.credential.userId,
      projectId: result.credential.projectId,
      roleId: result.credential.roleId,
      roleKey: result.credential.roleKey,
      scopes: result.credential.scopes,
      expiresAt: result.credential.expiresAt,
      credentialPath: result.credentialPath,
    },
    result.requestId,
    () => {
      console.log(
        `已授权 ${result.credential.projectId} / ${result.credential.roleKey || '(其他项目)'}。`,
      );
      console.log(`凭据 ${result.credential.credentialId} 到期 ${result.credential.expiresAt}。`);
      console.log(`本地文件 ${result.credentialPath}（0600）。`);
      console.log('授权只发生在浏览器；CLI 不保存密码或 HUMAN 会话。');
    },
  );
}

function buildProgram(): Command {
  const program = new Command()
    .name('workmesh')
    .enablePositionalOptions()
    .description(DESCRIPTION)
    .version(CLI_VERSION)
    .exitOverride();

  program.action(() => {
    console.log('WorkMesh 连接本地 AI 与项目协作事实，不替你自动批准。');
    console.log('1. 在项目工作区页面选择 Shell、角色和本地目录，复制单行接入命令。');
    console.log('2. workspace init 默认预览；确认后加 --apply，在浏览器批准设备授权。');
    console.log('3. workmesh claim --task <uuid> --json');
    console.log(
      '4. workmesh context --task <uuid> --claim <uuid> --expected-version <n> --materialize --json',
    );
    console.log(
      '新成员接入：workmesh workspace init --join <code> --root <dir> --api <base> --role <role>',
    );
    console.log(
      '按角色 SOP 本地生产；交付后按返回的评审编号，用 review show 查询并在 Web 完成人工确认。',
    );
    console.log('修改角色、项目或平台需匹配的新授权；不要上传聊天、个人记忆或凭据。');
  });

  withIO(
    program
      .command('quality')
      .description('本地规格与交付覆盖检查（不作正式验收）')
      .requiredOption('--file <path>', '质量包 JSON 文件'),
  ).action(async (raw: Options, command: Command) => {
    const report = await checkQualityFile(str(raw, 'file')!, workspaceDirOf(optionsOf(command)));
    if (report.status !== 'CONSISTENT')
      throw new CliError(
        'VALIDATION_FAILED',
        `质量包存在结构、引用或覆盖缺口：${report.issues
          .filter((issue) => issue.severity === 'ERROR')
          .slice(0, 5)
          .map((issue) => `${issue.code} (${issue.location}) ${issue.message}`)
          .join('；')}`,
        { details: { report } },
      );
    emitLocal(command, report, () => {
      console.log(`本地质量检查：${report.status}；${report.coverage.length} 条验收`);
      for (const issue of report.issues)
        console.log(`${issue.severity} ${issue.code}: ${issue.message}`);
      console.log('仅检查所提供数据的一致性；证据内容与正式验收仍需核验。');
    });
  });

  const auth = program.command('auth').description('浏览器设备授权与 Agent 凭据');

  withIO(
    auth
      .command('login')
      .description('通过浏览器设备授权取得受限 Agent 凭据（不接收密码或 HUMAN token）')
      .option(
        '--credential-store <kind>',
        'explicit credential store consent; only file is supported',
      )
      .option('--client-name <name>', 'client name shown on the authorization page', 'workmesh-cli')
      .option('--timeout <seconds>', 'polling deadline in seconds'),
  ).action(async (raw: Options, command: Command) => {
    await runLogin(
      {
        credentialStore: str(raw, 'credential-store'),
        clientName: str(raw, 'client-name'),
        timeout: str(raw, 'timeout'),
      },
      command,
    );
  });

  withIO(
    program
      .command('login')
      .description('auth login 的拼写别名')
      .option('--credential-store <kind>', 'explicit credential store consent')
      .option('--client-name <name>', 'client name', 'workmesh-cli')
      .option('--timeout <seconds>', 'polling deadline in seconds'),
  ).action(async (raw: Options, command: Command) => {
    await runLogin(
      {
        credentialStore: str(raw, 'credential-store'),
        clientName: str(raw, 'client-name'),
        timeout: str(raw, 'timeout'),
      },
      command,
    );
  });

  withIO(auth.command('status').description('显示凭据安全元数据（不含 bearer 或 secret）')).action(
    async (_raw: Options, command: Command) => {
      const io = optionsOf(command);
      let platform;
      let workspace: WorkspaceConfig | undefined;
      try {
        const active = await resolveActiveWorkspace(workspaceDirOf(io));
        workspace = active.kind === 'V1' ? active.config : legacyWorkspaceView(active.config);
        platform = resolvePlatform(workspace, str(io, 'api'));
      } catch (error) {
        const api = str(io, 'api');
        if (api && error instanceof CliError && error.code === 'CONFIG_NOT_FOUND')
          platform = resolvePlatform(undefined, api);
        else throw error;
      }
      const home = configHome(str(io, 'config-home'));
      const credentials = (await listCredentials(home)).map((credential) => ({
        origin: credential.origin,
        apiBasePath: credential.apiBasePath,
        userId: credential.userId,
        credentialId: credential.credentialId,
        projectId: credential.projectId,
        roleId: credential.roleId,
        roleKey: credential.roleKey,
        scopes: credential.scopes,
        expiresAt: credential.expiresAt,
        expired: isExpired(credential),
      }));
      emitLocal(
        command,
        { credentials, platform: platform ?? null, projectId: workspace?.projectId ?? null },
        () => {
          if (!credentials.length) console.log('没有本地 Agent 凭据。运行 workmesh auth login。');
          for (const credential of credentials)
            console.log(
              `${credential.origin}${credential.apiBasePath}  ${credential.projectId} ${credential.roleKey || '(其他项目)'}  ${credential.credentialId}  ${credential.expired ? '已过期' : `到期 ${credential.expiresAt}`}`,
            );
        },
      );
    },
  );

  withIO(
    auth
      .command('logout')
      .description('删除本地凭据文件；服务端凭据需在 Web 独立撤销')
      .option(
        '--credential-id <id>',
        'clear the credential matching this id instead of all workspace credentials',
      ),
  ).action(async (raw: Options, command: Command) => {
    const io = optionsOf(command);
    // DUAL_ACTIVE 是硬冲突：auth 写/诊断命令不得自动选择权威配置（§14.3）。
    const snapshot = await detectWorkspaceState(workspaceDirOf(io));
    if (snapshot.state === 'DUAL_ACTIVE') throw dualConfigError(snapshot);
    const home = configHome(str(io, 'config-home'));
    const credentials = await listCredentials(home);
    const wanted = str(raw, 'credential-id');
    const matches = wanted
      ? credentials.filter(
          (credential) => credential.credentialId === assertUuid(wanted, '--credential-id'),
        )
      : credentials;
    if (matches.length === 0)
      throw new CliError('RESOURCE_NOT_FOUND', '本地没有匹配的 Agent 凭据', { status: 404 });
    for (const credential of matches) await removeCredentialFile(credentialPath(home, credential));
    emitLocal(
      command,
      {
        cleared: matches.map((credential) => ({
          credentialId: credential.credentialId,
          projectId: credential.projectId,
          roleKey: credential.roleKey,
        })),
        serverRevoked: false,
      },
      () => {
        for (const credential of matches)
          console.log(`已删除本地凭据 ${credential.credentialId}（${credential.projectId}）。`);
        console.log(
          '服务端凭据仍然有效；如需撤销，请在有权的 Web 会话中处理。CLI 无密码、无 HUMAN token，不能自撤销。',
        );
      },
    );
  });

  const roles = program.command('roles').description('角色包安装与锁定');

  withIO(
    roles
      .command('install')
      .description('校验 manifest 与全部资源摘要，安装到 .workmesh/packages 并写 lock.json')
      .requiredOption('--package <dir>', 'local role package directory containing manifest.json')
      .option('--project <id>', 'project UUID for first install')
      .option('--host <host>', 'codex | claude-code for first install'),
  ).action(async (raw: Options, command: Command) => {
    const io = optionsOf(command);
    const result = await installRolePackage({
      packageDir: str(raw, 'package') ?? '',
      workspaceDir: workspaceDirOf(io),
      projectId: str(raw, 'project') ? assertUuid(str(raw, 'project'), '--project') : undefined,
      host: str(raw, 'host'),
      api: str(io, 'api'),
    });
    emitLocal(
      command,
      {
        packageId: result.packageId,
        version: result.version,
        roleKey: result.roleKey,
        manifestDigest: result.manifestDigest,
        packagePath: result.packagePath,
        lockPath: result.lockPath,
        workspaceConfigPath: result.workspaceConfigPath ?? null,
        reused: result.reused,
        files: result.files,
      },
      () => {
        console.log(
          `${result.reused ? '已验证' : '已安装'}角色包 ${result.packageId}@${result.version}（digest ${result.manifestDigest}）。`,
        );
        console.log(`锁定文件：${result.lockPath}`);
        for (const file of result.files) console.log(`  ${file}`);
      },
    );
  });

  withIO(
    program
      .command('setup')
      .description('安装角色资源并完成设备授权；首次接入优先使用 workspace init')
      .requiredOption('--role <key>', '业务角色 key，例如 backend')
      .option('--host <host>', 'codex | claude-code')
      .option('--project <id>', '项目 UUID；首次兼容 setup 必填，已有绑定时可省略')
      .option('--package <dir>', '显式角色包目录（默认从随包 roles/ 解析）')
      .option('--credential-store <kind>', '显式同意本地文件凭据存储')
      .option('--timeout <seconds>', '设备授权等待秒数'),
  ).action(async (raw: Options, command: Command) => {
    const io = optionsOf(command);
    const store = str(raw, 'credential-store');
    if (store !== undefined && store !== 'file')
      throw new CliError('VALIDATION_FAILED', '仅支持 --credential-store file');
    const timeoutSeconds = str(raw, 'timeout') ? Number(str(raw, 'timeout')) : undefined;
    if (timeoutSeconds !== undefined && (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0))
      throw new CliError('VALIDATION_FAILED', '--timeout 必须是正数秒');
    const result = await runSetup({
      workspaceDir: workspaceDirOf(io),
      configHome: configHome(str(io, 'config-home')),
      role: str(raw, 'role') ?? '',
      host: str(raw, 'host'),
      api: str(io, 'api'),
      projectId: str(raw, 'project') ? assertUuid(str(raw, 'project'), '--project') : undefined,
      packageDir: str(raw, 'package'),
      timeoutMs: timeoutSeconds ? Math.floor(timeoutSeconds * 1000) : undefined,
      consent: store === 'file' ? async () => undefined : confirmFileStore,
      preflight: async () =>
        assertDoctorReady(
          await runDoctor({
            workspaceDir: workspaceDirOf(io),
            configHome: configHome(str(io, 'config-home')),
            api: str(io, 'api'),
            role: str(raw, 'role'),
            packageDir: str(raw, 'package'),
            online: true,
            probeStorage: true,
          }),
        ),
    });
    emitLocal(command, result, () => {
      console.log(`角色资源已安装：${result.roleKey} @ 项目 ${result.projectId}`);
      console.log(result.credentialReused ? '已复用在线核验通过的匹配凭据。' : '已完成设备授权。');
      console.log(
        `角色包 ${result.packageId}@${result.version}${result.reused ? '（已存在）' : ''} → ${result.packagePath}`,
      );
      console.log(`工作区配置：${result.workspaceConfigPath ?? '(已有，未改写)'}`);
      if (result.agentEntries.length > 0) {
        console.log('Agent 入口已写入：');
        for (const file of result.agentEntries) console.log(`  ${file}`);
      }
      for (const next of result.nextActions) console.log(`下一步：${next}`);
    });
  });

  withIO(
    program
      .command('claim')
      .description('认领任务；返回 claimId 与新 task version')
      .requiredOption('--task <id>', 'task UUID')
      .option('--operation <uuid>', 'reuse an existing Idempotency-Key for retry'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const taskId = assertUuid(str(raw, 'task'), '--task');
    await withExecutionLock(connection, taskId, async () => {
      const operationId = operationIdOf(str(raw, 'operation'));
      const earlier = (await listExecutions(connection)).find(
        (entry) =>
          entry.taskId === taskId &&
          entry.pendingOperations.length &&
          entry.executionId !== operationId,
      );
      if (earlier) assertExecutionReady(earlier);
      const route = `/tasks/${encodeURIComponent(taskId)}/claims`;
      const written = await writeWithReceipt(connection, command, {
        method: 'POST',
        route,
        body: {},
        operation: operationId,
        execution: { id: operationId, taskId, stage: 'CLAIM' },
        resultRefs: (data) => {
          const record = asRecord(data, '认领响应结构非法');
          return {
            taskId,
            claimId: typeof record.claimId === 'string' ? record.claimId : null,
            ...committedTaskState(record),
          };
        },
      });
      const record = asRecord(written.data, '认领响应结构非法');
      const claimId = typeof record.claimId === 'string' ? record.claimId : '';
      const { taskVersion, taskGeneration } = committedTaskState(record);
      emit(
        command,
        {
          taskId,
          claimId,
          taskVersion,
          taskGeneration,
          executionId: operationId,
          replayed: record.replayed === true,
          operationId: written.operationId,
        },
        written.requestId,
        () => {
          console.log(
            `已认领 ${taskId} → claim ${claimId}${taskVersion !== null ? `（task v${taskVersion}）` : ''}。`,
          );
          console.log(
            taskVersion && taskGeneration
              ? `下一步：workmesh context --execution ${operationId} --materialize`
              : `原提交版本未知，请先核对：workmesh tasks show --task ${taskId}`,
          );
        },
      );
    });
  });

  withIO(
    program
      .command('context')
      .description('创建或读取准确上下文快照；--materialize 校验 bytes 后原子落盘')
      .option('--task <id>', 'task UUID (creates a new snapshot)')
      .option('--execution <id>', 'local execution UUID returned by claim')
      .option('--inspect', 'read-only input diagnostics; requires only --task', false)
      .option('--claim <id>', 'explicit claim UUID (otherwise use local execution)')
      .option('--expected-version <n>', 'explicit task version (otherwise use exact local state)')
      .option('--snapshot <id>', 'existing snapshot UUID (does not create)')
      .option('--candidate <id...>', 'optional candidate revision UUIDs for snapshot creation')
      .option('--materialize', 'download and atomically publish verified bytes', false)
      .option(
        '--refresh',
        'explicitly accept changed inputs when creating a replacement execution snapshot',
        false,
      )
      .option('--operation <uuid>', 'reuse an existing Idempotency-Key for retry'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const snapshotOption = str(raw, 'snapshot');
    const taskOption = str(raw, 'task');
    const executionOption = str(raw, 'execution');
    if (executionOption) assertUuid(executionOption, '--execution');
    if (flag(raw, 'inspect')) {
      if (
        !taskOption ||
        executionOption ||
        snapshotOption ||
        str(raw, 'claim') ||
        str(raw, 'expected-version') ||
        flag(raw, 'materialize') ||
        flag(raw, 'refresh') ||
        readOption(raw, 'candidate') ||
        str(raw, 'operation')
      )
        throw new CliError(
          'INVALID_REQUEST',
          '--inspect 只与 --task 和输出/连接选项组合，不创建快照',
        );
      const taskId = assertUuid(taskOption, '--task');
      const result = await connection.client.request<TaskInputStatusView>(
        'GET',
        `/tasks/${encodeURIComponent(taskId)}/input-status`,
      );
      const roleContext = await diagnoseRoleContext({
        workspaceDir: connection.workspaceDir,
        status: result.data,
      });
      emit(command, { ...result.data, roleContext }, result.requestId, () => {
        console.log(renderInputStatus(result.data));
        console.log(renderRoleContext(roleContext));
      });
      return;
    }
    if (!snapshotOption && !taskOption && !executionOption)
      throw new CliError('INVALID_REQUEST', '需要 --task（创建快照）或 --snapshot（读取既有快照）');
    if (snapshotOption && (taskOption || executionOption))
      throw new CliError('INVALID_REQUEST', '--task 与 --snapshot 不能同时使用');
    let snapshotId!: string;
    let taskVersion: number | null = null;
    let requestId!: string;
    let outputExecutionId: string | null = null;
    let outputOperationId: string | null = null;
    let roleContext: RoleContextDiagnostics | undefined;
    if (snapshotOption) {
      const snapshot = await fetchSnapshot(
        connection.client,
        assertUuid(snapshotOption, '--snapshot'),
      );
      snapshotId = snapshot.id;
      requestId = randomUUID();
    } else {
      const explicit =
        str(raw, 'claim') !== undefined || str(raw, 'expected-version') !== undefined;
      if (executionOption && explicit)
        throw new CliError('INVALID_REQUEST', '--execution 不能与显式 claim/version 混用');
      const selected = explicit
        ? null
        : await resolveExecution(connection, {
            executionId: executionOption,
            taskId: taskOption ? assertUuid(taskOption, '--task') : undefined,
          });
      const taskId = selected?.taskId ?? assertUuid(taskOption, '--task');
      await withExecutionLock(connection, taskId, async () => {
        const execution = selected
          ? await resolveExecution(connection, { executionId: selected.executionId })
          : null;
        outputExecutionId = execution?.executionId ?? null;
        if (execution) assertExecutionReady(execution, false, str(raw, 'operation'));
        let inputStatus: TaskInputStatusView | undefined;
        try {
          const inspected = await connection.client.request<TaskInputStatusView>(
            'GET',
            `/tasks/${encodeURIComponent(taskId)}/input-status`,
          );
          inputStatus = inspected.data;
        } catch (error) {
          if (execution?.snapshotId && !str(raw, 'operation')) throw error;
          // Advisory metadata may be absent on older servers; the write still enforces all input gates.
        }
        roleContext = await diagnoseRoleContext({
          workspaceDir: connection.workspaceDir,
          status: inputStatus,
        });
        if (
          execution?.snapshotId &&
          !str(raw, 'operation') &&
          (inputStatus?.comparison.status === 'UNAVAILABLE' ||
            (inputStatus?.comparison.status === 'CHANGED' && !flag(raw, 'refresh')))
        )
          throw new CliError(
            'EXECUTION_INPUTS_CHANGED',
            '本次执行的输入已变化或无法比较，请先 --inspect 核对；确认后使用 --refresh 获取新快照。',
            { details: { roleContext } },
          );
        const claimId = execution?.claimId ?? assertUuid(str(raw, 'claim'), '--claim');
        let retry = null;
        if (execution && str(raw, 'operation')) {
          try {
            retry = await readReceipt(connection.workspaceDir, str(raw, 'operation')!);
          } catch (error) {
            if (!(error instanceof CliError) || error.code !== 'RESOURCE_NOT_FOUND') throw error;
          }
        }
        const expectedVersion =
          retry?.execution?.expectedTaskVersion ??
          execution?.taskVersion ??
          positiveVersion(raw, 'expected-version');
        const candidates = listOf(raw, 'candidate');
        for (const candidate of candidates) assertUuid(candidate, '--candidate');
        const operationId = operationIdOf(str(raw, 'operation'));
        outputOperationId = operationId;
        const route = `/tasks/${encodeURIComponent(taskId)}/context-snapshots`;
        const body = {
          expectedVersion,
          claimId,
          ...(candidates.length ? { candidateRevisionIds: candidates } : {}),
        };
        const created = await writeWithReceipt(connection, command, {
          method: 'POST',
          route,
          body,
          operation: operationId,
          ...(execution
            ? {
                execution: {
                  id: execution.executionId,
                  taskId,
                  claimId,
                  expectedTaskVersion: expectedVersion,
                  stage: 'CONTEXT' as const,
                },
              }
            : {}),
          resultRefs: (data) => {
            const result = asRecord(data, '快照响应结构非法');
            const snapshot = asRecord(result.snapshot, '快照响应 snapshot 非法');
            const manifest = asRecord(snapshot.manifest, '快照 manifest 非法');
            return {
              taskId,
              claimId,
              snapshotId: typeof snapshot.id === 'string' ? snapshot.id : null,
              taskVersion: typeof result.taskVersion === 'number' ? result.taskVersion : null,
              taskGeneration:
                typeof manifest.taskGeneration === 'number' ? manifest.taskGeneration : null,
            };
          },
        });
        const result = asRecord(created.data, '快照响应结构非法');
        const snapshot = asRecord(result.snapshot, '快照响应 snapshot 非法');
        snapshotId = assertUuid(
          typeof snapshot.id === 'string' ? snapshot.id : undefined,
          'snapshot.id',
        );
        taskVersion = typeof result.taskVersion === 'number' ? result.taskVersion : null;
        requestId = created.requestId;
      });
    }
    const view = await fetchSnapshot(connection.client, snapshotId!);
    if (snapshotOption)
      roleContext = await diagnoseRoleContext({
        workspaceDir: connection.workspaceDir,
        snapshotRevisionId: view.manifest.workflowDefinitionRevisionId,
      });
    const materialized = flag(raw, 'materialize')
      ? await materializeSnapshot({
          client: connection.client,
          workspaceDir: connection.workspaceDir,
          snapshot: view,
        })
      : undefined;
    emit(
      command,
      {
        snapshotId,
        executionId: outputExecutionId,
        operationId: outputOperationId,
        manifestDigest: view.manifestDigest,
        taskVersion,
        roleContext,
        resources: view.resources.map((resource) => ({
          refId: resource.refId,
          kind: resource.kind,
          sha256: resource.sha256,
          byteLength: resource.byteLength,
          mediaType: resource.mediaType,
        })),
        ...(materialized
          ? {
              materialized: {
                path: materialized.path,
                files: materialized.files,
                reused: materialized.reused,
              },
            }
          : {}),
      },
      requestId,
      () => {
        console.log(`快照 ${snapshotId}（manifest ${view.manifestDigest}）`);
        if (roleContext) console.log(renderRoleContext(roleContext));
        for (const resource of view.resources)
          console.log(
            `  ${resource.kind} ${resource.refId} ${resource.byteLength}B ${resource.sha256}`,
          );
        if (materialized)
          console.log(
            `${materialized.reused ? '已存在且摘要一致' : '已原子物化'}：${materialized.path}（${materialized.files.length} 个文件，本次从服务端读取，不宣称离线新鲜度）`,
          );
      },
    );
  });

  withIO(
    program
      .command('materialize')
      .description('把指定快照的已校验 bytes 原子落盘（不创建新快照）')
      .requiredOption('--snapshot <id>', 'snapshot UUID'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const snapshotId = assertUuid(str(raw, 'snapshot'), '--snapshot');
    const view = await fetchSnapshot(connection.client, snapshotId);
    const result = await materializeSnapshot({
      client: connection.client,
      workspaceDir: connection.workspaceDir,
      snapshot: view,
    });
    emitLocal(
      command,
      {
        snapshotId,
        manifestDigest: view.manifestDigest,
        path: result.path,
        files: result.files,
        reused: result.reused,
      },
      () => {
        console.log(`${result.reused ? '已存在且摘要一致' : '已原子物化'}：${result.path}`);
        for (const file of result.files) console.log(`  ${file}`);
        console.log('本次字节均由服务端重新读取并核对摘要，未使用离线缓存。');
      },
    );
  });

  const product = program
    .command('product')
    .description('Product Agent 可恢复需求理解与 PRD 工作协议');

  withIO(
    product
      .command('start')
      .description('创建需求并初始化本地 Product Agent 状态')
      .requiredOption('--title <title>', '需求标题')
      .requiredOption('--text <text>', '需求原话或背景')
      .option('--mode <mode>', 'BRAINSTORM（默认）或 REQUIREMENT', 'BRAINSTORM')
      .option('--request <id>', '本地协议 request ID（默认 UUID）')
      .option('--operation <uuid>', '复用已有幂等操作'),
  ).action(async (raw: Options, command: Command) => {
    const mode = (str(raw, 'mode') ?? 'BRAINSTORM').toUpperCase();
    const connection = await connect(command);
    if (mode !== 'BRAINSTORM' && mode !== 'REQUIREMENT')
      throw new CliError('VALIDATION_FAILED', '--mode 只能是 BRAINSTORM 或 REQUIREMENT');
    const title = str(raw, 'title')?.trim();
    const sourceText = str(raw, 'text')?.trim();
    if (!title || !sourceText)
      throw new CliError('VALIDATION_FAILED', '--title 和 --text 不能为空');
    const requestId = str(raw, 'request') ?? randomUUID();
    if (mode === 'BRAINSTORM') {
      const run = createProductRun({
        requestId,
        projectId: connection.workspace.projectId,
        title,
        sourceText,
        mode: 'BRAINSTORM',
      });
      await saveProductRun(connection.workspaceDir, run);
      emitLocal(
        command,
        { requestId, mode: run.mode, status: run.status, revision: run.revision },
        () => {
          console.log(`头脑风暴已开始：${requestId}`);
          console.log(
            '下一步：product brainstorm update --request <id> --brainstorm @brainstorm.json',
          );
        },
      );
      return;
    }
    const written = await writeWithReceipt(connection, command, {
      method: 'POST',
      route: `/projects/${encodeURIComponent(connection.workspace.projectId)}/requirements`,
      body: { title, description: sourceText },
      operation: str(raw, 'operation'),
      resultRefs: (data) => {
        const record = asRecord(data, '需求响应结构非法');
        return { requirementId: typeof record.id === 'string' ? record.id : null };
      },
    });
    const record = asRecord(written.data, '需求响应结构非法');
    const requirementId = typeof record.id === 'string' ? record.id : '';
    if (!requirementId) throw new CliError('PROTOCOL_INVALID', '需求响应缺少 id');
    const run = createProductRun({
      requestId,
      requirementId,
      projectId: connection.workspace.projectId,
      title,
      sourceText,
      mode: 'REQUIREMENT',
    });
    await saveProductRun(connection.workspaceDir, run);
    emit(
      command,
      {
        requestId,
        requirementId,
        mode: run.mode,
        status: run.status,
        revision: run.revision,
        operationId: written.operationId,
      },
      written.requestId,
      () => {
        console.log(`Product Agent 需求已创建：${requestId}（${requirementId}）`);
        console.log('下一步：product update --request <id> --understanding @understanding.json');
      },
    );
  });

  const brainstorm = product.command('brainstorm').description('本地头脑风暴工作区');

  withIO(
    brainstorm
      .command('update')
      .description('更新问题、想法、方案、假设、实验和决策')
      .requiredOption('--request <id>', '本地协议 request ID')
      .requiredOption('--brainstorm <json>', '头脑风暴 JSON 或 @path'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const run = await loadProductRun(connection.workspaceDir, str(raw, 'request') ?? '');
    const input = await parseCandidateJson(str(raw, 'brainstorm') ?? '', '--brainstorm');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new CliError('VALIDATION_FAILED', '--brainstorm 必须是 JSON 对象');
    const next = updateBrainstorm(run, input as never);
    await saveProductRun(connection.workspaceDir, next);
    emitLocal(
      command,
      {
        requestId: next.requestId,
        mode: next.mode,
        status: next.status,
        revision: next.revision,
        brainstorm: next.brainstorm,
      },
      () => console.log(`头脑风暴已保存：${next.requestId} revision ${next.revision}`),
    );
  });

  withIO(
    brainstorm
      .command('select')
      .description('选择要推进的方案')
      .requiredOption('--request <id>', '本地协议 request ID')
      .requiredOption('--option <id>', '方案 ID'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const run = await loadProductRun(connection.workspaceDir, str(raw, 'request') ?? '');
    const next = selectBrainstormOption(run, str(raw, 'option') ?? '');
    await saveProductRun(connection.workspaceDir, next);
    emitLocal(
      command,
      {
        requestId: next.requestId,
        selectedOptionId: next.brainstorm.selectedOptionId,
        revision: next.revision,
      },
      () => console.log(`已选择方案：${next.brainstorm.selectedOptionId}`),
    );
  });

  withIO(
    product
      .command('promote')
      .description('将已选择的头脑风暴方案提升为正式需求并创建 Requirement')
      .requiredOption('--request <id>', '本地协议 request ID')
      .option('--operation <uuid>', '复用已有幂等操作'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const run = await loadProductRun(connection.workspaceDir, str(raw, 'request') ?? '');
    const promoted = promoteBrainstorm(run);
    const written = await writeWithReceipt(connection, command, {
      method: 'POST',
      route: `/projects/${encodeURIComponent(connection.workspace.projectId)}/requirements`,
      body: { title: run.title, description: run.sourceText },
      operation: str(raw, 'operation'),
      resultRefs: (data) => {
        const record = asRecord(data, '需求响应结构非法');
        return { requirementId: typeof record.id === 'string' ? record.id : null };
      },
    });
    const record = asRecord(written.data, '需求响应结构非法');
    const requirementId = typeof record.id === 'string' ? record.id : '';
    if (!requirementId) throw new CliError('PROTOCOL_INVALID', '需求响应缺少 id');
    const next = { ...promoted, requirementId };
    await saveProductRun(connection.workspaceDir, next);
    emit(
      command,
      {
        requestId: next.requestId,
        requirementId,
        mode: next.mode,
        status: next.status,
        revision: next.revision,
        operationId: written.operationId,
      },
      written.requestId,
      () => console.log(`头脑风暴已提升为正式需求：${next.requestId}（${requirementId}）`),
    );
  });

  withIO(
    product
      .command('resume')
      .description('恢复并显示 Product Agent 当前状态')
      .requiredOption('--request <id>', '本地协议 request ID'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const run = await loadProductRun(connection.workspaceDir, str(raw, 'request') ?? '');
    emitLocal(command, run, () => {
      console.log(`${run.requestId}  ${run.mode}  ${run.status}  revision ${run.revision}`);
      console.log(`需求：${run.title}（${run.requirementId}）`);
      console.log(`当前问题：${run.understanding.currentQuestionId ?? '无'}`);
      if (run.understanding.currentQuestionId) {
        const question = run.understanding.questions[0];
        console.log(`请回答：${question?.text ?? ''}`);
      }
      if (run.prdDraftPath) console.log(`PRD 草稿：${run.prdDraftPath}`);
    });
  });

  withIO(
    product
      .command('update')
      .description('更新结构化理解稿和完整问题队列（本地持久化）')
      .requiredOption('--request <id>', '本地协议 request ID')
      .requiredOption('--understanding <json>', '理解稿 JSON 或 @path'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const run = await loadProductRun(connection.workspaceDir, str(raw, 'request') ?? '');
    const input = await parseCandidateJson(str(raw, 'understanding') ?? '', '--understanding');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new CliError('VALIDATION_FAILED', '--understanding 必须是 JSON 对象');
    const next = updateUnderstanding(run, input as Partial<ProductUnderstanding>);
    await saveProductRun(connection.workspaceDir, next);
    emitLocal(
      command,
      {
        requestId: next.requestId,
        status: next.status,
        revision: next.revision,
        understanding: next.understanding,
      },
      () => {
        console.log(`理解稿已保存：${next.requestId} revision ${next.revision}`);
        console.log(`当前问题：${next.understanding.currentQuestionId ?? '无'}`);
      },
    );
  });

  withIO(
    product
      .command('answer')
      .description('回答当前问题并原子记录答案落点')
      .requiredOption('--request <id>', '本地协议 request ID')
      .requiredOption('--question <id>', '当前问题 ID')
      .requiredOption('--answer <text>', '用户实际回答')
      .requiredOption(
        '--apply-to <paths>',
        '落点路径，逗号分隔，例如 businessRules[0],acceptance[0]',
      ),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const run = await loadProductRun(connection.workspaceDir, str(raw, 'request') ?? '');
    const answer = str(raw, 'answer')?.trim();
    if (!answer) throw new CliError('VALIDATION_FAILED', '--answer 不能为空');
    const appliedTo = (str(raw, 'apply-to') ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!appliedTo.length) throw new CliError('VALIDATION_FAILED', '--apply-to 不能为空');
    const next = answerQuestion(run, str(raw, 'question') ?? '', answer, appliedTo);
    await saveProductRun(connection.workspaceDir, next);
    emitLocal(
      command,
      {
        requestId: next.requestId,
        status: next.status,
        revision: next.revision,
        currentQuestionId: next.understanding.currentQuestionId,
        answerApplications: next.understanding.answerApplications,
      },
      () => {
        console.log(`答复已记录：${next.requestId} revision ${next.revision}`);
        console.log(`下一问题：${next.understanding.currentQuestionId ?? '无'}`);
      },
    );
  });

  withIO(
    product
      .command('confirm')
      .description('确认理解稿；不生成 PRD，直到显式执行 draft')
      .requiredOption('--request <id>', '本地协议 request ID'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const run = await loadProductRun(connection.workspaceDir, str(raw, 'request') ?? '');
    const next = confirmUnderstanding(run);
    await saveProductRun(connection.workspaceDir, next);
    emitLocal(
      command,
      {
        requestId: next.requestId,
        status: next.status,
        revision: next.revision,
        confirmedAt: next.understanding.confirmedAt,
      },
      () => console.log(`理解已确认：${next.requestId}，现在可执行 product draft。`),
    );
  });

  withIO(
    product
      .command('draft')
      .description('从已确认理解稿生成 PRD 草稿文件')
      .requiredOption('--request <id>', '本地协议 request ID')
      .option('--file <path>', '输出路径'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const run = await loadProductRun(connection.workspaceDir, str(raw, 'request') ?? '');
    const next = await writePrdDraft(connection.workspaceDir, run, str(raw, 'file'));
    emitLocal(
      command,
      {
        requestId: next.requestId,
        status: next.status,
        revision: next.revision,
        file: next.prdDraftPath,
      },
      () => console.log(`PRD 草稿已生成：${next.prdDraftPath}`),
    );
  });

  withIO(
    program
      .command('candidate')
      .description('提交知识/理解/PRD 候选（不发布，不递归扫描目录）')
      .option('--kb <id>', 'knowledge base UUID (required when creating a new document)')
      .requiredOption('--kind <kind>', 'UNDERSTANDING | DECISION | PRD | KNOWLEDGE')
      .requiredOption('--file <path>', 'single candidate file')
      .option('--title <title>', 'candidate title (defaults to file name)')
      .option(
        '--requirement <id>',
        'requirement UUID (required when creating UNDERSTANDING/PRD; inferred for --document)',
      )
      .option('--document <id>', 'existing document UUID to add a revision to')
      .option('--basis-understanding-revision <id>', 'PRD basis Understanding revision UUID')
      .option('--delivery-scope <json>', 'PRD deliveryScope JSON, or @path/to/delivery-scope.json')
      .option('--acceptance <json>', 'PRD acceptance JSON array, or @path/to/acceptance.json')
      .option('--operation <uuid>', 'reuse an existing Idempotency-Key for retry'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const kind = (str(raw, 'kind') ?? '').toUpperCase() as CandidateKind;
    const basisUnderstandingRevisionId =
      str(raw, 'basisUnderstandingRevision') ?? str(raw, 'basis-understanding-revision');
    const deliveryScopeInput = str(raw, 'deliveryScope') ?? str(raw, 'delivery-scope');
    const acceptanceInput = str(raw, 'acceptance');
    const deliveryScope = deliveryScopeInput
      ? await parseCandidateJson(deliveryScopeInput, '--delivery-scope')
      : undefined;
    const acceptance = acceptanceInput
      ? await parseCandidateJson(acceptanceInput, '--acceptance')
      : undefined;
    const built = await buildCandidate(connection.workspace.projectId, {
      knowledgeBaseId: str(raw, 'kb'),
      kind,
      file: str(raw, 'file') ?? '',
      title: str(raw, 'title'),
      requirementId: str(raw, 'requirement'),
      documentId: str(raw, 'document'),
      basisUnderstandingRevisionId,
      deliveryScope,
      acceptance,
    });
    const written = await writeWithReceipt(connection, command, {
      method: 'POST',
      route: built.relativeRoute,
      body: built.body,
      sourceFiles: built.sourceFiles,
      operation: str(raw, 'operation'),
      resultRefs: (data) => {
        const record = asRecord(data, '候选响应结构非法');
        const revision = record.revision
          ? asRecord(record.revision, '候选 revision 非法')
          : undefined;
        const document = record.document
          ? asRecord(record.document, '候选 document 非法')
          : undefined;
        return {
          documentId:
            typeof record.documentId === 'string'
              ? record.documentId
              : typeof document?.id === 'string'
                ? document.id
                : null,
          revisionId:
            typeof record.revisionId === 'string'
              ? record.revisionId
              : typeof revision?.id === 'string'
                ? revision.id
                : null,
          reviewRequestId:
            typeof record.reviewRequestId === 'string'
              ? record.reviewRequestId
              : typeof revision?.reviewRequestId === 'string'
                ? revision.reviewRequestId
                : null,
        };
      },
    });
    const record = asRecord(written.data, '候选响应结构非法');
    const revision = record.revision ? asRecord(record.revision, '候选 revision 非法') : undefined;
    const document = record.document ? asRecord(record.document, '候选 document 非法') : undefined;
    const reviewRequestId =
      typeof record.reviewRequestId === 'string'
        ? record.reviewRequestId
        : typeof revision?.reviewRequestId === 'string'
          ? revision.reviewRequestId
          : null;
    emit(
      command,
      {
        ...pick(record, ['documentId', 'revisionId', 'status', 'version', 'reviewRequestId']),
        document: document ? pick(document, ['id', 'kind', 'version']) : null,
        revision: revision
          ? {
              ...pick(revision, ['id', 'seq', 'status', 'sha256', 'byteLength', 'reviewRequestId']),
              reviewRequestId,
            }
          : null,
        operationId: written.operationId,
      },
      written.requestId,
      () => {
        const documentId = record.documentId ?? document?.id;
        const revisionId = record.revisionId ?? revision?.id;
        console.log(
          `已提交候选 ${built.title}${documentId ? `（document ${String(documentId)}）` : ''}${revisionId ? ` revision ${String(revisionId)}` : ''}。`,
        );
        if (reviewRequestId)
          console.log(`评审请求 ${reviewRequestId}，请在 Web 中由 HUMAN 完成决策。`);
        console.log('候选尚未发布；发布需在 Web 由有权 HUMAN 独立确认。');
      },
    );
  });

  withIO(
    program
      .command('deliver')
      .description('提交 exact ArtifactSet（HOSTED bytes 在此计算摘要，GIT_REF 只登记定位）')
      .option('--task <id>', 'task UUID; uses its unique local execution')
      .option('--execution <id>', 'local execution UUID returned by claim')
      .option('--claim <id>', 'explicit current claim UUID')
      .option('--snapshot <id>', 'explicit context snapshot UUID')
      .option('--expected-version <n>', 'explicit task version expected by this write')
      .requiredOption('--manifest <file>', 'deliver manifest JSON')
      .option('--operation <uuid>', 'reuse an existing Idempotency-Key for retry'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const executionId = str(raw, 'execution');
    if (executionId) assertUuid(executionId, '--execution');
    const explicit = ['claim', 'snapshot', 'expected-version'].some(
      (key) => str(raw, key) !== undefined,
    );
    if (executionId && explicit)
      throw new CliError('INVALID_REQUEST', '--execution 不能与显式 claim/snapshot/version 混用');
    const selected = explicit
      ? null
      : await resolveExecution(connection, { executionId, taskId: str(raw, 'task') });
    const taskId = selected?.taskId ?? assertUuid(str(raw, 'task'), '--task');
    await withExecutionLock(connection, taskId, async () => {
      const execution = selected
        ? await resolveExecution(connection, { executionId: selected.executionId })
        : null;
      if (execution) assertExecutionReady(execution, true, str(raw, 'operation'));
      const claimId = execution?.claimId ?? assertUuid(str(raw, 'claim'), '--claim');
      const snapshotId = execution?.snapshotId ?? assertUuid(str(raw, 'snapshot'), '--snapshot');
      let retry = null;
      if (execution && str(raw, 'operation')) {
        try {
          retry = await readReceipt(connection.workspaceDir, str(raw, 'operation')!);
        } catch (error) {
          if (!(error instanceof CliError) || error.code !== 'RESOURCE_NOT_FOUND') throw error;
        }
      }
      const expectedVersion =
        retry?.execution?.expectedTaskVersion ??
        execution?.taskVersion ??
        positiveVersion(raw, 'expected-version');
      const built = await buildDeliver(str(raw, 'manifest') ?? '');
      const route = `/tasks/${encodeURIComponent(taskId)}/artifact-sets`;
      const body = {
        expectedVersion,
        claimId,
        snapshotId,
        ...built.payload,
      };
      const written = await writeWithReceipt(connection, command, {
        method: 'POST',
        route,
        body,
        sourceFiles: built.sourceFiles,
        ...(execution
          ? {
              execution: {
                id: execution.executionId,
                taskId,
                claimId,
                snapshotId,
                expectedTaskVersion: expectedVersion,
                stage: 'DELIVER' as const,
              },
            }
          : {}),
        operation: str(raw, 'operation'),
        resultRefs: (data) => {
          const record = asRecord(data, '交付响应结构非法');
          const artifactSet = record.artifactSet
            ? asRecord(record.artifactSet, '交付响应 artifactSet 非法')
            : undefined;
          return {
            taskId,
            artifactSetId: typeof artifactSet?.id === 'string' ? artifactSet.id : null,
            reviewRequestId:
              typeof record.reviewRequestId === 'string' ? record.reviewRequestId : null,
            claimId,
            snapshotId,
            ...committedTaskState(record),
          };
        },
      });
      const record = asRecord(written.data, '交付响应结构非法');
      const task = record.task ? asRecord(record.task, '交付响应 task 非法') : undefined;
      const artifactSet = record.artifactSet
        ? asRecord(record.artifactSet, '交付响应 artifactSet 非法')
        : undefined;
      const artifactSetId = typeof artifactSet?.id === 'string' ? artifactSet.id : null;
      const { taskVersion } = committedTaskState(record);
      const reviewRequestId =
        typeof record.reviewRequestId === 'string' ? record.reviewRequestId : null;
      const reviewWebUrl = reviewRequestId
        ? `${connection.workspace.platform.origin}/reviews/${encodeURIComponent(reviewRequestId)}`
        : null;
      emit(
        command,
        {
          taskId,
          artifactSetId,
          reviewRequestId,
          reviewWebUrl,
          taskStatus: task?.executionStatus ?? null,
          taskVersion,
          replayed: record.replayed === true,
          operationId: written.operationId,
          executionId: execution?.executionId ?? null,
        },
        written.requestId,
        () => {
          console.log(`已交付 ArtifactSet${artifactSetId ? ` ${artifactSetId}` : ''}。`);
          console.log(
            `任务 ${taskId}${taskVersion !== null ? ` v${taskVersion}` : ''} 停在评审；人工确认前不会 DONE。`,
          );
          if (reviewRequestId) console.log(`已自动创建评审 ${reviewRequestId}：${reviewWebUrl}`);
          else console.log('当前响应未提供评审编号，请在任务详情核对后续状态。');
          console.log('请等待 HUMAN 审阅；如被要求修改，请按评审意见返修并重新交付。');
        },
      );
    });
  });

  const executionCommand = program
    .command('execution')
    .description('查看由安全操作收据恢复的本地执行状态');
  withIO(executionCommand.command('list').option('--task <id>', 'filter by task UUID')).action(
    async (raw: Options, command: Command) => {
      const connection = await connect(command);
      const taskId = str(raw, 'task') ? assertUuid(str(raw, 'task'), '--task') : undefined;
      const items = (await listExecutions(connection)).filter(
        (entry) => !taskId || entry.taskId === taskId,
      );
      emitLocal(command, { items, freshness: 'local-journal' }, () => {
        for (const item of items)
          console.log(
            `${item.executionId}  ${item.taskId}  ${item.stage}  task v${item.taskVersion ?? '?'}`,
          );
        if (!items.length) console.log('当前凭据和工作区没有本地执行记录。');
        console.log('状态来自本机收据；待核对操作请先 receipt reconcile，远端版本仍由服务端校验。');
      });
    },
  );
  withIO(
    executionCommand
      .command('status')
      .option('--execution <id>', 'execution UUID')
      .option('--task <id>', 'unique execution task UUID'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const item = await resolveExecution(connection, {
      executionId: str(raw, 'execution')
        ? assertUuid(str(raw, 'execution'), '--execution')
        : undefined,
      taskId: str(raw, 'task') ? assertUuid(str(raw, 'task'), '--task') : undefined,
    });
    const nextAction = item.pendingOperations.length
      ? `receipt reconcile --operation ${item.pendingOperations[0]}`
      : item.stage === 'NEEDS_INSPECTION'
        ? `tasks show --task ${item.taskId}`
        : item.reviewRequestId
          ? `review --execution ${item.executionId}`
          : item.snapshotId
            ? `deliver --execution ${item.executionId} --manifest deliver.json`
            : `context --execution ${item.executionId} --materialize`;
    emitLocal(command, { ...item, nextAction, freshness: 'local-journal' }, () => {
      console.log(
        `执行 ${item.executionId}：${item.stage}；任务 ${item.taskId} v${item.taskVersion ?? '?'}。`,
      );
      console.log(`下一步：workmesh ${nextAction}`);
    });
  });

  const review = withIO(
    program
      .command('review')
      .description('创建人工评审请求（只请求，不批准）')
      .option('--task <id>', 'task UUID to associate')
      .option('--execution <id>', 'show the review already created by this execution delivery')
      .option('--artifact-set <id>', 'TASK_ARTIFACT_SET subject UUID')
      .option('--document-revision <id>', 'DOCUMENT_REVISION subject UUID')
      .option(
        '--expected-version <n>',
        'task version for an artifact-set review; document version for a revision',
      )
      .option('--operation <uuid>', 'reuse an existing Idempotency-Key for retry'),
  );
  review.action(async (raw: Options, command: Command) => {
    const artifactSet = str(raw, 'artifact-set');
    const revision = str(raw, 'document-revision');
    if (str(raw, 'execution') || (str(raw, 'task') && !artifactSet && !revision)) {
      if (artifactSet || revision || str(raw, 'expected-version') || str(raw, 'operation'))
        throw new CliError(
          'INVALID_REQUEST',
          '执行评审入口只读取交付已创建的评审，不与创建选项组合',
        );
      const connection = await connect(command);
      const execution = await resolveExecution(connection, {
        executionId: str(raw, 'execution')
          ? assertUuid(str(raw, 'execution'), '--execution')
          : undefined,
        taskId: str(raw, 'task') ? assertUuid(str(raw, 'task'), '--task') : undefined,
      });
      if (execution.pendingOperations.length)
        throw new CliError('EXECUTION_PENDING', '交付结果待核对，请先 receipt reconcile。', {
          details: { operationId: execution.pendingOperations[0] },
        });
      if (!execution.reviewRequestId)
        throw new CliError(
          'EXECUTION_REVIEW_UNAVAILABLE',
          '本次执行尚无已确认的评审；请先交付或核对原操作。',
        );
      const response = await connection.client.request<unknown>(
        'GET',
        `/review-requests/${encodeURIComponent(execution.reviewRequestId)}`,
      );
      const record = asRecord(response.data, '评审响应结构非法');
      const webUrl = `${connection.workspace.platform.origin}/reviews/${encodeURIComponent(execution.reviewRequestId)}`;
      emit(
        command,
        {
          ...record,
          executionId: execution.executionId,
          reviewRequestId: execution.reviewRequestId,
          webUrl,
          reused: true,
        },
        response.requestId,
        () => {
          console.log(
            `本次交付已创建评审 ${execution.reviewRequestId}，当前状态 ${String(record.status ?? '未知')}。`,
          );
          console.log(`请在 Web 打开：${webUrl}`);
        },
      );
      return;
    }
    const subject = reviewSubjectOf(artifactSet, revision);
    const expectedVersion = positiveVersion(raw, 'expected-version');
    const taskId = str(raw, 'task');
    const body = {
      subject,
      expectedVersion,
      ...(taskId ? { taskId: assertUuid(taskId, '--task') } : {}),
    };
    const connection = await connect(command);
    const written = await writeWithReceipt(connection, command, {
      method: 'POST',
      route: '/review-requests',
      body,
      operation: str(raw, 'operation'),
      resultRefs: (data) => {
        const record = asRecord(data, '评审响应结构非法');
        return {
          reviewRequestId: typeof record.id === 'string' ? record.id : null,
          version: typeof record.version === 'number' ? record.version : null,
        };
      },
    });
    const record = asRecord(written.data, '评审响应结构非法');
    const reviewId = typeof record.id === 'string' ? record.id : '';
    const webUrl = `${connection.workspace.platform.origin}/reviews/${encodeURIComponent(reviewId)}`;
    emit(
      command,
      {
        reviewRequestId: reviewId,
        status: record.status ?? null,
        version: record.version ?? null,
        slots: record.slots ?? null,
        webUrl,
        requestedOnly: true,
      },
      written.requestId,
      () => {
        console.log(`已请求人工确认：${reviewId}（尚未批准）。`);
        console.log(`请在 Web 打开：${webUrl}`);
        console.log('CLI 只创建评审请求；批准、拒绝与发布均由有权的 HUMAN 在 Web 执行。');
      },
    );
  });

  withIO(
    review
      .command('show')
      .description('读取评审状态和人工决定，不执行批准')
      .requiredOption('--review <uuid>', 'review request UUID')
      .option('--discussion-cursor <cursor>', 'nextCursor from the discussion page'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const reviewId = assertUuid(str(raw, 'review'), '--review');
    const response = await connection.client.request<unknown>(
      'GET',
      `/review-requests/${encodeURIComponent(reviewId)}`,
    );
    const record = asRecord(response.data, '评审响应结构非法');
    const webUrl = `${connection.workspace.platform.origin}/reviews/${encodeURIComponent(reviewId)}`;
    let discussions: Record<string, unknown> | null = null;
    let discussionError: { code: string; message: string } | null = null;
    try {
      discussions = asRecord(
        (
          await connection.client.request<unknown>(
            'GET',
            `/review-requests/${encodeURIComponent(reviewId)}/discussions`,
            { query: { cursor: str(raw, 'discussion-cursor') } },
          )
        ).data,
        '评审问题结构非法',
      );
    } catch (caught) {
      const error = asCliError(caught);
      discussionError = { code: error.code, message: error.message };
    }
    emit(command, { ...record, webUrl, discussions, discussionError }, response.requestId, () => {
      console.log(
        `评审 ${reviewId} · ${String(record.status ?? '未知')} · v${String(record.version ?? '?')}`,
      );
      for (const value of Array.isArray(record.decisions) ? record.decisions : []) {
        const decision = asRecord(value, '决定结构非法');
        console.log(`${String(decision.decision)}：${String(decision.comment ?? '未填写说明')}`);
      }
      if (discussionError)
        console.log(
          `评审问题读取失败 [${discussionError.code}]：${discussionError.message}（不能据此认为没有问题）。`,
        );
      else if (discussions) {
        console.log(`未解决问题 ${String(discussions.unresolvedCount ?? '?')} 项`);
        for (const value of Array.isArray(discussions.items) ? discussions.items : []) {
          const discussion = asRecord(value, '问题结构非法');
          const source = asRecord(discussion.source, '问题来源结构非法');
          console.log(
            `问题 ${String(discussion.id)} · v${String(discussion.version ?? '?')} · ${discussion.resolved ? '已解决' : '未解决'} · 来源评审 ${String(source.reviewId)}：${String(discussion.title)}`,
          );
          console.log(String(discussion.body));
          for (const entryValue of Array.isArray(discussion.entries) ? discussion.entries : []) {
            const entry = asRecord(entryValue, '问题回应结构非法');
            console.log(`  ${String(entry.kind)}：${String(entry.body ?? '')}`);
          }
          if (discussion.nextEntriesCursor)
            console.log(
              `更多回应：workmesh review entries --review ${String(source.reviewId)} --discussion ${String(discussion.id)} --cursor ${String(discussion.nextEntriesCursor)}`,
            );
        }
        if (discussions.nextCursor)
          console.log(
            `更多问题：workmesh review show --review ${reviewId} --discussion-cursor ${String(discussions.nextCursor)}`,
          );
      }
      console.log(`查看完整证据与评审问题：${webUrl}`);
    });
  });

  withIO(
    review
      .command('issue')
      .description('提出绑定当前评审版本的问题，不提交人工决定')
      .requiredOption('--review <uuid>', 'review request UUID')
      .requiredOption('--title <text>', '问题标题，最多 200 字符')
      .requiredOption('--body <text>', '问题说明，最多 10000 字符')
      .option('--operation <uuid>', 'reuse the original operation UUID after an unknown result'),
  ).action(async (raw: Options, command: Command) => {
    const reviewId = assertUuid(str(raw, 'review'), '--review');
    const title = discussionText(raw, 'title', 200);
    const body = discussionText(raw, 'body', 10000);
    const connection = await connect(command);
    const written = await writeWithReceipt(connection, command, {
      method: 'POST',
      route: `/review-requests/${reviewId}/discussions`,
      body: { title, body },
      operation: str(raw, 'operation'),
      resultRefs: (data) => {
        const record = asRecord(data, '评审问题响应结构非法');
        return {
          reviewRequestId: reviewId,
          discussionId: typeof record.discussionId === 'string' ? record.discussionId : null,
          version: typeof record.version === 'number' ? record.version : null,
        };
      },
    });
    const result = asRecord(written.data, '评审问题响应结构非法');
    emit(command, { ...result, operationId: written.operationId }, written.requestId, () => {
      console.log('评审问题已记录；它不改变人工批准状态。');
      console.log(`问题 ${String(result.discussionId ?? '?')} · v${String(result.version ?? '?')}`);
      console.log(`继续查询：workmesh review show --review ${reviewId}`);
      console.log(`操作编号 ${written.operationId}`);
    });
  });

  withIO(
    review
      .command('reply')
      .description('逐项回应、解决或重开问题；权限由服务端复核，不提交人工决定')
      .requiredOption('--review <uuid>', 'current review request UUID')
      .requiredOption('--discussion <uuid>', 'discussion UUID')
      .requiredOption('--expected-version <n>', 'current discussion version')
      .requiredOption('--body <text>', '回应或解决依据，最多 10000 字符')
      .option('--kind <kind>', 'REPLY, RESOLVED or REOPENED', 'REPLY')
      .option('--addressed-in-review <uuid>', '关联实际调整交付的评审 UUID')
      .option('--operation <uuid>', 'reuse the original operation UUID after an unknown result'),
  ).action(async (raw: Options, command: Command) => {
    const reviewId = assertUuid(str(raw, 'review'), '--review');
    const discussionId = assertUuid(str(raw, 'discussion'), '--discussion');
    const kind = str(raw, 'kind');
    if (!kind || !['REPLY', 'RESOLVED', 'REOPENED'].includes(kind))
      throw new CliError('VALIDATION_FAILED', '--kind 必须为 REPLY、RESOLVED 或 REOPENED');
    const addressedInReviewId = str(raw, 'addressed-in-review');
    const body = {
      kind,
      expectedVersion: positiveVersion(raw, 'expected-version'),
      body: discussionText(raw, 'body', 10000),
      ...(addressedInReviewId
        ? { addressedInReviewId: assertUuid(addressedInReviewId, '--addressed-in-review') }
        : {}),
    };
    const connection = await connect(command);
    const written = await writeWithReceipt(connection, command, {
      method: 'POST',
      route: `/review-requests/${reviewId}/discussions/${discussionId}/entries`,
      body,
      operation: str(raw, 'operation'),
      resultRefs: (data) => {
        const record = asRecord(data, '评审问题响应结构非法');
        return {
          reviewRequestId: reviewId,
          discussionId,
          entryId: typeof record.entryId === 'string' ? record.entryId : null,
          version: typeof record.version === 'number' ? record.version : null,
        };
      },
    });
    const result = asRecord(written.data, '评审问题响应结构非法');
    emit(command, { ...result, operationId: written.operationId }, written.requestId, () => {
      console.log(
        `${kind === 'RESOLVED' ? '问题已标记解决' : kind === 'REOPENED' ? '问题已重新打开' : '回应已记录'}；人工批准需在 Web 单独提交。`,
      );
      console.log(`问题 ${String(result.discussionId ?? '?')} · v${String(result.version ?? '?')}`);
      console.log(`继续查询：workmesh review show --review ${reviewId}`);
      console.log(`操作编号 ${written.operationId}`);
    });
  });

  withIO(
    review
      .command('entries')
      .description('分页读取某个问题的追加回应与解决/重开记录')
      .requiredOption('--review <uuid>', 'source review UUID')
      .requiredOption('--discussion <uuid>', 'discussion UUID')
      .option('--cursor <cursor>', 'nextEntriesCursor or nextCursor'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const reviewId = assertUuid(str(raw, 'review'), '--review');
    const discussionId = assertUuid(str(raw, 'discussion'), '--discussion');
    const response = await connection.client.request<unknown>(
      'GET',
      `/review-requests/${encodeURIComponent(reviewId)}/discussions/${encodeURIComponent(discussionId)}/entries`,
      { query: { cursor: str(raw, 'cursor') } },
    );
    const page = asRecord(response.data, '问题回应结构非法');
    emit(command, page, response.requestId, () => {
      for (const value of Array.isArray(page.items) ? page.items : []) {
        const entry = asRecord(value, '问题回应结构非法');
        console.log(
          `${String(entry.kind)} · ${String(entry.createdAt)}：${String(entry.body ?? '')}`,
        );
      }
      if (page.nextCursor)
        console.log(
          `下一页：workmesh review entries --review ${reviewId} --discussion ${discussionId} --cursor ${String(page.nextCursor)}`,
        );
    });
  });

  const tasks = program.command('tasks').description('发现任务、核对版本与后续操作');
  withIO(
    tasks
      .command('ready')
      .description('列出前置任务已完成的团队任务，并显示本人领取资格')
      .option('--cursor <cursor>', 'nextCursor from a previous page')
      .option('--limit <n>', 'page size 1..200', '20'),
  ).action(async (raw: Options, command: Command) => {
    const limit = positiveVersion(raw, 'limit');
    if (limit > 200) throw new CliError('VALIDATION_FAILED', '--limit 必须为 1..200');
    const connection = await connect(command);
    const response = await connection.client.request<unknown>(
      'GET',
      `/projects/${encodeURIComponent(connection.workspace.projectId)}/tasks/ready`,
      { query: { limit, cursor: str(raw, 'cursor') } },
    );
    const page = asRecord(response.data, '任务列表结构非法');
    emit(command, page, response.requestId, () => {
      for (const value of Array.isArray(page.items) ? page.items : []) {
        const task = asRecord(value, '任务结构非法');
        const eligibility =
          task.claimEligibility == null
            ? null
            : asRecord(task.claimEligibility, '领取资格结构非法');
        const canClaim = eligibility && eligibility.canClaim === true;
        console.log(
          `${String(task.id)} · ${String(task.stepKey)} · v${String(task.version)} · ${canClaim ? '本人可领取' : `本人不可领取（${String(eligibility ? eligibility.reason : '资格待确认')}）`}`,
        );
        if (canClaim) console.log(`workmesh claim --task ${String(task.id)}`);
      }
      if (Array.isArray(page.items) && page.items.length === 0)
        console.log('当前范围没有前置任务已完成的任务。');
      if (page.nextCursor)
        console.log(`下一页：workmesh tasks ready --cursor ${String(page.nextCursor)}`);
      console.log('输入内容与本机环境需另行核验；实际领取仍由服务端复核。');
    });
  });
  withIO(
    tasks
      .command('show')
      .description('读取任务当前版本、领取状态及输入核验')
      .requiredOption('--task <uuid>', 'task UUID'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const taskId = assertUuid(str(raw, 'task'), '--task');
    const response = await connection.client.request<unknown>(
      'GET',
      `/tasks/${encodeURIComponent(taskId)}`,
    );
    const record = asRecord(response.data, '任务响应结构非法');
    const inputResponse = await connection.client.request<unknown>(
      'GET',
      `/tasks/${encodeURIComponent(taskId)}/input-status`,
    );
    emit(command, { task: record, inputs: inputResponse.data }, response.requestId, () => {
      console.log(
        `任务 ${taskId} · ${String(record.executionStatus)} / ${String(record.workStatus)} · v${String(record.version)}`,
      );
      const inputs = asRecord(inputResponse.data, '输入状态结构非法');
      console.log(
        `输入内容：${String(inputs.availability)}；快照变化：${String(asRecord(inputs.comparison, '快照对照结构非法').status)}`,
      );
      if (inputs.issue === 'SNAPSHOT_EXTERNAL_INPUT_UNSUPPORTED') {
        console.log('必需上游工件仅提供外部 Git 引用，当前无法生成可展开的任务快照。');
        console.log('请上游责任人按流程补交并验收 HOSTED 正文；本机核验代码引用不能解除此限制。');
        return;
      }
      const claim = record.currentClaim ? asRecord(record.currentClaim, '领取结构非法') : null;
      if (
        claim &&
        claim.principalScopeKey === `agent:${connection.credentialId}` &&
        !claim.releasedAt
      )
        console.log(
          `重新获取上下文：workmesh context --task ${taskId} --claim ${String(claim.id)} --expected-version ${String(record.version)}`,
        );
      else
        console.log(
          claim
            ? '任务已有领取者；请由原领取者继续，或由有权人员明确释放后再操作。'
            : '请先核对本人领取资格，再领取和获取上下文。',
        );
    });
  });

  const receipt = program.command('receipt').description('本地操作 receipt（不含请求/响应正文）');

  withIO(
    receipt
      .command('list')
      .description('离线列出待核对操作（默认 PENDING，不请求服务端）')
      .option('--status <status>', 'PENDING、COMMITTED、REJECTED 或 ALL', 'PENDING'),
  ).action(async (raw: Options, command: Command) => {
    const io = optionsOf(command);
    const workspaceDir = workspaceDirOf(io);
    const snapshot = await detectWorkspaceState(workspaceDir);
    if (snapshot.state === 'DUAL_ACTIVE') throw dualConfigError(snapshot);
    const status = str(raw, 'status') ?? 'PENDING';
    if (!['PENDING', 'COMMITTED', 'REJECTED', 'ALL'].includes(status))
      throw new CliError('INVALID_REQUEST', '--status 必须是 PENDING、COMMITTED、REJECTED 或 ALL');
    const records = await listReceipts(
      workspaceDir,
      status as 'PENDING' | 'COMMITTED' | 'REJECTED' | 'ALL',
    );
    const items = records.map((record) => ({
      operationId: record.operationId,
      status: record.status,
      method: record.method,
      relativeRoute: record.relativeRoute,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      nextAction:
        record.status === 'PENDING'
          ? `workmesh receipt reconcile --operation ${record.operationId}`
          : null,
    }));
    emitLocal(command, { items, freshness: 'local-only' }, () => {
      if (items.length === 0)
        console.log(status === 'PENDING' ? '本地没有待核对操作。' : '本地没有匹配的操作记录。');
      for (const item of items) {
        console.log(`${item.operationId}  ${item.status}  ${item.method} ${item.relativeRoute}`);
        if (item.nextAction) console.log(`核对：${item.nextAction}`);
      }
      console.log('以上为本地记录；PENDING 表示结果尚未确认，需使用原工作目录和配置核对。');
    });
  });

  withIO(
    receipt
      .command('show')
      .description('显示本地 receipt 的安全元数据')
      .requiredOption('--operation <uuid>', 'operation UUID'),
  ).action(async (raw: Options, command: Command) => {
    const io = optionsOf(command);
    const snapshot = await detectWorkspaceState(workspaceDirOf(io));
    if (snapshot.state === 'DUAL_ACTIVE') throw dualConfigError(snapshot);
    const record = await readReceipt(workspaceDirOf(io), operationIdOf(str(raw, 'operation')));
    emitLocal(
      command,
      {
        operationId: record.operationId,
        status: record.status,
        method: record.method,
        relativeRoute: record.relativeRoute,
        requestDigest: record.requestDigest,
        sourceFiles: record.sourceFiles,
        resultRefs: record.resultRefs ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        freshness: 'local-only',
      },
      () => {
        console.log(
          `${record.operationId}  ${record.status}  ${record.method} ${record.relativeRoute}`,
        );
        console.log(`digest ${record.requestDigest}`);
        console.log('本地 receipt 仅代表本机记录，不保证服务端已提交（stale 需 reconcile）。');
      },
    );
  });

  withIO(
    receipt
      .command('reconcile')
      .description('GET /operation-receipts 核对服务端记录并更新本地安全元数据')
      .requiredOption('--operation <uuid>', 'operation UUID (original Idempotency-Key)'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const operationId = operationIdOf(str(raw, 'operation'));
    const original = await readReceipt(connection.workspaceDir, operationId);
    const reconcile = async () => {
      const { local, updated, server, resultRefs } = await reconcileOperation({
        workspaceDir: connection.workspaceDir,
        operationId,
        scopeKey: connection.scopeKey,
        credentialId: connection.credentialId,
        projectId: connection.workspace.projectId,
        apiBasePath: connection.workspace.platform.apiBasePath,
        fetchReceipt: async () =>
          (
            await connection.client.request<unknown>(
              'GET',
              `/operation-receipts/${encodeURIComponent(operationId)}`,
              { query: { projectId: connection.workspace.projectId } },
            )
          ).data,
      });
      emitLocal(
        command,
        {
          operationId,
          status: updated.status,
          requestDigest: updated.requestDigest,
          serverRequestDigest: server.requestDigest ?? null,
          resultRefs,
          committedAt: server.committedAt ?? null,
          localUpdatedAt: updated.updatedAt,
        },
        () => {
          console.log(
            `服务端已提交 ${operationId}（digest ${String(server.requestDigest ?? '')}）。`,
          );
          console.log(`本地 status：${local.status} → ${updated.status}`);
        },
      );
    };
    if (original.execution)
      await withExecutionLock(connection, original.execution.taskId, reconcile);
    else await reconcile();
  });

  withIO(
    program
      .command('artifact')
      .description('只读查询工件集及代码证据诊断')
      .requiredOption('--artifact-set <id>', '准确的工件集 ID'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const id = str(raw, 'artifact-set') ?? '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new CliError('VALIDATION_FAILED', '--artifact-set 必须是 UUID');
    const response = await connection.client.request<unknown>(
      'GET',
      `/artifact-sets/${encodeURIComponent(id)}`,
    );
    const value = asRecord(response.data, 'artifact 响应结构非法');
    const codeReview = value.codeReview
      ? asRecord(value.codeReview, 'codeReview 响应结构非法')
      : undefined;
    emit(command, value, response.requestId, () => {
      console.log(`工件集 ${String(value.id ?? id)}`);
      console.log(
        `现有平台代码门禁：${codeReview?.acceptable === true ? '满足' : codeReview?.acceptable === false ? '未满足' : '未提供'}`,
      );
      for (const line of renderCodeEvidence(
        codeReview?.diagnostics as CodeEvidenceDiagnostics | undefined,
      ))
        console.log(line);
    });
  });

  withIO(
    program
      .command('changes')
      .description('当前项目/角色的收件事件（服务端过滤，稳定分页）')
      .option('--cursor <cursor>', 'nextCursor from a previous page')
      .option('--limit <n>', 'page size 1..200', '20')
      .option('--acked', 'show already acknowledged recipients', false),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const limit = Number(str(raw, 'limit') ?? '20');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw new CliError('VALIDATION_FAILED', '--limit 必须是 1..200 的整数');
    const response = await connection.client.request<unknown>('GET', '/change-recipients', {
      query: {
        projectId: connection.workspace.projectId,
        limit,
        cursor: str(raw, 'cursor'),
        ...(flag(raw, 'acked') ? { ackedOnly: 'true' } : {}),
      },
    });
    const record = asRecord(response.data, 'changes 响应结构非法');
    if (!Array.isArray(record.items)) throw new CliError('PROTOCOL_INVALID', 'changes items 非法');
    const items = record.items;
    if (record.nextCursor !== null && typeof record.nextCursor !== 'string')
      throw new CliError('PROTOCOL_INVALID', 'changes nextCursor 非法');
    const nextCursor = record.nextCursor;
    emit(command, { items, nextCursor, hasMore: nextCursor !== null }, response.requestId, () => {
      if (!items.length) {
        console.log('当前没有待处理的变更。');
        return;
      }
      for (const item of items) {
        const row = asRecord(item, 'change item 非法');
        console.log(
          `${String(row.recipientId ?? row.id ?? '')}  ${String(row.eventId ?? '')}  ${String(row.changeSummary ?? row.summary ?? '')}`,
        );
        for (const line of renderChangeGuidance(row.guidance)) console.log(line);
      }
      if (nextCursor) console.log(`下一页：--cursor ${nextCursor}`);
      console.log('ack 仅表示已收到通知；调整完成仍需交付与验收。请在 Web 确认已知悉。');
    });
  });

  withIO(
    program
      .command('doctor')
      .description('集中检查接入环境（默认只读，不登录、不消费接入码）')
      .option('--role <key>', '检查所选角色的内置资源，例如 frontend')
      .option('--package <dir>', '仅自定义角色包需要显式目录')
      .option('--online', 'GET 检查平台服务就绪状态', false)
      .option('--check-storage', '用临时文件验证凭据目录的权限能力，检查后移除', false),
  ).action(async (raw: Options, command: Command) => {
    const io = optionsOf(command);
    const result = await runDoctor({
      workspaceDir: workspaceDirOf(io),
      configHome: configHome(str(io, 'config-home')),
      api: str(io, 'api'),
      role: str(raw, 'role'),
      packageDir: str(raw, 'package'),
      online: flag(raw, 'online'),
      probeStorage: flag(raw, 'check-storage'),
    });
    if (!result.ok)
      throw new CliError('PREFLIGHT_FAILED', '环境诊断存在阻塞项。', {
        exitCode: 2,
        details: { doctor: result },
      });
    emitLocal(command, result, () => {
      for (const line of renderDoctor(result)) console.log(line);
    });
  });

  const workspaceCommand = program
    .command('workspace')
    .description('项目工作区：init / discover / bind / status / recover / migrate');

  function workspaceRootOf(options: Options, raw: Options): string {
    return str(raw, 'root') ?? workspaceDirOf(options);
  }

  withIO(
    workspaceCommand
      .command('init')
      .description('接入码初始化：消费码 → 设备授权 → 精确 revision 校验 → 原子写 v2 配置')
      .requiredOption('--join <code>', 'Web 生成的一次性接入码（不落盘）')
      .requiredOption('--role <key>', '业务角色 key，例如 backend（浏览器最终确认）')
      .option('--root <dir>', '工作区根目录（默认 --dir 或 cwd）')
      .option('--host <host>', 'codex | claude-code（默认 codex）')
      .option('--apply', '确认后消费接入码并写入本机配置（默认只做前置检查与计划）', false)
      .option('--yes', '非交互确认（仍需 --apply 才写入）', false)
      .option('--timeout <seconds>', '设备授权等待秒数')
      .option('--client-name <name>', '授权页显示的客户端名', 'workmesh-workspace-init'),
  ).action(async (raw: Options, command: Command) => {
    const io = optionsOf(command);
    const api = str(io, 'api');
    if (!api)
      throw new CliError(
        'INVALID_REQUEST',
        'workspace init --join 首次接入必须显式提供 --api <base>（工作区尚无平台配置）',
      );
    const timeoutSeconds = str(raw, 'timeout') ? Number(str(raw, 'timeout')) : undefined;
    if (timeoutSeconds !== undefined && (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0))
      throw new CliError('VALIDATION_FAILED', '--timeout 必须是正数秒');
    const result: WorkspaceInitResult = await runWorkspaceInit({
      root: workspaceRootOf(io, raw),
      joinCode: str(raw, 'join') ?? '',
      api,
      role: str(raw, 'role') ?? '',
      host: str(raw, 'host'),
      configHome: configHome(str(io, 'config-home')),
      apply: flag(raw, 'apply'),
      yes: flag(raw, 'yes'),
      clientName: str(raw, 'client-name'),
      timeoutMs: timeoutSeconds ? Math.floor(timeoutSeconds * 1000) : undefined,
      preflight: async () =>
        assertDoctorReady(
          await runDoctor({
            workspaceDir: resolve(workspaceRootOf(io, raw)),
            configHome: configHome(str(io, 'config-home')),
            api,
            role: str(raw, 'role'),
            online: true,
            probeStorage: true,
            checkPackage: false,
          }),
        ),
      onStage: (stage) => {
        if (!jsonMode(command)) process.stderr.write(`接入阶段：${INIT_STAGE_LABELS[stage]}\n`);
      },
    });
    emitLocal(command, result, () => {
      if (result.mode === 'plan') {
        console.log(`接入计划（${result.platform.origin}${result.platform.apiBasePath}）`);
        console.log(`角色：${result.role}  宿主：${result.host}`);
        console.log(`业务工作目录：${resolve(workspaceRootOf(io, raw))}`);
        console.log('将写入：');
        for (const path of result.wouldWrite) console.log(`  ${path}`);
        console.log(result.nextAction);
        return;
      }
      console.log(
        `已接入项目 ${result.projectId}${result.projectName ? `（${result.projectName}）` : ''}`,
      );
      console.log(`workspaceId ${result.workspaceId}`);
      console.log(
        `业务工作目录：${resolve(workspaceRootOf(io, raw))}；角色：${str(raw, 'role')}；宿主：${str(raw, 'host') ?? 'codex'}`,
      );
      console.log(
        `定义 revision ${result.definition.revisionId}（digest ${result.definition.digest}）`,
      );
      console.log(`仓库映射 ${result.repositories.length} 条（${result.layoutKind}）`);
      for (const file of result.files) console.log(`已写入 ${file}`);
      console.log(`用户索引 ${result.userIndex}`);
      for (const warning of result.warnings) console.log(`提示：${warning}`);
      console.log(result.verificationText);
      console.log('\n接入成功。按顺序执行以下命令：');
      let stepNum = 0;
      for (const next of result.nextActions) {
        // The first action is a plain notice, not a numbered step.
        if (next.startsWith('workmesh') || next.startsWith('根据')) {
          stepNum += 1;
          console.log(`  ${stepNum}. ${next}`);
        } else {
          console.log(`  ${next}`);
        }
      }
      console.log('\n完整步骤与故障排查见 docs/cli-onboarding.md。');
    });
  });

  withIO(
    workspaceCommand
      .command('recover')
      .description('只读检查中断初始化；--apply 仅清理精确匹配且已提交的 pending 记录')
      .option('--root <dir>', '工作区根目录（默认 --dir 或 cwd）')
      .option('--apply', '验证配置、用户索引和计划摘要后清理已提交记录，不消费接入码', false),
  ).action(async (raw: Options, command: Command) => {
    const io = optionsOf(command);
    const result = await runWorkspaceRecover({
      root: workspaceRootOf(io, raw),
      configHome: configHome(str(io, 'config-home')),
      apply: flag(raw, 'apply'),
    });
    if (!['NO_PENDING', 'COMMITTED_PENDING', 'CLEANED'].includes(result.state))
      throw new CliError(
        'WORKSPACE_RECOVERY_BLOCKED',
        '初始化恢复需要处理诊断项；本次没有清理 pending。',
        { exitCode: result.state === 'LOCKED' ? 5 : 6, details: { recovery: result } },
      );
    emitLocal(command, result, () => {
      console.log(`业务工作目录：${resolve(workspaceRootOf(io, raw))}`);
      renderWorkspaceRecovery(result);
    });
  });

  withIO(
    workspaceCommand
      .command('discover')
      .description('只读发现 Git roots / remotes / branch / SHA / dirty（不绑定、不写索引）')
      .option('--root <dir>', '工作区根目录（默认 --dir 或 cwd）')
      .option('--max-depth <n>', '最大发现深度（默认 3）')
      .option('--max-directories <n>', '最多扫描目录数（默认 200）'),
  ).action(async (raw: Options, command: Command) => {
    const io = optionsOf(command);
    const maxDepth = str(raw, 'max-depth') ? Number(str(raw, 'max-depth')) : undefined;
    const maxDirectories = str(raw, 'max-directories')
      ? Number(str(raw, 'max-directories'))
      : undefined;
    const result: WorkspaceDiscoverResult = await runWorkspaceDiscover({
      root: workspaceRootOf(io, raw),
      configHome: configHome(str(io, 'config-home')),
      maxDepth,
      maxDirectories,
    });
    emitLocal(command, result, () => {
      console.log(`工作区状态：${result.state}${result.truncated ? '（扫描已截断）' : ''}`);
      if (!result.gitAvailable) console.log('未检测到 git 可执行文件；仅报告工作区配置状态。');
      if (result.candidates.length === 0) console.log('未发现 Git root。');
      for (const candidate of result.candidates) {
        const flags = [
          candidate.checkoutKind,
          candidate.branch ?? 'detached',
          candidate.head ? candidate.head.slice(0, 12) : 'no-commit',
          candidate.dirty ? 'dirty' : 'clean',
          candidate.insideRoot ? '' : 'root 外',
          candidate.knownWorkspaceId ? `index:${candidate.knownWorkspaceId}` : '',
        ]
          .filter(Boolean)
          .join('  ');
        console.log(`${candidate.relativePath}  ${flags}`);
        for (const remote of candidate.remotes)
          console.log(
            `  ${remote.name}  ${remote.canonicalLocator}${remote.redacted ? '（凭据已脱敏）' : ''}`,
          );
      }
      for (const next of result.nextActions) console.log(`下一步：${next}`);
    });
  });

  withIO(
    workspaceCommand
      .command('bind')
      .description('绑定平台定义中的仓库到本机 checkout（默认预览，--yes 才写入）')
      .requiredOption('--repository <id>', '平台 ProjectRepository UUID')
      .requiredOption('--path <dir>', '仓库 checkout 路径（相对 --root 或 root 内绝对路径）')
      .option('--root <dir>', '工作区根目录（默认 --dir 或 cwd）')
      .option('--offline', '仅用摘要有效的 revision 缓存 + 精确 canonical locator 匹配', false)
      .option('--yes', '确认写入 workspace.json 与用户索引', false),
  ).action(async (raw: Options, command: Command) => {
    const io = optionsOf(command);
    const result: WorkspaceBindResult = await runWorkspaceBind({
      root: workspaceRootOf(io, raw),
      repositoryId: str(raw, 'repository') ?? '',
      path: str(raw, 'path') ?? '',
      offline: flag(raw, 'offline'),
      apply: flag(raw, 'yes'),
      configHome: configHome(str(io, 'config-home')),
      api: str(io, 'api'),
    });
    emitLocal(command, result, () => {
      console.log(
        `${result.applied ? '已绑定' : '绑定预览'} ${result.repository.key} → ${result.repository.path}（remote ${result.repository.remote}）`,
      );
      console.log(`身份状态 ${result.identityStatus}（${result.verificationText}）`);
      console.log(
        `定义 revision ${result.definition.revisionId} 来源 ${result.definition.source}${result.definition.refreshed ? '（已刷新绑定引用）' : ''}`,
      );
      console.log(
        `locator ${result.locator.matchedCanonicalLocator}（${result.locator.remoteName}）`,
      );
      if (!result.applied) {
        console.log('将写入：');
        for (const item of result.wouldWrite) console.log(`  ${item.path}（${item.action}）`);
      }
      for (const warning of result.warnings) console.log(`提示：${warning}`);
      console.log(result.nextAction);
    });
  });

  withIO(
    workspaceCommand
      .command('status')
      .description('本机只读诊断；--online 才做只读服务端比对')
      .option('--root <dir>', '工作区根目录（默认 --dir 或 cwd）')
      .option('--online', '在只读前提下比对平台当前已发布定义', false),
  ).action(async (raw: Options, command: Command) => {
    const io = optionsOf(command);
    const result: WorkspaceStatusReport = await runWorkspaceStatus({
      root: workspaceRootOf(io, raw),
      configHome: configHome(str(io, 'config-home')),
      online: flag(raw, 'online'),
      api: str(io, 'api'),
    });
    emitLocal(command, result, () => {
      console.log(`工作区状态：${result.state}  freshness ${result.freshness}`);
      console.log(`业务工作目录：${resolve(workspaceRootOf(io, raw))}`);
      if (result.roleKey) console.log(`角色：${result.roleKey}`);
      if (result.projectId) console.log(`项目：${result.projectId}`);
      if (result.platform)
        console.log(`平台：${result.platform.origin}${result.platform.apiBasePath}`);
      if (result.definition)
        console.log(
          `定义 revision：${result.definition.revisionId}（digest ${result.definition.digest}）`,
        );
      for (const backup of result.backups) console.log(`v1 备份（不读取）：${backup}`);
      if (result.v1Migration) console.log(`v1 迁移：${result.v1Migration.command}`);
      for (const repository of result.repositories) {
        const detail = repository.isGitRepository
          ? `${repository.checkoutKind ?? ''} ${repository.branch ?? 'detached'} ${repository.head?.slice(0, 12) ?? ''} ${repository.dirty ? 'dirty' : 'clean'}`
          : repository.exists
            ? '非 Git 目录'
            : '路径缺失';
        console.log(
          `${repository.key}  ${repository.path}  ${repository.identityStatus}${repository.reasonCode ? `/${repository.reasonCode}` : ''}  ${detail}`.trim(),
        );
      }
      if (result.online) {
        console.log(
          `online 比对：${result.online.status} 当前 revision ${result.online.currentRevisionId ?? 'NOT_CONFIGURED'}`,
        );
      } else {
        console.log('未执行 online 比对：本输出不宣称服务端在线状态，也不代表 provider 已核验。');
      }
      console.log(result.nextAction);
    });
  });

  withIO(
    workspaceCommand
      .command('migrate')
      .description(
        'v1 → v2 迁移：dry-run / --apply / --inspect / --resolve keep-v2（只归档，不删除）',
      )
      .option('--root <dir>', '工作区根目录（默认 --dir 或 cwd）')
      .option('--dry-run', '列出迁移映射与备份位置（零写入）', false)
      .option('--apply', '备份 v1、原子写 v2、更新用户索引', false)
      .option('--inspect', '只读诊断双配置/journal/摘要（零写入零删除）', false)
      .option('--resolve <mode>', 'keep-v2（显式修复）或 keep-v1（仅指引，不删除）'),
  ).action(async (raw: Options, command: Command) => {
    const io = optionsOf(command);
    const root = workspaceRootOf(io, raw);
    const configHomeValue = configHome(str(io, 'config-home'));
    const resolveMode = str(raw, 'resolve');
    const selected = [
      flag(raw, 'dry-run') ? 'dry-run' : null,
      flag(raw, 'apply') ? 'apply' : null,
      flag(raw, 'inspect') ? 'inspect' : null,
      resolveMode ? 'resolve' : null,
    ].filter((item): item is string => item !== null);
    if (selected.length > 1)
      throw new CliError('VALIDATION_FAILED', '--dry-run/--apply/--inspect/--resolve 只能选一个');
    const mode = selected[0] ?? 'dry-run';
    if (resolveMode && resolveMode !== 'keep-v2' && resolveMode !== 'keep-v1')
      throw new CliError('VALIDATION_FAILED', '--resolve 只能是 keep-v2 或 keep-v1');

    if (mode === 'dry-run') {
      const result = await runMigrationDryRun({ root, configHome: configHomeValue });
      emitLocal(command, result, () => {
        console.log(
          result.alreadyMigrated
            ? `状态 ${result.state}：已迁移，无需写入。`
            : `v1 → v2 迁移计划（状态 ${result.state}，dry-run 零写入）`,
        );
        if (result.plan) {
          console.log(`项目 ${result.plan.projectId}`);
          console.log(`平台 ${result.plan.platform.origin}${result.plan.platform.apiBasePath}`);
          console.log(
            `布局 ${result.plan.layoutKind}  仓库映射 ${result.plan.repositories.length} 条`,
          );
          for (const repository of result.plan.repositories)
            console.log(
              `  ${repository.key} ${repository.projectRepositoryId} path ${repository.path}`,
            );
          console.log(`备份 ${result.backupFile}`);
        }
        for (const item of result.wouldWrite) console.log(`将写入 ${item.path}（${item.action}）`);
        console.log(result.nextAction);
      });
      return;
    }
    if (mode === 'apply') {
      const result = await runMigrationApply({ root, configHome: configHomeValue });
      emitLocal(command, result, () => {
        console.log(
          result.alreadyMigrated
            ? `状态 ${result.state}：已迁移，本次零写入。`
            : `迁移完成：${result.state}（journal ${result.journalPhase}）`,
        );
        if (result.backupFile)
          console.log(
            `v1 备份（不读取）：.workmesh/${result.backupFile.replace(/^\.workmesh\//, '')}`,
          );
        for (const item of result.writes) console.log(`${item.action} ${item.path}`);
        console.log(result.nextAction);
      });
      return;
    }
    if (mode === 'inspect') {
      const result = await runMigrationInspect({ root });
      emitLocal(command, result, () => {
        console.log(`状态 ${result.state}（只读诊断，零写入）`);
        for (const file of [result.files.v1, result.files.v2])
          console.log(
            `${file.label} exists=${file.exists} valid=${file.valid} digest=${file.digest ?? '(none)'}`,
          );
        for (const backup of result.backups) console.log(`v1 备份：${backup}`);
        console.log(
          `journal ${result.journal.phase ?? '(none)'}  项目一致=${String(result.consistency.projectIdsMatch)}  平台一致=${String(result.consistency.platformsMatch)}`,
        );
        console.log(result.nextAction);
      });
      return;
    }
    const result = await runMigrationResolve({
      root,
      configHome: configHomeValue,
      mode: resolveMode === 'keep-v1' ? 'keep-v1' : 'keep-v2',
    });
    emitLocal(command, result, () => {
      console.log(`resolve ${result.resolution} → ${result.state}`);
      for (const item of result.writes) console.log(`${item.action} ${item.path}`);
      if (result.archivedV1To) console.log(`v1 已归档（不读取）：${result.archivedV1To}`);
      console.log(result.nextAction);
    });
  });

  return program;
}

function argvHasJson(argv: string[]): boolean {
  return argv.includes('--json');
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(['node', 'workmesh', ...argv]);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === 'commander.helpDisplayed' ||
        error.code === 'commander.version' ||
        error.code === 'commander.help'
      )
        return 0;
      const failure = new CliError('USAGE', error.message, { exitCode: 2 });
      report(failure, argvHasJson(argv));
      return failure.exitCode;
    }
    const failure = asCliError(error);
    report(failure, argvHasJson(argv));
    return failure.exitCode;
  }
}

function report(error: CliError, json: boolean): void {
  const requestId = error.requestId ?? randomUUID();
  if (json) {
    console.log(JSON.stringify(errorEnvelopeOf(error, requestId)));
  }
  process.stderr.write(`错误 ${error.code}：${error.message}\n`);
  if (typeof error.details?.operationId === 'string') {
    process.stderr.write(`操作编号 ${error.details.operationId}\n`);
    if (error.details.operationOutcome === 'UNKNOWN')
      process.stderr.write('提交结果尚未确认；请先核对本次操作，再决定是否使用原操作编号重试。\n');
    if (error.details.operationOutcome === 'REJECTED')
      process.stderr.write('服务端已拒绝本次请求；请根据拒绝原因修正后再操作。\n');
    if (error.details.recoveryAction === 'RECONCILE') {
      const args = error.details.recoveryCommand;
      if (Array.isArray(args) && args.every((arg) => typeof arg === 'string')) {
        const quote = (value: string) =>
          /^[A-Za-z0-9_./:=\\-]+$/.test(value)
            ? value
            : process.platform === 'win32'
              ? `'${value.replace(/'/g, "''")}'`
              : `'${value.replace(/'/g, "'\"'\"'")}'`;
        process.stderr.write(
          `核对命令${process.platform === 'win32' ? '（PowerShell）' : ''}：workmesh ${args.map(quote).join(' ')}\n`,
        );
      } else {
        process.stderr.write(
          `核对：workmesh receipt reconcile --operation ${error.details.operationId}\n`,
        );
      }
    }
  }
  if (!json && error.code === 'PREFLIGHT_FAILED' && error.details?.doctor)
    for (const line of renderDoctor(error.details.doctor as Awaited<ReturnType<typeof runDoctor>>))
      process.stderr.write(`${line}\n`);
  if (!json && error.code === 'WORKSPACE_RECOVERY_BLOCKED' && error.details?.recovery)
    renderWorkspaceRecovery(error.details.recovery as WorkspaceRecoverReport);
  if (error.requestId) process.stderr.write(`requestId ${error.requestId}\n`);
  if (
    error.code === 'AUTH_REQUIRED' ||
    error.code === 'AUTH_INVALID' ||
    error.code === 'CREDENTIAL_REVOKED'
  )
    process.stderr.write('下一步：workmesh auth login --credential-store file\n');
  if (error.code === 'CONFIG_NOT_FOUND')
    process.stderr.write(
      '下一步：从项目工作区页面复制 workspace init --join 接入命令（默认预览，--apply 才授权并写入）；已有绑定使用 auth login。\n',
    );
  if (error.code === 'WORKSPACE_DUAL_CONFIG')
    process.stderr.write(
      '下一步：workmesh workspace migrate --inspect；满足 v2 校验 + journal 条件后运行 workmesh workspace migrate --resolve keep-v2（不会自动删除活动配置）\n',
    );
  if (error.code === 'WORKSPACE_V1_MIGRATION_REQUIRED')
    process.stderr.write('下一步：workmesh workspace migrate --dry-run，再运行 --apply\n');
  if (error.code === 'WORKSPACE_NOT_CONFIGURED')
    process.stderr.write(
      '下一步：workmesh workspace init --join <code> --root <dir> --api <base> --role <role>\n',
    );
  if (error.code === 'WORKSPACE_OFFLINE_UNVERIFIED')
    process.stderr.write('下一步：联网执行 workmesh workspace bind，或先在线刷新定义缓存\n');
  if (error.code === 'WORKSPACE_ALREADY_BOUND')
    process.stderr.write('下一步：workmesh workspace status；已有绑定无需重新消费接入码。\n');
  if (error.code === 'WORKSPACE_INIT_IN_PROGRESS')
    process.stderr.write(
      '下一步：workmesh workspace recover（只读检查，不删除活动锁、不重复消费接入码）。\n',
    );
}

export { buildProgram, readOption };

const invokedDirectly = process.argv[1] !== undefined && /index\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
