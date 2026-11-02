# WorkMesh 协作规范（下发版 v0.1）

每台机器上的每个角色都按同一份规范干活。规范是文件，不是 wiki——由 `workmesh init --role <role>` 写入本工作区。

## 0. 心智模型

大家不在一起工作，但在**同一个事实**上工作：

- 产品是源头，产品的定稿 PRD 是权威事实；
- 各角色的知识留在本地，平台只保存**索引、指针与挂靠关系**；
- 平台负责装配上下文、校验工件、传播变更、记录签字；
- 网页只看进度，本地命令行（或 MCP）才是工作入口。

## 1. 编号与锚点

需求编号全局唯一且带项目前缀：

```
<PROJECT_KEY>-REQ-<序号>      例：YFF-REQ-123
<需求编号>-T<两位序号>        例：YFF-REQ-123-T01（任务）
```

`PROJECT_KEY` 为 2–6 位大写字母，创建后不可更改。

**没有编号的产出等于不存在**，平台拒收。编号必须出现在：

| 载体         | 约定                                                |
| ------------ | --------------------------------------------------- |
| 分支         | `feat/YFF-REQ-123-<简述>`                           |
| Commit       | 正文或 footer 含 `YFF-REQ-123`                      |
| Pull Request | 标题或正文含 `YFF-REQ-123`（否则无法成为签字证据）  |
| 工件文件     | 路径或摘要里含 `YFF-REQ-123`                        |
| 用例         | 用例 ID `TC-YFF-REQ-123-<序号>`，文件内声明需求编号 |
| 知识条目     | front-matter 的 `req` 字段                          |
| 发布记录     | `requirements: [YFF-REQ-123]`                       |

## 2. 通用骨架（七步）

```
① 取活      workmesh ready --role <ROLE>        → 未被阻塞的任务队列
② 取上下文  workmesh context <需求编号>          → 权威上下文包
③ 生产      按本角色 SOP 推进
④ 自检      逐条过 roles/<role>.md 的 DoD 清单
⑤ 交付      workmesh deliver                    → 本地自检 + 平台二次校验
⑥ 提交签字  任务进入 REVIEW_PENDING             → 禁止自行置 DONE
⑦ 交接      人签字 → 任务 DONE → 解锁下游角色
```

**开工第一动作固定是取上下文**。禁止凭聊天记录、记忆或读代码推测需求。

## 3. 红线

1. 不臆造需求：产品源里没有的功能不做；
2. 不改验收标准：有疑问发 `NEEDS_CLARIFY` 回问，不自行修改；
3. 不省略锚点：任何产出必须带需求编号；
4. 不确定即声明：输出 `NEEDS_CLARIFY` 并说明依据缺口，不自行假设；
5. 只交证据不交结论：交可校验的工件，不交"我认为已完成"；
6. 不越权：不改其他角色的工件；
7. 不自宣告完成：`DONE` 只能来自人的签字。

## 4. 状态门

需求：`DRAFT → PRD_READY → DESIGN_READY → IN_DEV → CODE_LINKED → TESTED → RELEASED`
任务：`OPEN → IN_PROGRESS → REVIEW_PENDING → DONE`

需求状态由平台按各角色任务的签字情况自动推进，不人工改：

| 状态           | 进入条件                 |
| -------------- | ------------------------ |
| `PRD_READY`    | 产品任务全部签字         |
| `DESIGN_READY` | 再加 UI 任务全部签字     |
| `IN_DEV`       | 前后端任务有任何一个开工 |
| `CODE_LINKED`  | 前后端任务全部签字       |
| `TESTED`       | 再加测试任务签字         |
| `RELEASED`     | 再加运维任务签字         |

签字按角色分两种方式：

- 前端 / 后端：**PR review 证明**（PR 已合并、有 APPROVED 的 review、且 PR 与需求有追溯）；
- 产品 / UI / 测试 / 运维：平台内签字（`workmesh sign <taskId>`）。

agent 发起的签字请求一律被拒。

## 5. 本地知识

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
req: YFF-REQ-123
role: backend
status: approved # approved 才进上下文；draft 是观察记录
updated: 2026-10-31
---
```

- `workmesh sync` **只上报索引**，正文永远不出本机；
- agent 自己观察到的内容先写 `status: draft`，人确认后才转 `approved`；
- 只有 `approved` 条目进入上下文装配。

## 6. 命令面

| 命令                            | 用途                            |
| ------------------------------- | ------------------------------- |
| `workmesh init --role <role>`    | 下发本规范到当前工作区          |
| `workmesh ready --json`          | 本角色未被阻塞的任务            |
| `workmesh context <CODE> --json` | 拉取上下文包                    |
| `workmesh deliver`               | 交付工件（本地自检 + 平台校验） |
| `workmesh sign <taskId>`         | 人签字关门（agent 不可用）      |
| `workmesh sync`                  | 上报知识索引（正文不上平台）    |
| `workmesh changes --role <role>` | 本角色待确认的产品变更          |
| `workmesh ack <eventId> --role`  | 确认变更已处理                  |

## 7. 回问格式

```
NEEDS_CLARIFY
  需求编号：YFF-REQ-123
  任务编号：YFF-REQ-123-T01
  依据缺口：<缺什么>
  建议：<可选>
  阻塞：<是否被阻塞>
```
