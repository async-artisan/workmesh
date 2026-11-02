# 角色包

每个角色一个目录，构建后生成 `manifest.json` 供 `workmesh roles install` 安装。

## 当前进度

| 包         | 状态                                                 |
| ---------- | ---------------------------------------------------- |
| `product`  | ✅ v0.1，含 3 个 skill、3 个模板、1 份清单、1 个示例 |
| `backend`  | ✅ v0.1，含 3 个 skill、2 个模板、1 份清单           |
| `qa`       | ✅ v0.1，含 3 个 skill、3 个模板、1 份清单           |
| `frontend` | ✅ v0.1，含 2 个 skill、1 个模板、1 份清单           |
| `ui`       | ✅ v0.1，含 2 个 skill、2 个模板、1 份清单           |
| `ops`      | ✅ v0.1，含 3 个 skill、3 个模板、1 份清单           |

## 结构

```
product/
├── package.meta.json        # 源：身份、兼容性、skills、inputs、outputs、agentEntries
├── manifest.json            # 构建产物：含每个文件的 sha256 与字节数
├── skills/
│   ├── index.md             # 技能索引，宿主入口指向它
│   └── <skill>/SKILL.md     # 一个 skill 一件事
├── assets/
│   ├── templates/           # 工件模板
│   └── examples/            # 合格样例，默认安装
├── checklists/              # 交付前自检
└── references/              # 只放指针，不放知识正文
```

## 构建

```bash
pnpm build:role-packages            # 全部包
node scripts/build-role-packages.mjs product
```

脚本会：校验 SKILL.md frontmatter（`name`、`description`）、路径安全、单文件 ≤ 4MB、资源 id 唯一、`templateResourceId` / `agentEntries.resourceId` 可解析，然后计算摘要并写回 `manifest.json`。

## schema 版本

默认输出 `packageSchemaVersion: "1.0"`，可被当前 CLI 安装。

设计稿的 v1.1（`description`、`license`、`skills[]`、`outputs[].evidence`）已经写在 `package.meta.json` 里，用 `--schema=1.1` 生成；需要 `packages/shared` 同步升级后才能被安装器接受。

## 安装

```bash
workmesh roles install --package role-packages/product \
  --project <项目 UUID> \
  --api https://<host>/api/v1 \
  --host codex
```

安装到工作区的 `.workmesh/packages/<id>/<version>/`，并在 `lock.json` 记录摘要。

## 新增一个包

1. 复制 `product/` 改名。
2. 改 `package.meta.json` 的 `id`、`roleKey`、`skills`、`inputs`、`outputs`。
3. 写 skills 与模板。
4. 跑构建脚本。

## 规则

- 一个包 = 3–5 个 skill，不要写成一篇长 SOP。
- `description` 必须写「做什么 + 何时用」，它决定宿主是否加载。
- 不写死项目信息（需求编号、人名、仓库地址）。
- 不复制知识正文，只放指针。
- 不放可执行脚本。
