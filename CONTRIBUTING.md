# 参与 WorkMesh

WorkMesh 欢迎缺陷报告、文档修订和代码贡献。项目仍处于早期阶段；仓库中的规划、单元测试通过和真实部署验证是不同层次的证据，提交时请分别说明。

## 开发环境

- 使用 Node.js 20.19 或更新的兼容版本；CI 当前使用 20.19。
- 使用根目录 `packageManager` 声明的 pnpm 10.28.2。
- API 使用 PostgreSQL；本地启动见 [本地开发](docs/local-dev.md)，配置见 [部署说明](docs/deployment.md)。
- 不要提交 `.env`、访问凭据、个人数据或数据库备份。

```bash
pnpm install --frozen-lockfile
pnpm --filter @workmesh/shared build
pnpm --filter @workmesh/api exec prisma generate --schema prisma/schema.prisma
```

数据库验证必须使用显式选择的测试数据库。阅读 [阻塞项](BLOCKED.md) 后再运行涉及数据库的检查，避免将迁移、清理或恢复命令指向工作数据库。

## 提交变更

1. 缺陷报告提供版本或 commit、运行平台、复现步骤、预期与实际行为。安全问题按 [安全政策](SECURITY.md) 处理。
2. 大范围协议或架构调整先在 issue 中描述动机、兼容性和迁移影响。小修复可以直接提交 PR。
3. 每个 PR 聚焦一个问题。修改行为时补充能复现问题的回归测试；只调整格式或文案通常不需要新增测试。
4. 使用 Conventional Commits，例如 `fix(api): resume pending webhook deliveries`、`docs: clarify local setup`。
5. PR 说明问题、最终行为、验证命令和结果，以及尚未验证的边界。修改数据库 schema 时提交对应迁移；修改共享协议时同步消费者和契约样例。

## 验证

先运行受影响包的针对性检查，再运行以下公共门禁：

```bash
pnpm format:check
pnpm lint:eslint
pnpm type-check
pnpm test
pnpm test:contracts
pnpm --filter @workmesh/api test:coverage
pnpm build
```

`test:coverage` 使用 API 配置中的 80% 行覆盖率门槛。测试全部通过并不代表覆盖率达标；报告失败时保留原始结果，不通过删除被测文件或降低门槛掩盖缺口。

CI 还执行迁移漂移、API 集成和 Chromium 浏览器检查，定义在 [ci.yml](.github/workflows/ci.yml)。CLI 测试脚本使用单 worker，避免 Windows ACL 外部命令在并行负载下超时；成功的系统主体查询在同一 CLI 进程中复用，失败仍可重试。

浏览器测试先安装 `pnpm exec playwright install chromium --only-shell`，再配置与 API 集成测试相同的隔离数据库环境，运行 `pnpm test:browser`。`test:e2e` 当前运行 HTTP/数据库套件，真实浏览器入口是 `test:browser`，两者证据不能混用。发布与兼容性检查见 [发布验收](docs/releasing.md)。

## 评审与维护

合并由具有仓库写权限的维护者决定。贡献者不因提交 PR 自动获得发布或安全响应权限。当前尚未建立固定响应 SLA、长期支持分支或多人维护承诺；需要这些保证的使用者应先与维护者确认。

生成文件应通过其生成脚本更新，例如 `pnpm --filter @workmesh/role-packages generate`。不要手工编辑角色包生成的 manifest 和 `src/generated.ts`。

参与讨论和评审请遵守 [行为准则](CODE_OF_CONDUCT.md)。
