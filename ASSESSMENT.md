# WorkMesh 项目成熟度评估

> 评估日期：2026-11-03 · 基线：`main` 工作树（含未提交改动）
> 参照系：CNCF / Apache / 成熟 TypeScript monorepo 的通行开源标准
> 方法：全部结论取自仓库内实际证据（文件、命令输出、代码、git 历史），标注【事实】或【推测】

---

## 0. 一句话结论

**尚未达到「优秀开源项目」水平。** 它是一个**工程质量显著高于同龄项目的、单人 4 天内完成的 pre-release 代码库**，但**开源项目所需的治理外壳（贡献机制、版本发布、社区、合规文档）几乎完全不存在**，且**产品自身卖的「可验证证据」目前零真实验证**。

关键区分：作为**内部工程资产**约 7.5/10；作为**开源项目**约 3/10。

---

## 1. 决定性事实：项目年龄

| 项 | 值 | 证据 |
| --- | --- | --- |
| 首次提交 | **2026-10-31** | `git log --reverse` → `2ec2f66 chore: 初始化版本控制，记录重构前基线` |
| 最新提交 | 2026-11-03 | `git log -1 --date=short` |
| 仓库年龄 | **4 天** | 同上 |
| 提交数 | 91 | `git rev-list --count HEAD` |
| 触及文件 | 726 | `git log --name-only` |
| 贡献者 | **有效 1 人** | `1923983143@qq.com` 以 3 个不同 user.name 出现（45+29+7=81 次），另有 `reqflow@local`(5)、`async-artisan`(1) |

【事实】这个数字重新定义了整份评估：许多「缺失」不是失职，而是尚未发生。但同样地，任何「优秀开源项目」的判断都不能绕过它——**4 天、单人、零外部贡献者的项目，无论代码多好，都还没进入开源项目的评判域。**

---

## 2. 分维度评分卡

| 维度 | 评分 | 核心依据 |
| --- | --- | --- |
| 项目定位与价值 | **8.5** / 10 | 叙事极清晰、边界主动收窄、有电梯测试与口径字典；但零外部用户验证 |
| 架构设计 | **8** / 10 | 三层 + 契约包 + 集中授权，边界明确；但存在 2064 行巨型仓储文件 |
| 代码质量与可维护性 | **7** / 10 | 类型严格、策略集中、提交规范；死依赖、脏工作区、单人 76k 行 |
| 测试 | **7** / 10 | 99 个测试文件、实测 633 通过；E2E/GitHub live/HTTP 契约缺失，覆盖率门禁未接线 |
| 持续集成 | **8** / 10 | 含罕见的数据库漂移闸门；无 OS/Node 矩阵、无安全扫描、无 release |
| 文档完整性 | **4** / 10 | 内部记录极完备，对外文档全缺；≈80% 为计划文档，多处事实错误 |
| 安全性 | **7.5** / 10 | 设计近乎教科书级；运维侧（配置漂移、启动校验、依赖陈旧）有真实缺口 |
| 性能 | **5** / 10 | 有索引与游标分页，但零实测数据、bundle 未拆分、无基准 |
| 版本发布 | **2** / 10 | 零 git tag、零 CHANGELOG、零 release 流程、8 个包全部 private |
| 社区治理 | **1** / 10 | 零外部贡献者，无任何治理文档 |
| 贡献机制 | **1** / 10 | 无 CONTRIBUTING/Issue 模板/PR 模板/CoC |
| 长期维护 | **3** / 10 | 单人、4 天、76k 行；作者已自认 R7 风险 |

---

## 3. 规模与实测数据

### 3.1 代码规模【事实】

| 包 | 文件数 | 行数 |
| --- | --- | --- |
| `apps/api` | 198 | 48,230 |
| `apps/web` | 61 | 14,617 |
| `apps/cli` | 28 | 6,682 |
| `packages/shared` | 21 | 3,093 |
| `packages/role-packages` | 4 | 1,618 |
| `packages/box` | 21 | 1,500 |
| **合计** | **333** | **75,748** |

数据模型：`schema.prisma` 1198 行，48 个 model、17 个 enum、12 个迁移（0001–0012）、24 个 controller。

### 3.2 实测结果【事实 · 本次运行】

| 套件 | 结果 |
| --- | --- |
| `shared` | ✅ 58 passed / 9 files |
| `api` | ✅ **465 passed** / 54 files（1 个 EPERM 未捕获错误，沙箱环境产物） |
| `web` | ✅ 49 passed / 17 files |
| `cli` | ⚠️ 61 passed / **21 failed**（根因：沙箱拦截 `wmic.exe`，`whoami` 未返回 `DOMAIN\user`） |
| `pnpm build` | ✅ **6/6 任务成功**，18s |

