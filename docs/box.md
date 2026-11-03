# 一个盒子（workmesh-box）

`workmesh-box` 是三平台共用的管理命令：同一份 Node 实现，平台差异只放在 `packages/box/src/adapters/`。
目标是把“装完就能跑”的路径收成一条命令，而不是先读三份部署文档。

## 命令

| 命令                                      | 作用                                                                    | 有副作用       |
| ----------------------------------------- | ----------------------------------------------------------------------- | -------------- |
| `workmesh-box status`                     | 版本、平台、目录、数据库、端口、PG 客户端、备份与检查项                 | 只创建数据目录 |
| `workmesh-box doctor`                     | 只体检；关键检查（数据库 / PG 客户端 / 数据目录）失败退出码 1           | 无             |
| `workmesh-box dev`                        | 本机开发：PG 可达 → API → Web；已在监听的一律跳过，可反复执行           | 启动缺失的进程 |
| `workmesh-box dev --check`                | 只报告，不启动                                                          | 无             |
| `workmesh-box backup`                     | 备份数据库到 `<data-dir>/backups/<时间>/`（`db.sql` + `manifest.json`） | 写备份文件     |
| `workmesh-box restore --from <dir> --yes` | 把备份恢复到**新数据库**（默认 `workmesh_restore_<时间>`），不动现有库  | 建库 + 写数据  |

```powershell
pnpm box status
pnpm box dev
pnpm box backup
pnpm box restore --from C:\Users\me\AppData\Local\workmesh\backups\20261103-100932 --yes
```

`--json` 对每个命令都可用；`--data-dir`、`--install-root`、`--database-url`、`--api-port`、`--web-port` 可覆盖默认值。

## 目录与平台

| 平台    | 数据目录                                 | 安装目录                 | 服务管理 | 验证状态                                                             |
| ------- | ---------------------------------------- | ------------------------ | -------- | -------------------------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\workmesh`                | `%ProgramData%\WorkMesh` | WinSW    | **已在本机实测**（status / doctor / dev --check / backup / restore） |
| Linux   | `/var/lib/workmesh`                      | `/opt/workmesh`          | systemd  | 适配器已实现，未在 Linux 上跑验收                                    |
| macOS   | `~/Library/Application Support/workmesh` | `/usr/local/workmesh`    | launchd  | 适配器已实现，未在 macOS 上跑验收                                    |

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

- 安装包（自带 Node + PostgreSQL 二进制）与 `install` 命令：目前 `dev` 从仓库启动，`service()` 只生成命令、不执行。
- `/download` 页与 CLI 分发。
- Linux / macOS 的验收脚本运行记录（跑了之后才能把 `verified` 改成 true）。
