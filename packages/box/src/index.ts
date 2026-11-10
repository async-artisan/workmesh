import { parseArgs } from 'node:util';
import { buildContext } from './context';
import { runBackup } from './commands/backup';
import { runDev } from './commands/dev';
import { runDoctor } from './commands/doctor';
import { runRestore } from './commands/restore';
import { collectStatus, renderStatus } from './commands/status';
import { BOX_VERSION } from './version';

const HELP = `workmesh-box ${BOX_VERSION} — 一个盒子的管理命令（Windows / Linux / macOS）

用法：
  workmesh-box <command> [options]

命令：
  status                     显示版本、平台、目录、数据库、端口、备份与检查项
  doctor                     只体检不启动；关键检查失败时退出码 1
  dev                        本机开发：确保 PG 可达 → 起 API → 起 Web（已运行则跳过）
  backup                     备份数据库到 <data-dir>/backups/<时间>/（SQL dump + manifest）
  backup --verify            备份后立刻恢复到临时库核对表数量/迁移数，再删掉临时库
  restore --from <dir> --yes 把备份恢复到一个新数据库（不动现有库）

选项：
  --json                     机器可读输出
  --data-dir <dir>           覆盖数据目录
  --install-root <dir>       覆盖安装目录
  --database-url <url>       覆盖 WORKMESH_V1_DATABASE_URL
  --api-port <n>             API 端口（默认 3000 或 PORT）
  --web-port <n>             Web 端口（默认 5173）
  --from <dir>               备份目录（restore）
  --database <name>          恢复目标库名（restore，默认 workmesh_restore_<时间>）
  --yes                      确认执行有副作用的恢复
  --verify                   备份后验证可恢复性（backup；会建一个临时库再删掉）
  --check                    只报告，不启动（dev）
  -h, --help                 显示本帮助

环境变量：
  WORKMESH_V1_DATABASE_URL   数据库连接串（缺省读 apps/api/.env）
  WORKMESH_DATA_DIR          数据目录
  WORKMESH_HOME              安装目录
  WORKMESH_PG_BIN            PostgreSQL 客户端目录（含 pg_dump/psql）

平台验证：Windows 已在本机实测；Linux / macOS 适配器已实现，但尚未在对应系统跑过验收。
`;

function numberOption(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`端口必须是正整数：${value}`);
  return parsed;
}

async function main(): Promise<number> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      'data-dir': { type: 'string' },
      'install-root': { type: 'string' },
      'database-url': { type: 'string' },
      'api-port': { type: 'string' },
      'web-port': { type: 'string' },
      from: { type: 'string' },
      database: { type: 'string' },
      yes: { type: 'boolean', default: false },
      verify: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const values = parsed.values;
  if (values.help || parsed.positionals.length === 0) {
    console.log(HELP);
    return 0;
  }

  const command = parsed.positionals[0];
  const json = Boolean(values.json);
  const ctx = buildContext({
    overrides: {
      dataDir: values['data-dir'],
      installRoot: values['install-root'],
      databaseUrl: values['database-url'],
      apiPort: values['api-port'] ? numberOption(values['api-port'], 3000) : undefined,
      webPort: values['web-port'] ? numberOption(values['web-port'], 5173) : undefined,
    },
  });

  if (command === 'status') {
    const report = await collectStatus(ctx);
    console.log(json ? JSON.stringify(report, null, 2) : renderStatus(report));
    return 0;
  }

  if (command === 'doctor') {
    const result = await runDoctor(ctx);
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(renderStatus(result.report));
      console.log(result.ok ? '\n体检通过。' : `\n体检失败：${result.failed.join('、')}`);
    }
    return result.ok ? 0 : 1;
  }

  if (command === 'dev') {
    const report = await runDev(ctx, { check: Boolean(values.check) });
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      for (const step of report.steps) {
        console.log(
          `${(step.ready ?? step.listening) ? 'ok ' : '!! '}${step.name} :${step.port} ${
            step.ready === false && step.listening
              ? '（监听中，未就绪）'
              : step.started
                ? '（本次启动）'
                : step.listening
                  ? '（已在运行）'
                  : '（未运行）'
          } — ${step.detail}`,
        );
      }
      console.log(`\nWeb: ${report.urls.web}\nAPI: ${report.urls.api}`);
      if (report.hint) console.log(`\n提示：${report.hint}`);
      console.log(`\n数据目录：${ctx.dataDir}（日志在 ${ctx.dataDir}/logs）`);
    }
    return report.ok ? 0 : 1;
  }

  if (command === 'backup') {
    const result = await runBackup(ctx, { verify: Boolean(values.verify) });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`备份完成：${result.dir}`);
      console.log(
        `数据库：${result.manifest.database.host}:${result.manifest.database.port}/${result.manifest.database.name}`,
      );
      console.log(
        `dump：${result.manifest.dumpBytes} 字节 · 迁移 ${result.manifest.migrationsApplied ?? '?'} 个 · 表 ${result.manifest.tables ?? '?'} 张`,
      );
      console.log(`sha256：${result.manifest.dumpSha256 ?? '（未计算）'}`);
      if (result.verification) {
        console.log(
          `结构恢复：已验证（${result.verification.verifiedAt}，恢复出 ${result.verification.tables} 张表；未检查业务数据）`,
        );
      } else {
        console.log('可恢复性：未验证——加 --verify 会真的恢复一次再删掉临时库');
      }
    }
    return 0;
  }

  if (command === 'restore') {
    if (!values.from) throw new Error('restore 需要 --from <备份目录>');
    const result = await runRestore(ctx, {
      from: values.from,
      database: values.database,
      yes: Boolean(values.yes),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`恢复完成：数据库 ${result.database}（${result.tables} 张表）`);
      console.log(`连接串：${result.maskedUrl}`);
      console.log('切换前请先确认该库可用，再把 WORKMESH_V1_DATABASE_URL 指向它。');
    }
    return 0;
  }

  console.error(`未知命令：${command}`);
  console.log(HELP);
  return 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((caught: unknown) => {
    console.error(`错误：${caught instanceof Error ? caught.message : String(caught)}`);
    process.exitCode = 1;
  });