> CLI 失败**大概率是环境产物**（安全策略拦截 `wmic.exe`），但它暴露了一个真实脆弱性：**测试依赖宿主机主体解析（`whoami` 返回格式）而非注入桩**，换机器即红。这本身是可测性缺陷。
> 【事实】工作区当前有 21 个已修改 + 6 个未跟踪文件未提交，测试结果反映的是 WIP 状态。

---

## 4. 主要优势（有证据支撑）

### A. 定位清晰度罕见地高【事实】
`docs/positioning.md`（约 300 行）是本次评估中最强的单点资产：

- 一句话定位内外双版本：「让 AI 干的活，有人签字、有据可查」/「The sign-off and evidence layer for teams shipping with local AI agents」
- **主动收窄边界**：明确列出「不是」什么（不做 Agent 执行、不做 AI 对话、不替代 GitHub、不做 SaaS 多租户）
- 竞争象限图 + 7 类相邻品类对照，结论精准：竞品「要么只有门禁没有全角色，要么只有全角色没有门禁，要么有记录没有失效」
- 有电梯测试、10 条口径字典（批准 / 验收 / 评审 / 代次 / 失效 严格区分）、8 项验证指标（TTFV ≤ 30 分钟等）
- 明确识别触发条件与**不适用**场景（单人开发、纯外包、批准后不再改需求 → 价值退化）

多数开源项目在 4 天时还在纠结做什么，这里已经有成形的品类论证。

### B. 安全设计成熟度显著超同龄【事实 · 代码审计】
这是最令人意外的强项，核心链路近乎教科书级：

- 会话：`__Host-wm_session` / `__Host-wm_csrf`，httpOnly + Secure + SameSite=Lax + 无 Domain（`v1-cookie-policy.ts:10-13`）
- CSRF：双值头 + SHA-256 摘要 **timing-safe** 比对，叠加非安全方法 Origin 精确匹配（`v1-policy.ts:42-51`）
- 凭据：密码 bcryptjs **12 轮** + dummy hash 防枚举；Agent secret 43 字符高熵、SHA-256 + `timingSafeEqual` 存储，服务端不落明文
- 授权：**集中在 `v1-authorization.ts`**，默认拒绝、404 不泄露存在性、Agent 跨项目一律 404、PUBLISH/REVOKE 恒拒 Agent
- 高风险动作：强制 HUMAN 会话 + 密码换取一次性票据，票据**绑定动作 / 目标 / 版本 / payload 摘要**，原子消费
- Webhook：HMAC-SHA256 + `timingSafeEqual` + 基于 `rawBody`，密钥缺失时安全失败（全 403）
- SQL：运行时 `$queryRaw` 全部 `Prisma.sql` 参数化；`$executeRawUnsafe` 仅出现在种子脚本
- 错误：全局过滤器只回 code/message/requestId，堆栈仅进服务端日志

### C. CI 含罕见的数据库漂移闸门【事实】
`.github/workflows/ci.yml` 不只是跑 lint：
`prisma validate` → `migrate deploy`（空库应用全部迁移）→ **`migrate diff --exit-code`（与 schema 比对，不一致即失败）** → 测试 → 契约脚本 → 集成测试 → 构建。

「先把迁移应用到空库再与 schema 比对」这条漂移闸门，在许多成熟项目里都不存在。注释里还记录了「`pnpm test` 只匹配 `src/**/*.spec.ts`，`test/**` 从不执行」这类自己发现并修复的陷阱。

### D. 罕见的自我批判能力【事实】
`docs/positioning.md` §6 风险表 R1–R7 是作者自己写的，其中最锋利的一条：

> **R5 证据自指**：卖「可验证证据」的产品，自己的证据全是 unverified（无真实库并发、无浏览器 E2E、无 GitHub live、无外部用户）。

以及 R7（单人可维护性）、R4（范围压过完成度）、R6（双心智模型）。`BLOCKED.md` 同样诚实记录 B1–B7 及解除条件。**能精确说出自己哪里不行的项目，比自评完美的项目可信度高一个量级。**

### E. 独特的差异化资产【事实】
6 个内置角色包（product/ui/frontend/backend/qa/ops），manifest 1.1，55 资源 / 16 skills，为 Codex 与 Claude Code 生成 `agentEntries` 入口——「规范可下发、触达 Agent 实际工作目录」是真实壁垒，不是提示词包。`workmesh-box` 三平台一条命令起环境（Windows 已实测）。

