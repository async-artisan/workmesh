# 内置角色包

每个角色一个目录，构建后生成 `manifest.json`（供 CLI 安装）与 `src/generated.ts`（供服务端 seeder 登记）。

## 当前进度

| 包         | 状态                                                   |
| ---------- | ------------------------------------------------------ |
| `product`  | ✅ v1.1.0，含 3 个 skill、3 个模板、1 份清单、1 个示例 |
| `backend`  | ✅ v1.1.0，含 3 个 skill、2 个模板、1 份清单           |
| `qa`       | ✅ v1.1.0，含 3 个 skill、3 个模板、1 份清单           |
| `frontend` | ✅ v1.1.0，含 2 个 skill、1 个模板、1 份清单           |
| `ui`       | ✅ v1.1.0，含 2 个 skill、2 个模板、1 份清单           |
| `ops`      | ✅ v1.1.0，含 3 个 skill、3 个模板、1 份清单           |

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
```

脚本会校验 SKILL.md frontmatter（`name`、`description`）、路径安全、单文件 ≤ 4MB、资源 id 唯一，然后计算摘要并写回 `manifest.json` 与 `src/generated.ts`。

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
