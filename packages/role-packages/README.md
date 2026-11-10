# 内置角色包

每个角色一个目录，构建后生成 `manifest.json`（供 CLI 安装）与 `src/generated.ts`（供服务端 seeder 登记）。

## 当前进度

| 包         | 状态                                                        |
| ---------- | ----------------------------------------------------------- |
| `product`  | v1.2.1；新增想法评估、需求检查、验收 JSON 与优先级/MVP 切片 |
| `backend`  | v1.2.2；保留现状调查与 MVP 规划，交付后查询自动创建的评审   |
| `qa`       | v1.2.1；保留逐条核验与缺口记录，交付后查询自动创建的评审    |
| `frontend` | v1.2.1；保留契约/实现技能，交付后查询自动创建的评审         |
| `ui`       | v1.2.1；保留设计/复用技能，交付后查询自动创建的评审         |
| `ops`      | v1.2.1；保留发布/回滚/冒烟技能，交付后查询自动创建的评审    |

## 结构

```
roles/product/
├── package.meta.json        # 源：身份、兼容性、skills、inputs、outputs、agentEntries
├── manifest.json            # 构建产物：含每个文件的 sha256 与字节数
├── guide.md                 # 角色入口
├── skills/<skill>/SKILL.md  # 一个 skill 一件事
├── assets/templates/        # 工件模板
├── checklists/              # 交付前自检
└── references/              # 只放指针，不放知识正文
```

## 构建

```bash
pnpm build:role-packages                                    # 根脚本
pnpm --filter @workmesh/role-packages build                 # 包内构建（生成 + tsup）
pnpm --filter @workmesh/role-packages test                  # 构建器校验测试
```

构建会解析 `SKILL.md` 的 YAML frontmatter，要求 `name`、`description` 为非空字符串，`name` 符合小写 slug 格式并与技能目录名一致；对应技能还必须在 `package.meta.json` 中声明相同 key 和路径。构建器同时校验资源路径位于当前角色包目录、单文件不超过 4 MiB、资源 id 不重复，然后计算摘要并写回 `manifest.json` 与 `src/generated.ts`。`test` 覆盖有效和无效 frontmatter、目录名不匹配，以及资源路径、大小和 id 校验。

构建还核对 product 验收 YAML/JSON 的正式字段、key 与内容一致，及 QA 用例示例的引用与验证方式，避免“照模板写仍被 API 拒绝”。规格方法与本地质量入口见 [采用设计](../../docs/design/spec-driven-quality.md)。

## 安装与登记

- CLI 安装：`workmesh roles install --package packages/role-packages/roles/product --project <uuid> --api <base> --host codex`
- 服务端登记：应用启动时由 `V1BuiltinRolePackageSeeder` 读取 `src/generated.ts`，以内置包（`projectId=null`）写入，所有项目可见。

同 `packageId@version` 内容变化会拒绝覆盖，必须升 SemVer——这条防止已锁定的字节被悄悄替换。

## 新增一个包

1. 复制 `roles/product/` 改名。
2. 改 `package.meta.json` 的 `id`（`workmesh.role.<role>`）、`roleKey`、`skills`、`inputs`、`outputs`。
3. 写 skills、模板、清单。
4. 跑构建，并确认 seeder 测试与 CLI 安装都通过。

## 规则

- 一个包 = 2–5 个 skill，不要写成一篇长 SOP。
- `description` 必须写「做什么 + 何时用」，它决定宿主是否加载。
- 不写死项目信息（需求编号、人名、仓库地址）。
- 不复制知识正文，只放指针。
- 不放可执行脚本。