---

## 5. 短板（按影响排序）

### S1. 开源治理外壳完全缺失【事实 · 最严重】
逐一验证**全部不存在**：

`CONTRIBUTING.md` · `CODE_OF_CONDUCT.md` · `SECURITY.md`（漏洞披露）· `CHANGELOG.md` · `GOVERNANCE.md` · `MAINTAINERS.md` · `CONTRIBUTORS.md` · `ROADMAP.md` · `.github/ISSUE_TEMPLATE/` · `.github/PULL_REQUEST_TEMPLATE.md` · ADR 目录

`.github/` 下**只有 `ci.yml` 一个文件**。全库 grep 无弃用策略，仅 `/api/v1` 前缀，**无 API 版本化与弃用策略**。

后果：外部贡献者没有入口，没有行为准则，没有漏洞上报通道。对一个已 push 到公开 GitHub（`github.com/async-artisan/workmesh`）且自称 MIT 的项目，**这是合规与信任层面的硬伤**。

### S2. 版本发布能力为零【事实】
- `git tag -l` → **0 个标签**
- 无 CHANGELOG、无 release workflow
- **8 个包全部 `"private": true`**，无任何可发布产物
- `package.json` 版本恒为 `1.0.0`，与 `spec/VERSION`（0.2）、定位文档 v1.1 三套版本号互不关联

### S3. 文档结构与事实漂移【事实】
- docs/ 41 个 md / 8,531 行，其中**约 32 个文件、≈80% 行数是规划 / 计划 / 审计 / 状态类**（`superpowers/plans/` 13 个 ≈2880 行、`design/` 6 个 ≈1850 行、`dev-plan` / `migration-plan` / `phase-audit` / `phase-status` / `baseline`）。README 把这些与用户文档并列链接。
- 根目录 `ARCHITECTURE.md`(31B) 与 `ARCHITECTURE_DIAGRAMS.md`(40B) **只是单行路径指针空壳**。
- **已核实的事实错误**：
  - README 称迁移「0001–0011」，实际 **0001–0012**（`0012_invitations` 已存在）
  - `docs/deployment.md:31` 称「仓库只有一份正式初始迁移 `0001_init`」——严重过时
  - `docs/migration-plan.md` 迁移映射错误：M3 写 `0007_change_management`（实为 `0007_units`）、M4 写 `0008_units`（实为 `0008_change_management`）、M5 写 `0009_kind_registry`（不存在）
  - 根目录 `.env.example` 仍在用 `JWT_SECRET` / `DATABASE_URL` / `ANTHROPIC_API_KEY`，**代码实际读取的是 `WORKMESH_V1_DATABASE_URL` / `WORKMESH_COOKIE_MODE`**，`docs/local-dev.md:71` 自己也警告了
  - `docs/code-wiki/ARCHITECTURE.md:217` 教人跑 `workmesh init`，该命令已移除（`spec/SPEC.md:140`）
  - `docs/phase-status.md:32` 引用 `.agent-local/workmesh-v1/`，该目录不存在
  - `docs/knowledge-architecture.md` 仍建议补 `DocumentKind.CONVENTIONS`，该枚举已被 `0011` 删除

作者自己在 `positioning.md` §4.2 承认：「三份文档对同一事实给出三种口径，读者无法判断哪个可信」。

### S4. 验证覆盖有结构性空洞【事实】
`BLOCKED.md` 未解除项：
- **B3 浏览器 E2E**：工作台 / 需求详情 / 评审决定的真实浏览器闭环，从未跑过
- **B2 GitHub live**：分页、Webhook 验签、提交级代码证据绑定，无测试仓库与凭据
- **B4 进程内 HTTP 契约套件无法运行**（`ERR_REQUIRE_ESM`，swc 插件与 Node 版本组合问题）

即：**HTTP 层与真实浏览器层没有自动化验证**，465 个单测主要是服务层。对一个以「门禁」为卖点的产品，门禁本身未被端到端验证。

### S5. 覆盖率门禁配置了但从未执行【事实】
`apps/api/vitest.config.ts` 配了 `thresholds: { lines: 80 }`，但 CI 跑的是 `pnpm test`（= `vitest run`，不带 `--coverage`）。**这条 80% 门槛在流水线上从未生效**。

