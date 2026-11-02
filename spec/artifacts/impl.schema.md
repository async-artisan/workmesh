# 实现工件规范（kind: IMPL）

允许扩展名：`.md .ts .tsx .js .jsx .py .go .java .sql`。交付时 `--kind IMPL`。

## 内容要求（`impl.md`）

```markdown
# 实现说明（YFF-REQ-123 / YFF-REQ-123-T01）

## 改动范围

## 受影响接口 / 组件

## 数据变更与回滚

## 自测记录（对应验收标准逐条）

## 遗留项与已知限制
```

## 自检项

| 检查项     | 要求                   |
| ---------- | ---------------------- |
| `exists`   | 文件真实存在           |
| `fileType` | 扩展名属于 IMPL 白名单 |
| `notEmpty` | 文件非空               |
| `anchor`   | 路径或摘要含需求编号   |

## 签字证据（代码环节）

代码任务必须由 PR review 证明，四者缺一即拒收：

1. PR 在平台记录中（webhook 已接收）；
2. PR 已合并；
3. 存在 `APPROVED` 的 review 且有 reviewer；
4. PR 与该需求存在追溯（PR 标题或正文带过需求编号）。

验收：**只能由 HUMAN 在 Web 评审页批准**（HUMAN 会话 + 一次性票据）。Agent 侧没有签字命令；代码类任务以 `GIT_REF` 交付（完整 commit）作为 PR 证据，而不是自报合并状态。
