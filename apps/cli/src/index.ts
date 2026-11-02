#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
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
  loadWorkspace,
  resolvePlatform,
  type WorkspaceConfig,
} from './config';
import { CliError, asCliError, errorEnvelopeOf } from './errors';
import { materializeSnapshot, createSnapshot, fetchSnapshot } from './context';
import { buildCandidate, parseCandidateJson, type CandidateKind } from './candidate';
import { buildDeliver } from './deliver';
import { installRolePackage } from './roles';
import {
  beginOperation,
  finishOperation,
  readReceipt,
  requestDigestOf,
  scopeKeyOf,
  assertReusable,
  type SourceFile,
} from './receipts';

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
    .option('--dir <dir>', 'workspace directory (defaults to cwd)')
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

function workspaceDirOf(options: Options): string {
  return resolve(str(options, 'dir') ?? process.cwd());
}

async function connect(command: Command): Promise<Connection> {
  const options = optionsOf(command);
  const workspaceDir = workspaceDirOf(options);
  const workspace = await loadWorkspace(workspaceDir);
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
};

/** 写请求前先落 PENDING receipt；同 --operation 只在摘要完全一致时复用。 */
async function writeWithReceipt(
  connection: Connection,
  command: Command,
  input: WriteInput,
): Promise<{ data: unknown; requestId: string; operationId: string }> {
  const operationId = operationIdOf(input.operation);
  const digest = await requestDigestOf(input.method, input.route, input.body);
  let reused = false;
  try {
    const receipt = await readReceipt(connection.workspaceDir, operationId);
    assertReusable(receipt, {
      scopeKey: connection.scopeKey,
      credentialId: connection.credentialId,
      requestDigest: digest,
    });
    reused = true;
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'RESOURCE_NOT_FOUND') throw error;
  }
  if (!reused) {
    await beginOperation({
      workspaceDir: connection.workspaceDir,
      operationId,
      scopeKey: connection.scopeKey,
      credentialId: connection.credentialId,
      method: input.method,
      relativeRoute: input.route,
      requestDigest: digest,
      sourceFiles: input.sourceFiles ?? [],
    });
  }
  try {
    const response = await connection.client.request<unknown>(input.method, input.route, {
      body: input.body,
      idempotencyKey: operationId,
    });
    const resultRefs = input.resultRefs ? input.resultRefs(response.data) : {};
    await finishOperation(connection.workspaceDir, operationId, 'COMMITTED', resultRefs);
    return { data: response.data, requestId: response.requestId, operationId };
  } catch (error) {
    const failure = asCliError(error);
    if (failure.status !== undefined && failure.status >= 400 && failure.status < 500) {
      if (failure.status !== 408 && failure.status !== 429)
        await finishOperation(connection.workspaceDir, operationId, 'REJECTED', {});
    }
    throw failure;
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

async function confirmFileStore(): Promise<void> {
  if (!stdin.isTTY)
    throw new CliError(
      'APPROVAL_REQUIRED',
      '非交互环境必须显式传 --credential-store file，明确同意使用仅当前用户可读的本地文件存储',
    );
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(
      '凭据将写入当前用户 home 下的 0600 文件（非系统钥匙串），不宣称对同一 OS 用户加密隔离。输入 yes 继续：',
    );
    if (answer.trim().toLowerCase() !== 'yes')
      throw new CliError('APPROVAL_REQUIRED', '未同意本地文件存储，已取消登录');
  } finally {
    prompt.close();
  }
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
  const workspace = await loadWorkspace(workspaceDir);
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
    .description(DESCRIPTION)
    .version(CLI_VERSION)
    .exitOverride();

  program.action(() => {
    console.log('WorkMesh 连接本地 AI 与项目协作事实，不替你自动批准。');
    console.log(
      '1. workmesh roles install --package <dir> --project <uuid> --host <codex|claude-code> --api <base>',
    );
    console.log('2. workmesh auth login --credential-store file');
    console.log('3. workmesh claim --task <uuid> --json');
    console.log(
      '4. workmesh context --task <uuid> --claim <uuid> --expected-version <n> --materialize --json',
    );
    console.log('按角色 SOP 本地生产；交付后用 review 请求 Web 人工确认。');
    console.log('修改角色、项目或平台需匹配的新授权；不要上传聊天、个人记忆或凭据。');
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
        workspace = await loadWorkspace(workspaceDirOf(io));
        platform = resolvePlatform(workspace, str(io, 'api'));
      } catch (error) {
        const api = str(io, 'api');
        if (api) platform = resolvePlatform(undefined, api);
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
      .command('claim')
      .description('认领任务；返回 claimId 与新 task version')
      .requiredOption('--task <id>', 'task UUID')
      .option('--operation <uuid>', 'reuse an existing Idempotency-Key for retry'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const taskId = assertUuid(str(raw, 'task'), '--task');
    const route = `/tasks/${encodeURIComponent(taskId)}/claims`;
    const written = await writeWithReceipt(connection, command, {
      method: 'POST',
      route,
      body: {},
      operation: str(raw, 'operation'),
      resultRefs: (data) => {
        const record = asRecord(data, '认领响应结构非法');
        const task = asRecord(record.task, '认领响应 task 非法');
        return {
          taskId,
          claimId: typeof record.claimId === 'string' ? record.claimId : null,
          taskVersion: typeof task.version === 'number' ? task.version : null,
        };
      },
    });
    const record = asRecord(written.data, '认领响应结构非法');
    const task = asRecord(record.task, '认领响应 task 非法');
    const claimId = typeof record.claimId === 'string' ? record.claimId : '';
    const taskVersion = typeof task.version === 'number' ? task.version : null;
    emit(
      command,
      {
        taskId,
        claimId,
        taskVersion,
        replayed: record.replayed === true,
        operationId: written.operationId,
      },
      written.requestId,
      () => {
        console.log(
          `已认领 ${taskId} → claim ${claimId}${taskVersion !== null ? `（task v${taskVersion}）` : ''}。`,
        );
        console.log(
          `下一步：workmesh context --task ${taskId} --claim ${claimId} --expected-version ${taskVersion ?? 1} --materialize`,
        );
      },
    );
  });

  withIO(
    program
      .command('context')
      .description('创建或读取准确上下文快照；--materialize 校验 bytes 后原子落盘')
      .option('--task <id>', 'task UUID (creates a new snapshot)')
      .option('--claim <id>', 'claim UUID required with --task')
      .option('--expected-version <n>', 'task version required with --task')
      .option('--snapshot <id>', 'existing snapshot UUID (does not create)')
      .option('--candidate <id...>', 'optional candidate revision UUIDs for snapshot creation')
      .option('--materialize', 'download and atomically publish verified bytes', false)
      .option('--operation <uuid>', 'reuse an existing Idempotency-Key for retry'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const snapshotOption = str(raw, 'snapshot');
    const taskOption = str(raw, 'task');
    if (!snapshotOption && !taskOption)
      throw new CliError('INVALID_REQUEST', '需要 --task（创建快照）或 --snapshot（读取既有快照）');
    if (snapshotOption && taskOption)
      throw new CliError('INVALID_REQUEST', '--task 与 --snapshot 不能同时使用');
    let snapshotId: string;
    let taskVersion: number | null = null;
    let requestId: string;
    if (snapshotOption) {
      const snapshot = await fetchSnapshot(
        connection.client,
        assertUuid(snapshotOption, '--snapshot'),
      );
      snapshotId = snapshot.id;
      requestId = randomUUID();
    } else {
      const taskId = assertUuid(taskOption, '--task');
      const claimId = assertUuid(str(raw, 'claim'), '--claim');
      const expectedVersion = positiveVersion(raw, 'expected-version');
      const candidates = listOf(raw, 'candidate');
      for (const candidate of candidates) assertUuid(candidate, '--candidate');
      const operationId = operationIdOf(str(raw, 'operation'));
      const route = `/tasks/${encodeURIComponent(taskId)}/context-snapshots`;
      const body = {
        expectedVersion,
        claimId,
        ...(candidates.length ? { candidateRevisionIds: candidates } : {}),
      };
      const digest = await requestDigestOf('POST', route, body);
      await beginOperation({
        workspaceDir: connection.workspaceDir,
        operationId,
        scopeKey: connection.scopeKey,
        credentialId: connection.credentialId,
        method: 'POST',
        relativeRoute: route,
        requestDigest: digest,
        sourceFiles: [],
      });
      const created = await createSnapshot(
        connection.client,
        taskId,
        {
          claimId,
          expectedVersion,
          candidateRevisionIds: candidates.length ? candidates : undefined,
        },
        operationId,
      );
      snapshotId = created.snapshot.id;
      taskVersion = created.taskVersion;
      requestId = created.requestId;
      await finishOperation(connection.workspaceDir, operationId, 'COMMITTED', {
        snapshotId,
        taskVersion,
      });
    }
    const view = await fetchSnapshot(connection.client, snapshotId);
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
        manifestDigest: view.manifestDigest,
        taskVersion,
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
      .requiredOption('--task <id>', 'task UUID')
      .requiredOption('--claim <id>', 'current claim UUID')
      .requiredOption('--snapshot <id>', 'context snapshot UUID')
      .requiredOption('--expected-version <n>', 'task version expected by this write')
      .requiredOption('--manifest <file>', 'deliver manifest JSON')
      .option('--operation <uuid>', 'reuse an existing Idempotency-Key for retry'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const taskId = assertUuid(str(raw, 'task'), '--task');
    const claimId = assertUuid(str(raw, 'claim'), '--claim');
    const snapshotId = assertUuid(str(raw, 'snapshot'), '--snapshot');
    const expectedVersion = positiveVersion(raw, 'expected-version');
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
      operation: str(raw, 'operation'),
      resultRefs: (data) => {
        const record = asRecord(data, '交付响应结构非法');
        const task = record.task ? asRecord(record.task, '交付响应 task 非法') : undefined;
        const artifactSet = record.artifactSet
          ? asRecord(record.artifactSet, '交付响应 artifactSet 非法')
          : undefined;
        return {
          taskId,
          artifactSetId: typeof artifactSet?.id === 'string' ? artifactSet.id : null,
          taskVersion: typeof task?.version === 'number' ? task.version : null,
        };
      },
    });
    const record = asRecord(written.data, '交付响应结构非法');
    const task = record.task ? asRecord(record.task, '交付响应 task 非法') : undefined;
    const artifactSet = record.artifactSet
      ? asRecord(record.artifactSet, '交付响应 artifactSet 非法')
      : undefined;
    const artifactSetId = typeof artifactSet?.id === 'string' ? artifactSet.id : null;
    const taskVersion = typeof task?.version === 'number' ? task.version : null;
    emit(
      command,
      {
        taskId,
        artifactSetId,
        taskStatus: task?.executionStatus ?? null,
        taskVersion,
        replayed: record.replayed === true,
        operationId: written.operationId,
      },
      written.requestId,
      () => {
        console.log(`已交付 ArtifactSet${artifactSetId ? ` ${artifactSetId}` : ''}。`);
        console.log(
          `任务 ${taskId}${taskVersion !== null ? ` v${taskVersion}` : ''} 停在评审；人工确认前不会 DONE。`,
        );
        console.log('后续：workmesh review --task <id> --artifact-set <id> --expected-version <n>');
      },
    );
  });

  withIO(
    program
      .command('review')
      .description('创建人工评审请求（只请求，不批准）')
      .option('--task <id>', 'task UUID to associate')
      .option('--artifact-set <id>', 'TASK_ARTIFACT_SET subject UUID')
      .option('--document-revision <id>', 'DOCUMENT_REVISION subject UUID')
      .requiredOption('--expected-version <n>', 'subject version expected by this request')
      .option('--operation <uuid>', 'reuse an existing Idempotency-Key for retry'),
  ).action(async (raw: Options, command: Command) => {
    const connection = await connect(command);
    const artifactSet = str(raw, 'artifact-set');
    const revision = str(raw, 'document-revision');
    if (!artifactSet !== !revision)
      throw new CliError('INVALID_REQUEST', '必须且只能提供 --artifact-set 或 --document-revision');
    const expectedVersion = positiveVersion(raw, 'expected-version');
    const taskId = str(raw, 'task');
    const body = {
      subject: artifactSet
        ? { kind: 'TASK_ARTIFACT_SET', id: assertUuid(artifactSet, '--artifact-set') }
        : { kind: 'DOCUMENT_REVISION', id: assertUuid(revision, '--document-revision') },
      expectedVersion,
      ...(taskId ? { taskId: assertUuid(taskId, '--task') } : {}),
    };
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
    const webUrl = `${connection.workspace.platform.origin}/projects/${connection.workspace.projectId}/reviews/${reviewId}`;
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

  const receipt = program.command('receipt').description('本地操作 receipt（不含请求/响应正文）');

  withIO(
    receipt
      .command('show')
      .description('显示本地 receipt 的安全元数据')
      .requiredOption('--operation <uuid>', 'operation UUID'),
  ).action(async (raw: Options, command: Command) => {
    const record = await readReceipt(
      workspaceDirOf(optionsOf(command)),
      operationIdOf(str(raw, 'operation')),
    );
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
    const local = await readReceipt(connection.workspaceDir, operationId);
    const response = await connection.client.request<unknown>(
      'GET',
      `/operation-receipts/${encodeURIComponent(operationId)}`,
      { query: { projectId: connection.workspace.projectId } },
    );
    const server = asRecord(response.data, '服务端 receipt 结构非法');
    if (server.status !== 'COMMITTED')
      throw new CliError('PROTOCOL_INVALID', `服务端 receipt 状态非法：${String(server.status)}`);
    const refs = server.resultRefs;
    if (refs !== undefined && (typeof refs !== 'object' || refs === null || Array.isArray(refs)))
      throw new CliError('PROTOCOL_INVALID', '服务端 resultRefs 非法');
    const resultRefs: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries((refs ?? {}) as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number' || value === null)
        resultRefs[key] = value;
      else throw new CliError('PROTOCOL_INVALID', `服务端 resultRefs.${key} 非法`);
    }
    const updated = await finishOperation(
      connection.workspaceDir,
      operationId,
      'COMMITTED',
      resultRefs,
    );
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
      }
      if (nextCursor) console.log(`下一页：--cursor ${nextCursor}`);
      console.log('ack 需在 Web 或具备 change:ack 的界面逐槽确认；CLI 不代其他角色确认。');
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
  if (error.requestId) process.stderr.write(`requestId ${error.requestId}\n`);
  if (
    error.code === 'AUTH_REQUIRED' ||
    error.code === 'AUTH_INVALID' ||
    error.code === 'CREDENTIAL_REVOKED'
  )
    process.stderr.write('下一步：workmesh auth login --credential-store file\n');
  if (error.code === 'CONFIG_NOT_FOUND')
    process.stderr.write(
      '下一步：workmesh roles install --package <dir> --project <uuid> --host <codex|claude-code> --api <base>\n',
    );
}

export { buildProgram };

const invokedDirectly = process.argv[1] !== undefined && /index\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