### S6. 依赖陈旧且零自动审计【事实】
- NestJS `^10.4.5`（v10 已过维护期）、Prisma `^5.21.1`（v5 已停止支持）
- 无 dependabot / renovate 配置，CI 无 `npm audit` / `pnpm audit`
- 死依赖：`multer`、`@nestjs/jwt`、`redis` 声明但 src 零使用（`@nestjs/jwt` 与 `JWT_SECRET` 配套，说明认证方案改过但依赖未清理）

### S7. 配置漂移会直接导致生产故障【事实 · 中危】
代码读 `GITHUB_WEBHOOK_SECRET`（`v1-github-evidence.module.ts:19`），而两处 `.env.example` 都写 `GIT_WEBHOOK_SECRET` —— **照模板配置将导致 webhook 全部失效**。
另外 `assertCookieDeployment`（HTTPS 强制校验）**只在 spec 中调用，`main.ts` 启动时未执行**。
`v1-github-evidence.service.ts:363-371` 把 code-evidence 票据的**明文 secret 存入幂等操作 resultRefs**（落库且重放返回）。
限流器为进程内 Map，多实例部署失效。

### S8. 性能：零实测【事实】
99 个 `@unique`/`@@index`、35 处 `$transaction`、游标分页存在（`requirements.service.ts` MAX_PAGE=100）—— 数据层设计是克制的。但：
- **没有任何性能基准或压测数据**
- Web bundle **506.95 kB（gzip 154 kB）**，构建已报 >500kB 警告，**未做代码分割**
- 87 处 `findMany`（分页覆盖度逐端点未核实，部分列表可能无界）——【推测】需逐端点审计

### S9. 可维护性风险【事实】
- 最大文件 `v1-review.prisma-repository.ts` **2064 行**、`apps/cli/src/index.ts` 1465 行、`RequirementDetail.tsx` 1225 行
- 76k 行单人维护，作者已列为 R7 风险
- 当前工作区 21 改 + 6 新增未提交，`feat/yff-demo-data` 与 main 分叉（B6）

---

## 6. 潜在风险

| 编号 | 风险 | 性质 | 说明 |
| --- | --- | --- | --- |
| **R-1** | **证据自指**（作者已识别为 R5） | 高 · 【事实】 | 卖「可验证证据」但自身零真实验证：无生产库并发、无 E2E、无 GitHub live、无外部团队。定位可信度直接受损 |
| **R-2** | **关键人风险** | 高 · 【事实】 | 有效贡献者 1 人、4 天、76k 行。无第二人可接手 |
| **R-3** | **合规暴露** | 中 · 【事实】 | 公开仓库 + MIT，但无 SECURITY.md（漏洞无处上报）、无 CoC、无贡献协议 |
| **R-4** | **范围压过完成度**（作者 R4） | 中 · 【事实】 | 48 模型 / 24 controller / 全链路各实现一遍，但无一条被真实用户走完 |
| **R-5** | **文档债务复利** | 中 · 【事实】 | ≈80% 计划文档 + 已确认的多口径矛盾，随规模增长将吞噬可维护性（作者 R7） |
| **R-6** | **依赖 EOL 累积** | 中 · 【推测】 | Nest 10 / Prisma 5 均已停止支持，无自动审计，升级成本随时间上升 |
| **R-7** | **配置漂移致生产事故** | 中 · 【事实】 | webhook 变量名不一致 + 启动校验缺失，部署即踩坑 |

---

## 7. 改进方向（按影响 × 成本排序）

### P0 — 决定「是否算开源项目」，成本极低

1. **补齐治理四件套**：`CONTRIBUTING.md`（环境、命令、测试、提交规范、PR 流程）、`SECURITY.md`（漏洞披露与响应时限）、`CODE_OF_CONDUCT.md`（可用 Contributor Covenant 原文）、`CHANGELOG.md`（91 个提交已符合 conventional commits，可自动生成）。**半天工作量，直接决定外部能否参与。**
2. **建立版本发布**：打第一个 tag（建议 `v0.1.0-dev` 而非 1.0.0，诚实反映未验证状态）、加 release workflow 自动生成 changelog。

### P0 — 决定「定位是否可信」（作者自己排的 G0）

3. **跑通一次真实闭环取证**：1 个真实团队、1 条需求、1 次人工签字，把截图 + 时间线 + 三项指标数值留在仓库。**这比再加任何功能更能支撑「有据可查」的定位** —— 直接消解 R-1 证据自指。

### P1 — 消解文档债务（作者 G1）

