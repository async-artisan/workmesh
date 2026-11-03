# WorkMesh 协作规范（下发版 v0.2）

每台机器上的每个角色都按同一份规范干活。规范是文件，不是 wiki——由 `workmesh roles install` 作为角色包资源写入本工作区，并随角色包版本锁定；命令面与 `workmesh` v1 一致。

## 0. 心智模型

大家不在一起工作，但在**同一个事实**上工作：

- 产品是源头，产品的定稿 PRD 是权威事实；
- 草稿、笔记与过程留在本地，平台只保存**正式事实**：发布版、证据与决定；
- 平台负责装配上下文、校验工件、传播变更、记录签字；
- 网页不是数据后台，而是人做决定的地方：批准、返修、撤销、确认变更；
- 命令行是 Agent 的工作入口，Agent 没有批准路径。

## 1. 编号与锚点

需求编号全局唯一且带项目前缀：

```
<PROJECT_KEY>-<三位序号>      例：YFF-001
<需求编号>/<stepKey>          例：YFF-001/impl（任务引用）
```

`PROJECT_KEY` 为 2–6 位大写字母，创建后不可更改。

编号只保证**唯一、稳定、永不复用**，不承载类型语义（类型与状态放元数据）。这条对齐 PEP / RFC / KEP 的做法：编号会出现在分支、commit、PR、用例与文件名里，嵌入类型会让后续分类改动断掉全链路引用。

任务不单独编号，用「需求编号 + 步骤 key」引用；步骤 key 由工作流定义固定（如 `impl`、`cases`、`release`）。

**没有编号的产出等于不存在**，平台拒收。编号必须出现在：

| 载体         | 约定                                            |
| ------------ | ----------------------------------------------- |
| 分支         | `feat/YFF-001-<简述>`                           |
| Commit       | 正文或 footer 含 `YFF-001`                      |
| Pull Request | 标题或正文含 `YFF-001`（否则无法成为签字证据）  |
| 工件文件     | 路径或摘要里含 `YFF-001`                        |
| 用例         | 用例 ID `TC-YFF-001-<序号>`，文件内声明需求编号 |
| 知识条目     | front-matter 的 `req` 字段                      |
| 发布记录     | `requirements: [YFF-001]`                       |

## 2. 通用骨架（七步）

```
① 取活并认领  就绪任务列表（GET /api/v1/projects/:projectId/tasks/ready 或 Web 工作台）取得 taskId
              → workmesh claim --task <taskId>
② 取上下文    workmesh context --task <taskId> --claim <claimId> --expected-version <taskVersion> --materialize
③ 生产        按本角色 SOP 推进
④ 自检        逐条过 roles/<role>.md 的 DoD 清单
⑤ 交付        workmesh deliver --task <taskId> --claim <claimId> --snapshot <snapshotId> \
                --expected-version <taskVersion> --manifest deliver.json
⑥ 请求评审    workmesh review --artifact-set <artifactSetId> --expected-version <artifactSetVersion>
⑦ 交接        人在 Web 批准 → 任务 DONE → 解锁下游角色
```

**开工第一动作固定是取上下文**。禁止凭聊天记录、记忆或读代码推测需求。

**Agent 只能请求，不能批准**：`workmesh review` 只创建人工评审请求；批准、返修、撤销与变更确认只接受 Web 人工会话。Agent 也不能把任务写成 `DONE`。

## 3. 红线

1. 不臆造需求：产品源里没有的功能不做；
2. 不改验收标准：有疑问发 `NEEDS_CLARIFY` 回问，不自行修改；
3. 不省略锚点：任何产出必须带需求编号；
4. 不确定即声明：输出 `NEEDS_CLARIFY` 并说明依据缺口，不自行假设；
5. 只交证据不交结论：交可校验的工件，不交"我认为已完成"；
6. 不越权：不改其他角色的工件；
7. 不自宣告完成：`DONE` 只能来自人的签字。

## 4. 状态门

需求阶段（phase）由项目发布的**工作流定义**决定：服务端按 DAG 的步骤、依赖与评审槽计算，人不能直接改写阶段字段。

