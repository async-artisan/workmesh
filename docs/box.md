# 一个盒子（workmesh-box）

`workmesh-box` 是三平台共用的管理命令：同一份 Node 实现，平台差异只放在 `packages/box/src/adapters/`。
目标是把“装完就能跑”的路径收成一条命令，而不是先读三份部署文档。

## 命令

| 命令                                      | 作用                                                                                          | 有副作用            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------- |
| `workmesh-box status`                     | 版本、平台、目录、数据库、端口、PG 客户端、备份与检查项                                       | 只创建数据目录      |
| `workmesh-box doctor`                     | 只体检；关键检查（数据库 / PG 客户端 / 数据目录 / API 就绪 / 迁移一致）失败退出码 1           | 无                  |
| `workmesh-box dev`                        | 本机开发：PG 端口可达 → API 就绪 → Web；复用已有进程仍检查 API 就绪，失败退出码 1             | 启动缺失的进程      |
| `workmesh-box dev --check`                | 只报告，不启动                                                                                | 无                  |
| `workmesh-box backup`                     | 备份到 `<data-dir>/backups/<时间>/`（`db.sql` + `manifest.json`，含 dump 的 sha256 与表数量） | 写备份文件          |
| `workmesh-box backup --verify`            | 同上，并立刻把 dump 恢复进临时库核对表数量/迁移数，核对完删掉临时库                           | 写备份 + 建删临时库 |
| `workmesh-box restore --from <dir> --yes` | 把备份恢复到**新数据库**（默认 `workmesh_restore_<时间>`），不动现有库                        | 建库 + 写数据       |

```powershell
pnpm box status
pnpm box dev
pnpm box backup
pnpm box restore --from C:\Users\me\AppData\Local\workmesh\backups\20261103-100932 --yes
```

`--json` 对每个命令都可用；`--data-dir`、`--install-root`、`--database-url`、`--api-port`、`--web-port` 可覆盖默认值。

### 存活与就绪是两件事

`doctor` / `dev` 不再以 `/api/health` 判断「能用」——那个端点只证明进程还活着，数据库不可达或迁移没跑时它照样返回 200，是假绿的来源。

| 探针                    | 回答什么                                            | 失败时                                     |
| ----------------------- | --------------------------------------------------- | ------------------------------------------ |
| `GET /api/health`       | 进程是否活着（liveness，**故意不查数据库**）        | 重启进程；查库会让数据库抖动演变成连环重启 |
| `GET /api/health/ready` | 数据库依赖是否就绪：`SELECT 1` + 至少一项迁移已应用 | `503 DEPENDENCY_UNAVAILABLE`，不重启       |

`box doctor` 把 `api-ready` 列为关键检查（仅当 API 在跑时），并在仓库形态下用 `migrations-in-sync` 比对「数据库已应用迁移数」与「仓库迁移目录数」。数量不一致会变红；数量一致不等于逐条迁移名称、校验和与完整 schema 漂移均已验证。API 未启动时，doctor 可以通过关键环境检查，此时 `evidence.serviceReady=false`，不能据此判断服务已运行。

`box dev` 与 Windows 包的 `start-workmesh.ps1` 都等待 `/api/health/ready`，并检查响应中数据库可达与迁移数量。已有端口监听但未就绪时返回失败，不向该端口再启动一个 API。Windows 启动脚本保留 `/api/health` 作为失败诊断；已有受管进程未就绪时保留进程并报告日志与数据库检查方向。