4. **文档口径收敛 + 目录重构**：迁移数统一为 0012；修 `deployment.md`「只有 0001」、`migration-plan.md` 映射错误；删或修 `workmesh init`；重建 `.env.example`（以代码实际读取的变量为准）；删除两个根目录指针空壳；把 32 个计划文档移入 `docs/_planning/`，README 只链用户文档。**核心原则：同一事实只写一处。**

### P1 — 补验证空洞

5. **解锁 B3 浏览器 E2E**（Playwright）与 **B4 HTTP 契约套件**（替换 swc 插件或改用独立 runner）。
6. **把覆盖率门禁接进 CI**：`vitest run --coverage`，让已配置的 80% 真正生效。

### P2 — 消除生产隐患与依赖债

7. **修配置漂移**：统一 `GITHUB_WEBHOOK_SECRET`；在 `main.ts` 启动调用 `assertCookieDeployment`；票据 secret 不再明文入库。
8. **依赖治理**：接入 dependabot + CI `pnpm audit`；清理 `multer`/`@nestjs/jwt`/`redis` 死依赖；制定 Nest 11 / Prisma 6 升级计划。
9. **性能与前端**：Web 代码分割（bundle 507kB → 目标 <200kB 首屏）；对 87 处 `findMany` 逐端点核实分页；补一次基准压测。

### P3 — 降低关键人风险

10. 拆分 2064 行的 `v1-review.prisma-repository.ts`；为核心模块在 README 标注 owner 与交接文档；尽早引入第二位维护者。

---

## 8. 综合判断

### 判断结论

**未达到优秀开源项目水平。** 分两层看：

**作为工程资产：7.5/10 —— 显著优秀。**
4 天内从零到 76k 行、48 模型、24 controller、633 个通过测试、可构建可运行，且安全设计（会话 / CSRF / 集中授权 / 一次性票据 / timing-safe 验签）、CI 数据库漂移闸门、定位论证三项均达到成熟项目水准。这套底子比多数上线数年的项目更扎实。

**作为开源项目：3/10 —— 尚未起步。**
优秀开源项目的定义不只是代码好，而是**能被陌生人接手、参与、信任**。当前：零 tag、零 release、零外部贡献者、零贡献文档、零漏洞上报通道、零 E2E 验证、公开仓库挂着 MIT 却无治理。这些缺口不是能力问题，是**尚未做过**——但正因为没做过，就不能算优秀开源项目。

### 判断依据（三条硬证据）

1. **年龄与贡献者**：首提交 2026-10-31，4 天，有效贡献者 1 人 —— 开源成熟度需要时间与他人参与，两者都还不存在。
2. **治理外壳缺失**：11 类标准治理文档/模板逐一验证为 0，`.github/` 仅 1 个文件 —— 这是可量化、不可辩驳的客观缺口。
3. **自我证据为空**：一个以「可验证证据」为唯一卖点的产品，自身的真实库并发、浏览器 E2E、GitHub live、外部用户四项全部 unverified（`BLOCKED.md` B2/B3/B4 + `positioning.md` §4.3）—— **这是定位层面而非工程层面的问题，也是最难用「再写代码」解决的一个。**

### 最值得肯定的一点

作者已经把上述问题中的绝大多数**自己写下来了**（R1–R7、G0–G4、B1–B7）。缺的不是认知，是执行窗口。

### 建议的里程碑

> 若能在 **2 周内**完成：治理四件套 + 首个 tag + 一次真实团队签字取证（P0 全部），
> 则可从「pre-release 个人项目」跃迁为「可信的早期开源项目」——
> 因为它的工程底子已经够了，缺的只是**让别人能进来、能信、能验证**的那层壳。

---

## 附：本次评估的实测命令与结果

```
git rev-list --count HEAD                 → 91
git log --reverse --date=short | head -1  → 2026-10-31
git tag -l                                → (空)
git branch -a                             → main, feat/yff-demo-data, origin/main
pnpm --filter @workmesh/shared test       → 58 passed (9 files)
pnpm --filter @workmesh/api test          → 465 passed (54 files), 1 EPERM 环境错误
pnpm --filter @workmesh/web test          → 49 passed (17 files)
pnpm --filter @workmesh/cli test          → 61 passed / 21 failed（wmic.exe 被沙箱拦截）
pnpm build                                → 6/6 tasks successful, 18.043s
find apps packages -name "*.test.*"       → 99 files（不含 .tmp 重复产物）
```

**局限说明**：CLI 的 21 个失败未能排除代码缺陷（沙箱拦截 `wmic.exe` 导致 `whoami` 返回格式不符），建议在干净 CI 环境复测；87 处 `findMany` 的分页覆盖度为逐端点抽查而非全量审计。