任务状态只有四种，Agent 最多推进到第三种：

```
OPEN → IN_PROGRESS → REVIEW_PENDING → DONE
```

| 状态             | 进入条件                                              |
| ---------------- | ----------------------------------------------------- |
| `OPEN`           | 工作流实例化后生成；前序步骤未完成时不可认领          |
| `IN_PROGRESS`    | Agent 认领成功，`TaskClaim` 代次有效                  |
| `REVIEW_PENDING` | 工件集交付并通过平台复核                              |
| `DONE`           | HUMAN 在 Web 对所有审批槽作出决定，且门禁条件全部满足 |

签字来源分两类：

- 代码任务：平台外必须有**他人**对被验收提交的评审与合并证据，由代码托管适配器标准化为代码评审证据；作者自审、Bot、旧 SHA、已撤销的评审一律无效。
- 产品 / UI / 测试 / 运维：在 Web 内作出决定，记录决定人、时间与所针对的版本。

撤销与返修以**追加记录**实现，不修改既有历史；旧批准不会因新决定被静默改写，而是显式失效后重新走评审。

## 5. 本地知识与共享

草稿留本地，共享走候选：

```
.workmesh/knowledge/<role>/
  index.md      # 导航
  log.md        # 变更日志
  <topic>/*.md  # 一条知识一个文件
```

front-matter：

```yaml
---
id: k-8f3a2c
req: YFF-001
role: backend
status: draft # draft 只是本地观察记录
updated: 2026-10-31
---
```

- 本地草稿与个人笔记不上传，平台不索引本机目录；
- 需要共享时提交候选：`workmesh candidate --kind KNOWLEDGE --kb <kbId> --file <path>`，创建候选修订并触发知识发布评审；
- 只有人工批准并**发布**的修订才进入上下文装配；本地 `approved` 不等于平台发布；
- 上下文快照锁定发布版与真实字节摘要，Agent 不会在执行中途被换输入。

产品与理解类内容同理：`--kind UNDERSTANDING | DECISION | PRD`，候选不等于发布，PRD 必须携带已确认的理解基线、`deliveryScope` 与 `acceptance`。

## 6. 命令面

| 命令                     | 用途                                             | 使用者     |
| ------------------------ | ------------------------------------------------ | ---------- |
| `workmesh auth login`    | 浏览器设备授权，取得受限凭据                     | 人（一次） |
| `workmesh setup`         | 一条命令完成登录 + 安装角色包 + 自检             | 人（一次） |
| `workmesh roles install` | 校验并安装角色包，写入 `.workmesh` 锁文件        | 人（一次） |
| `workmesh claim`         | 认领任务，返回 `claimId` 与任务版本              | Agent      |
| `workmesh context`       | 创建或读取上下文快照；`--materialize` 校验后落盘 | Agent      |
| `workmesh materialize`   | 把既有快照的资源原子落盘                         | Agent      |
| `workmesh candidate`     | 提交知识 / 理解 / 决定 / PRD 候选（不发布）      | Agent      |
| `workmesh deliver`       | 交付精确工件集（HOSTED 字节或 GIT_REF 引用）     | Agent      |
| `workmesh review`        | 创建人工评审请求（只请求，不批准）               | Agent      |
| `workmesh receipt`       | 查看 / 核对本地操作收据                          | Agent      |
| `workmesh changes`       | 当前项目与角色的变更收件（稳定分页）             | Agent      |

批准、返修、撤销与变更确认**没有命令行入口**，只能在 Web 完成。旧命令 `init / ready / sign / sync / ack` 已移除，不要继续使用。

## 7. 回问格式

```
NEEDS_CLARIFY
  需求编号：YFF-001
  任务编号：YFF-001/impl
  依据缺口：<缺什么>
  建议：<可选>
  阻塞：<是否被阻塞>
```

回问同时把任务工作状态置为 `BLOCKED`（`POST /api/v1/tasks/:taskId/work-status`），并写明解除条件；阻塞不等于完成，恢复前先核对当前基线与未决事项。