这些 HTTP 探测只访问 `127.0.0.1`。`status --json` 的 `evidence` 明确记录回环访问、当前就绪、备份结构验证范围，以及尚未检查的项目授权与业务发布。其他电脑的可达性、公共 API 地址、HTTPS/Cookie/Origin、用户登录和角色权限需要单独验收。这里沿用 [Kubernetes 的存活与就绪探针分工](https://kubernetes.io/docs/concepts/workloads/pods/probes/)：进程存活与依赖就绪提供不同证据。

### 备份的完成标准是「恢复得回来」

`backup` 生成 SQL dump、SHA-256 与清单。要拿实际恢复的证据，跑 `backup --verify`：它把刚写好的 dump 恢复进一个临时库，核对 `workmesh_v1` 表数量与已应用迁移数，结果写进 `manifest.json` 的 `verification`。过程结束会尝试删除临时库；若 PostgreSQL 或连接失效，仍应检查是否留下 `workmesh_backup_verify_*` 数据库。

这里的验证范围是 SQL 能恢复与结构计数匹配，没有逐行核验业务内容、附件/外部对象、登录与权限，也没有建立备份保留、异地副本、RPO/RTO 或生产切换演练。`status` 显示「结构恢复已验证」，不能替代这些验收。[PostgreSQL SQL dump 文档](https://www.postgresql.org/docs/16/backup-dump.html)说明了 SQL dump 与 `psql` 恢复路径；生产备份方案仍须覆盖项目的全部持久化依赖。

清单从 schema 1.1 起记录 `dumpSha256`、`tables` 与 `verification`。旧清单（1.0）仍可读，缺失字段一律归一为 `null`——没有验证过就不显示成已验证。

`restore` 的行为也跟着收紧：

- 清单里有 `dumpSha256` 时，**先校验字节再建库**；被篡改或损坏的备份不应恢复出半个库；
- 恢复中途失败会 `DROP` 掉刚建的半成品库，避免下次同名恢复只报「目标数据库已存在」还要人工清理。

`box status` / `box doctor` 会显示最近一次备份是否已验证；未验证只是一条提示（非关键），不会让 doctor 变红。

## 目录与平台

| 平台    | 数据目录                                 | 安装目录                 | 服务管理 | 验证状态                                                          |
| ------- | ---------------------------------------- | ------------------------ | -------- | ----------------------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\workmesh`                | `%ProgramData%\WorkMesh` | WinSW    | 包构建脚本与 `install.ps1` 已实现；隔离安装、运行和恢复有本机记录 |
| Linux   | `/var/lib/workmesh`                      | `/opt/workmesh`          | systemd  | 适配器已实现，未在 Linux 上跑验收                                 |
| macOS   | `~/Library/Application Support/workmesh` | `/usr/local/workmesh`    | launchd  | 适配器已实现，未在 macOS 上跑验收                                 |

数据目录内约定：

```text
backups/<时间>/db.sql         # pg_dump plain SQL
backups/<时间>/manifest.json  # 版本、时间、库定位、字节数、迁移数（不含密码）
logs/                         # dev 启动的进程日志
```

## 设计与约束

- **PG 客户端查找顺序**：`WORKMESH_PG_BIN` → 安装包 `pgsql/bin` → 数据目录 → 仓库 `.tmp/pgclient` → `PATH`。
- **dump 走 stdout 再由 Node 写文件**：某些受限环境里 `pg_dump --file` 没有目标目录写权限，而应用进程写自己的数据目录是稳定的。
- **连接串**：Prisma 的 `?schema=` 不是 libpq 参数，调用 `pg_dump`/`psql` 前会被去掉；展示与日志里密码一律 `***`。
- **恢复是演练路径**：默认恢复到新库，输出恢复后的表数量；普通 `restore` 不执行逐行比对，也不自动切换运行配置。确认数据库、迁移、业务数据与权限后，再决定是否把 `WORKMESH_V1_DATABASE_URL` 指过去。
- 业务代码里禁止出现 `process.platform` 分支：平台差异只能进 `adapters/`。

## 还没做（下一步）

- 通用 `workmesh-box install` 命令尚未实现；现有 Windows 安装由打包产物中的 `install.ps1` 执行，`workmesh-box dev` 仍从仓库启动，跨平台 `service()` 目前只生成命令、不执行。
- Windows 包构建已生成 `/download` 入口、Box/CLI ZIP 与 SHA-256；目前不等于已建立公共分发服务、自动更新或跨平台安装验收。
- Linux / macOS 的验收脚本运行记录（跑了之后才能把 `verified` 改成 true）。
