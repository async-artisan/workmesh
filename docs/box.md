# 一个盒子（workmesh-box）

`workmesh-box` 是三平台共用的管理命令：同一份 Node 实现，平台差异只放在 `packages/box/src/adapters/`。
目标是把“装完就能跑”的路径收成一条命令，而不是先读三份部署文档。

## 命令

| 命令                                      | 作用                                                                                | 有副作用       |
| ----------------------------------------- | ----------------------------------------------------------------------------------- | -------------- |
| `workmesh-box status`                     | 版本、平台、目录、数据库、端口、PG 客户端、备份与检查项                             | 只创建数据目录 |
| `workmesh-box doctor`                     | 只体检；关键检查（数据库 / PG 客户端 / 数据目录 / API 就绪 / 迁移一致）失败退出码 1 | 无             |
| `workmesh-box dev`                        | 本机开发：PG 可达 → API 就绪 → Web；已在监听的一律跳过，可反复执行                  | 启动缺失的进程 |
| `workmesh-box dev --check`                | 只报告，不启动                                                                      | 无             |
| `workmesh-box backup`                     | 备份数据库到 `<data-dir>/backups/<时间>/`（`db.sql` + `manifest.json`）             | 写备份文件     |
| `workmesh-box restore --from <dir> --yes` | 把备份恢复到**新数据库**（默认 `workmesh_restore_<时间>`），不动现有库              | 建库 + 写数据  |

```powershell
pnpm box status
pnpm box dev
pnpm box backup
pnpm box restore --from C:\Users\me\AppData\Local\workmesh\backups\20261103-100932 --yes
```

`--json` 对每个命令都可用；`--data-dir`、`--install-root`、`--database-url`、`--api-port`、`--web-port` 可覆盖默认值。

### 存活与就绪是两件事

`doctor` / `dev` 不再以 `/api/health` 判断「能用」——那个端点只证明进程还活着，数据库不可达或迁移没跑时它照样返回 200，是假绿的来源。

| 探针                    | 回答什么                                       | 失败时                                     |
| ----------------------- | ---------------------------------------------- | ------------------------------------------ |
| `GET /api/health`       | 进程是否活着（liveness，**故意不查数据库**）   | 重启进程；查库会让数据库抖动演变成连环重启 |
| `GET /api/health/ready` | 能否干活（readiness）：`SELECT 1` + 迁移已应用 | `503 DEPENDENCY_UNAVAILABLE`，不重启       |

`box doctor` 把 `api-ready` 列为关键检查（仅当 API 在跑时），并用 `migrations-in-sync` 比对「数据库已应用迁移数」与「仓库迁移目录数」——部署漏跑迁移会直接变红。`box dev` 等的是就绪而不是存活。

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
- **恢复是演练路径**：默认恢复到新库，验证表数量后由人决定是否把 `WORKMESH_V1_DATABASE_URL` 指过去。
- 业务代码里禁止出现 `process.platform` 分支：平台差异只能进 `adapters/`。

## 还没做（下一步）

- 通用 `workmesh-box install` 命令尚未实现；现有 Windows 安装由打包产物中的 `install.ps1` 执行，`workmesh-box dev` 仍从仓库启动，跨平台 `service()` 目前只生成命令、不执行。
- `/download` 页与 CLI 分发。
- Linux / macOS 的验收脚本运行记录（跑了之后才能把 `verified` 改成 true）。
