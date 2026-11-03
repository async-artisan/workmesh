# WorkMesh Web 工作台改造计划书

> 版本：v1.0 · 日期：2026-11-02 · 状态：待评审
> 范围：`apps/web` 的信息架构、核心页面与视觉系统；`apps/api` 只新增只读读模型，不做数据库迁移
> 依据：[项目定位](../positioning.md)、[工作台与需求详情交互方案](workbench-and-requirement-detail.md)、当前 `main` 工作树
> 一句话：把 Web 从“接口控制台”改成“人关门的签字台”，用一条竖切验证，不重写后台。
> 实现进度（2026-11-02）：`GET /v1/workbench`、工作台四类待办 + 搜索/角色筛选/排序 + 行级键盘、签字/审批抽屉（复用决定页）、变更影响抽屉、批量确认变更、`GET /v1/requirements/:id` + 需求编辑抽屉、需求详情（7 段门禁 + 概览/交付物/任务/变更/PRD/评审/追溯 Tab）、决定页（正文/差异/工件/历史 + 一次确认 + 回执）、最近活动流、站内通知中心、手动邮件摘要（SMTP 可选）、导航待办徽标、项目待办计数、移动端基础布局、看板只读与流程实例显式绑定已落地；定时邮件提醒（可由外部 cron 调用摘要接口）、导航 IA 收敛、设置页与完整视觉主题仍待做。

---

## 0. 一页结论

**问题**：当前 Web 的核心对象是“实体”（项目 / 需求 / 文档 / 评审），不是“决定”。人必须记住 UUID、跨多个页面拼上下文，才能在评审页签一个字；而评审页本身不显示正文、验收标准、工件、PR 证据和决定人。

**方案**：只做一条竖切——**待办 → 决定页 → 回执**；配一套“签字台”视觉。先补只读读模型，再改工作台，最后改决定页。旧页面保留，按路由灰度，验收后删除。

**三个硬指标**：

1. 任何待办不出现裸 UUID；
2. 签字前证据可见率 100%；
3. 进入工作台后到提交签字 ≤3 次点击。

**不做什么**：不重写后端、不改票据与密码协议、不做 Agent 执行视图、不做聊天、不做拖拽看板、不在 Web 编辑 PRD 正文。

---

## 1. 背景与定位

项目定位把 Web 的职责写得很清楚：

> 人只在关键节点用浏览器作正式批准，Agent 只持有受限、可撤销的凭据。
> 它不执行 Agent、不做 AI 对话、不替代 GitHub：它只裁决「这份交付是否成立」。
> —— [docs/positioning.md](../positioning.md)

关键不对称是**责任在人，执行在 Agent**。因此 Web 不是数据管理后台，而是**决定发生的地方**。它唯一要优化的指标不是“页面数量”或“数据覆盖率”，而是：

- 一个人从“轮到我”到“签完字”要多久；
- 签字之前，他是否看得到支撑这次决定的证据；
- 签完之后，别人能不能回答“谁批的、批的哪一版、凭什么”。

这三件事，当前 UI 都没有做好。

---

## 2. 现状诊断

### 2.1 四个直接症状

| #   | 症状                                                                      | 证据                                                              |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | 打开一条待评审，需要手工粘贴评审请求 UUID                                 | [Workbench.tsx](../../apps/web/src/pages/Workbench.tsx#L120-L134) |
| 2   | 评审页只有 id、digest、revision id、槽位 UUID，看不到正文、验收、工件、PR | [Reviews.tsx](../../apps/web/src/pages/Reviews.tsx#L290-L367)     |
| 3   | 决定记录不显示“决定人”，只显示槽位、摘要、说明、时间                      | [Reviews.tsx](../../apps/web/src/pages/Reviews.tsx#L398-L411)     |
| 4   | 在 PRD 页看完 diff，点“进入评审”就跳走，diff 消失                         | [Prds.tsx](../../apps/web/src/pages/Prds.tsx#L124-L127)           |

### 2.2 对照定位的四条原则

| 原则       | 现状                                                                     | 后果                                 |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------ |
| 待办优先   | 工作台只列当前项目的变更收件人；无评审、无审批、无计数、无等待时长       | 人不知道“现在轮到我做什么”           |
| 证据可见   | 工件集内容从未在 Web 请求；`GET /v1/artifact-sets/:id` 早已存在          | 签字变成盲签，审计时无法自证         |
| 一门一动作 | 一次签字跨“选槽位 → 选决定 → 填意见 → 密码 → 票据 → 提交”，两个弹窗      | 摩擦高，容易放弃或敷衍               |
| 可追溯     | 没有需求详情页、没有 `/requirements/:code`、没有时间线；决定记录无决定人 | “谁批的、批的哪一版”在 UI 上答不出来 |

### 2.3 一个治理语义问题

Web 的“创建流程实例”会把每个步骤的责任人和每个审批槽都绑成当前用户：

```ts
// apps/web/src/pages/Requirements.tsx L96-L105
responsibleUserId: user.id;
userId: user.id;
```

UI 既不让改，也不提示。如果服务端没有额外约束，这就是结构化的自审，与“禁止作者自审”的定位直接冲突。**已定**：保留为管理员初始化，普通成员不可见；必须逐项选择责任人与审批人，并阻断同角色“责任人 = 审批人”的组合。后续有 CLI / 默认实例路径后，再评估完全移出 Web。

### 2.4 视觉现状

- 当前是亮色后台风格：白底、白卡片、蓝色强调，信息密度低，和“审计 / 证据 / 签字”的品牌气质不匹配。
- 历史 UI 总结曾描述已移除的 `Dashboard.tsx`、右侧面板和 ⌘K；当前行为以 `apps/web/src` 实现为准。
- [index.css](../../apps/web/src/index.css#L7) 通过 Google Fonts `@import` 加载字体，自部署 / 内网 / 数据不出域场景会首屏阻塞并产生外部请求。
- [index.css](../../apps/web/src/index.css#L3730) 起已有约 50 个 `wb-*` / `gate-*` / `evidence-*` / `signoff-*` 样式没有任何组件使用——工作台改版做过一半，缺的是页面，不是设计。

### 2.5 结论

> 当前 Web 是“把 `/api/v1` 表格化”的运维后台；定位要的是“把决定前置”的审批工位。两者差的不是页面数量，而是**核心对象**：从“实体”换成“决定”。

---

## 3. 目标与非目标

### 3.1 目标

| 编号 | 目标       | 可测结果                                                                    |
| ---- | ---------- | --------------------------------------------------------------------------- |
| G1   | 待办聚合   | 跨项目聚合签字 / 变更 / 可开工；每行有人类可读标识与等待时长                |
| G2   | 证据前置   | 文档类看到正文 + 真实 diff + 验收；工件类看到 sha256 / commit / checks / PR |
| G3   | 一门一动作 | 一个决定页 + 一个确认框完成；成功后给回执                                   |
| G4   | 可追溯     | 决定记录显示决定人、时间、当时版本与摘要；回执可复制                        |
| G5   | 仪器感     | 深色台面 + 纸张 + 单一信号色；关键数字与印章形成记忆点                      |

### 3.2 非目标（本计划明确不做）

- 不做 Agent 执行、编排、对话、运行时沙箱。
- 不做拖拽式看板；状态由签字推导，拖拽会误导。
- 不在 Web 编辑 PRD / 知识正文；正文由 Agent 提交候选。
- 不做大屏 BI 或运营仪表盘。
- 不在本期做完整审计日志检索；只做决定回执与需求时间线。
- 不引入 BPMN 建模器；流程定义仍由 CLI / 管理员维护。

---

## 4. 设计原则

1. **待办优先**：首页回答“现在有什么在等我”，不是“系统里有多少数据”。
2. **证据先于动作**：任何签字按钮出现之前，证据必须已经可见。
3. **一门一动作**：一道门禁只给一个主操作；次要操作降级为链接。
4. **可追溯**：每次决定都带人、时间、版本、摘要；回执可复制、可核对。
5. **不猜权限**：按钮是否可用由服务端 `viewerCanDecide` 等字段派生，前端不根据本地状态推断。
6. **仪器感**：90% 的界面安静，10% 的信号强烈；一屏只有一个“亮”的元素。

> 每个操作是否该由人做、是否该出现在 Web，见 [人机操作清单](workbench-and-requirement-detail.md#L626)。本计划的所有页面改造都以该清单为边界。

---

## 5. 信息架构与路由

### 5.1 导航调整

当前 10 个一级菜单（[nav.ts](../../apps/web/src/nav.ts#L22-L33)）把“工作台 / 项目 / 需求 / 知识库 / PRD / 评审 / 看板 / 角色 / 设备授权 / 用户中心”平铺，人的任务路径被管理功能淹没。

目标收敛为 5 个一级入口 + 用户菜单：

```text
工作台        /
需求          /requirements
评审          /reviews
项目          /projects
设置          /settings        （成员与角色 / 知识库 ACL / 设备授权 / Agent 凭据）
────────
用户菜单      /profile · 退出登录
```

旧路径保留重定向：

| 旧路径               | 新去向                                                 |
| -------------------- | ------------------------------------------------------ |
| `/knowledge`、`/prd` | `/requirements` 的文档视图（或 `/documents?kind=PRD`） |
| `/board`             | `/requirements?view=board`                             |
| `/roles`             | `/settings/members`                                    |
| `/authorization`     | `/settings/device`                                     |
| `/profile`           | 保留，用户菜单进入                                     |

> 导航收敛放在 M3；M1/M2 先不改菜单结构，避免和路由改造互相干扰。

### 5.2 路由改造

当前 [App.tsx](../../apps/web/src/App.tsx#L239-L261) 用 `location.pathname === '...'` 做精确匹配，参数路由进不去；`findNav` 也是精确匹配，详情页侧栏不会高亮。

改造：

- 用 `useRoutes` 或 `matchPath` 替代字符串相等；
- `findNav` 改为前缀匹配（`/reviews/abc` 命中 `/reviews`）；
- 新路由 `/reviews/:reviewId`；旧 `/reviews?id=` 做重定向，保留一个版本；
- `/requirements/:code` 放在 M4，等只读详情接口就绪。

---

## 6. 页面方案

### 6.1 工作台（M1）

```text
┌────────────────────────────────────────────────────────────────────┐
│ 工作台          项目 [全部项目 ▾]        更新于 12 秒前   [刷新]   │
│ 3 件事在等你关门                                                   │
├────────────────────────────────────────────────────────────────────┤
│   3                2                5                              │
│   待签字           待确认变更        可开工                         │
├────────────────────────────────────────────────────────────────────┤
│ [全部 10] [签字 3] [变更 2] [可开工 5]      角色 [全部 ▾]  排序 ▾  │
├────────────────────────────────────────────────────────────────────┤
│ ── YFF 项目 ──────────────────────────────────────────────────────  │
│ ● 签字   YFF-012  登录页改版                                    │
│          BACKEND · 等待 3 天 · 证据 2 件 · v3          [进入决定]  │
│ ● 变更   YFF-008   订单取消规则调整                              │
│          BACKEND / QA · 等待 2 天 · 影响 4 项          [查看影响]  │
│ ○ 任务   YFF-009/impl  支付回调重试 · BACKEND · 无阻塞  [查看上下文] │
└────────────────────────────────────────────────────────────────────┘
```

**行内容固定五段**：类型徽标、需求编号 + 标题、角色 / 等待时长 / 证据数、主操作、次操作。

**状态设计**：

- 首次加载：3 个读数骨架 + 5 行骨架，不显示“暂无待办”；
- 空（全部）：一句话 + “打开需求列表”；
- 空（单 Tab）：切 Tab 提示；
- 局部错误：顶部错误条 + 重试，其余分类可用；
- 数据过期：右上角“更新于 N 分钟前” + 刷新；
- 无项目权限：整页空态 + 联系管理员。

**导航徽标**：复用 `.menu-badge`（[index.css](../../apps/web/src/index.css#L292)），显示待办总数；60 秒轮询，页面隐藏时暂停。

### 6.2 决定页（M2）

新路由 `/reviews/:reviewId`，全屏页面而不是抽屉：可分享、可刷新、长文阅读和移动端都更稳。

```text
┌──────────────────────────────────────────────────┬──────────────────┐
│ YFF-012 / 登录页改版          v3  ● 待签      │ 你的决定         │
│ YFF · BACKEND · 等待 3 天 · 2 件证据             │ 槽位 BACKEND     │
├──────────────────────────────────────────────────┤                  │
│ [内容] [差异] [验收] [工件] [历史]               │ [批准]           │
│ ┌──────────────────────────────────────────────┐ │ [要求修改]       │
│ │ PAPER：PRD 正文 / 与 v2 的差异                │ │ [驳回]           │
│ │ 暖白纸面，深色字，行高 1.7                    │ │                  │
│ └──────────────────────────────────────────────┘ │ 影响 2 个任务    │
│ 证据账本：sha256 · commit · checks · PR           │ 上一次：你批 v2  │
│ 决定历史：谁 / 何时 / 哪版 / 意见                 │ 验证后提交       │
└──────────────────────────────────────────────────┴──────────────────┘
```

**文档类证据**：

- 标题、版本、状态、需求编号；
- Markdown 正文渲染（不是 `<pre>`）；
- 与已发布版本的真实 diff（LCS，不是按行号对齐）；
- 验收标准逐条；
- 上一次决定：决定人、时间、版本、摘要、意见；
- 历史决定列表。

**工件类证据**：

- 调 `GET /v1/artifact-sets/:id`，展示每个工件的 `kind / mediaType / sha256 / byteLength / commitSha / repoPath / summary / checks`；
- 失败 check 红色高亮；
- 补 task → workflow instance → requirement 的上下文；
- PR 证据：有链接则跳转，没有则明确“未提供”。

**右栏决定**：

- 槽位列表：`viewerCanDecide` 为 true 才显示操作按钮；其余显示“由 X 处理 / 等待角色 Y”；
- 决定三选一；要求修改 / 驳回必须填说明；
- 影响说明：签了会推进到哪个阶段、影响哪些任务 / 知识；
- 一个 `ConfirmationPrompt` 完成密码 + 票据，不再“决定弹窗 → 验证弹窗”两层；
- 失败原样展示 `code / message / details / requestId`。

**成功回执**：

```text
┌──────────────────────────────────────────────┐
│  APPROVED                                    │
│  YFF-012 · BACKEND · v3                   │
│  决定人  李明                                │
│  时间    2026-11-02 22:41:07                 │
│  摘要    7bb39c5c…                           │
│  requestId  req_01J…                         │
│  [复制审计行]  [下一条]                      │
└──────────────────────────────────────────────┘
```

### 6.3 需求详情（M4，可后置）

`/requirements/:code`：头部（编号 / 标题 / 状态 / 优先级 / 版本）+ 七段门禁轨道 + 概览 + 任务 + 交付物 + 变更 + 追溯 + 时间线。没有这一页，“有据可查”就缺一个可分享的 URL。

### 6.4 登录页（M3）

从通用卡片改成“终端握手”：大字号 wordmark、细网格背景、一行 tagline `事实 · 证据 · 签字`、一个主操作。不做营销页。

---

## 7. 视觉系统：签字台（The Signing Desk）

### 7.1 概念

深色台面、亮色纸张、单一信号色、等宽数据。把品牌词翻译成视觉：

| 品牌词 | 视觉载体                                   |
| ------ | ------------------------------------------ |
| 事实   | 等宽数字、版本号、时间戳、sha256 短码      |
| 证据   | 纸张质感的长文面板、账本式时间线、校验 LED |
| 签字   | 印章式回执、一次性“落章”动效               |

一句话：像飞行仪表盘或审计终端，不像游戏大厅。

### 7.2 色彩 token

```css
:root[data-theme='console'] {
  --bg: #07090d;
  --surface-1: #0c1016;
  --surface-2: #11171f;
  --surface-3: #171f29;
  --line: #222c38;
  --line-strong: #33414f;

  --text-1: #e9f0f8;
  --text-2: #9ba9ba;
  --text-3: #687789;

  --accent: #5fe7ff;
  --accent-ink: #041014;
  --warn: #ffb45c;
  --ok: #5be49b;
  --bad: #ff5f6d;

  --paper: #f3f0e8;
  --paper-ink: #15181d;
  --paper-line: #d8d2c4;
}
```

规则：**90% 中性色，10% 信号色**；一屏只允许一个“亮”的元素——大数字、纸面或印章。

### 7.3 字体

| 用途             | 字体                       | 说明                             |
| ---------------- | -------------------------- | -------------------------------- |
| 拉丁标题 / 数字  | Space Grotesk              | 工程感，tabular nums             |
| 正文             | Inter                      | 现有字体，保留                   |
| 中文             | MiSans / HarmonyOS Sans SC | 比 Noto 更几何；落地前复核许可证 |
| 数据 / ID / hash | JetBrains Mono             | 版本、时间、摘要                 |

全部自托管、子集化、`font-display: swap`；删除 [index.css](../../apps/web/src/index.css#L7) 的 Google Fonts `@import`。

### 7.4 五个标志性组件

1. **仪表读数**：56px Space Grotesk + 11px 大写标签，替代统计卡。
2. **LED 状态**：6px 方块 + 文字，替代满屏胶囊标签。
3. **门禁轨道**：七段横向电路，完成段填充青色，当前段脉冲一次。
4. **证据账本**：左侧 1px 竖线 + 6px 节点，一行 `WHO · ACTION · TARGET · VERSION · TIME`。
5. **签字印章**：1.5px 边框、等宽大写、-3° 旋转，成功后 160ms 落章；出现在回执与已批准文档上。

### 7.5 动效

- 只做状态变化：门禁填充 240ms、落章 160ms、行消失 180ms。
- 统一 `cubic-bezier(.2,.8,.2,1)`；不做无限循环背景动画。
- 骨架屏可扫光，但 `prefers-reduced-motion` 下必须停。
- 路由切换不做花哨转场；焦点和 `document.title` 要跟着变。

### 7.6 明确不要做

发光外阴影、渐变文字、粒子背景、全站毛玻璃、紫色 AI 渐变、3D 倾斜卡片、自动播放视频背景、满屏跑马灯。这些是“科技感”的廉价替代品。

### 7.7 主题落地方式

1. 先把颜色收敛到 token：`index.css` 里存在大量硬编码色值（`#fff`、`#e9edf3` 等），直接覆盖会漏。
2. 在 `<html>` 上加 `data-theme="console"`；纸张面板用局部 token 覆盖（`.paper`）。
3. 保留亮色作为后续可选主题；本期只做深色台面 + 纸张面板，不做完整亮色主题。
4. 视觉验收：正文对比度 ≥ 4.5:1，大字 / UI 边界 ≥ 3:1，焦点环可见，`reduced-motion` 生效。

---

## 8. 数据与接口

### 8.1 现有可用的读接口

| 能力            | 接口                                                                                           | 备注                    |
| --------------- | ---------------------------------------------------------------------------------------------- | ----------------------- |
| 项目列表        | `GET /v1/projects`                                                                             | 已有，Web 在用          |
| 需求列表 / 创建 | `GET/POST /v1/projects/:projectId/requirements`                                                | 无单条详情              |
| 文档列表 / 详情 | `GET /v1/projects/:projectId/documents`、`GET /v1/documents/:documentId`                       | 含 revisions            |
| 文档正文        | `GET /v1/document-revisions/:revisionId/content`                                               | base64 + sha256         |
| 评审列表 / 详情 | `GET /v1/projects/:projectId/review-requests`、`GET /v1/review-requests/:reviewId`             | 只有 id / digest / 槽位 |
| 评审决定 / 撤销 | `POST /v1/review-requests/:reviewId/decisions`、`POST /v1/review-decisions/:decisionId/revoke` | 已有票据流程            |
| 工件集          | `GET /v1/artifact-sets/:id`                                                                    | **Web 从未调用**        |
| 任务 / 流程实例 | `GET /v1/tasks/:taskId`、`GET /v1/workflow-instances/:instanceId`                              | 可拼出需求上下文        |
| 变更收件人      | `GET /v1/change-recipients?projectId=`                                                         | 只有 eventId / 版本     |
| 可开工任务      | `GET /v1/projects/:projectId/tasks/ready`                                                      | 已有                    |
| 看板            | `GET /v1/projects/:projectId/board`                                                            | 保留                    |

### 8.2 缺口

1. **没有跨项目聚合**：工作台要 N 个项目 × 3 类请求。
2. **没有单条需求详情**：`GET /v1/requirements/:id` 不存在，列表最多 50 条。
3. **没有变更事件详情**：`ChangeEvent` 有 `changedFields` / `targets`，但没有读接口。
4. **没有“我的角色”读接口**：无法在前端判断某个角色槽位是否轮到我；应由服务端返回 `viewerCanDecide`。
5. **评审视图没有标题 / 需求上下文**：`ReviewView.subject` 只对文档类有值，且未展示。

### 8.3 新增只读读模型：`GET /api/v1/workbench`

```http
GET /api/v1/workbench?projectId=<optional>
```

```json
{
  "data": {
    "counts": { "reviews": 3, "changes": 2, "readyTasks": 5 },
    "reviews": [
      {
        "reviewId": "...",
        "kind": "PRD_PUBLICATION",
        "projectId": "...",
        "projectName": "YFF",
        "requirement": { "code": "YFF-012", "title": "登录页改版" },
        "subjectLabel": "PRD v3",
        "role": { "key": "BACKEND", "title": "后端" },
        "slots": [{ "id": "...", "slotKey": "backend", "viewerCanDecide": true }],
        "ageSeconds": 259200,
        "evidence": { "artifactCount": 2, "hasPr": true }
      }
    ],
    "changes": [
      {
        "recipientId": "...",
        "eventId": "...",
        "requirement": { "code": "YFF-008", "title": "订单取消规则调整" },
        "changedFields": ["acceptance"],
        "targets": {},
        "pendingRoles": ["BACKEND", "QA"],
        "version": 4,
        "ageSeconds": 172800
      }
    ],
    "readyTasks": [
      {
        "taskId": "...",
        "projectName": "YFF",
        "requirement": { "code": "YFF-009", "title": "支付回调重试" },
        "role": { "key": "BACKEND", "title": "后端" },
        "stepKey": "backend-impl"
      }
    ]
  },
  "meta": { "requestId": "..." }
}
```

约束：

- 只返回当前用户是成员的项目；权限过滤必须复用现有 authorization service。
- 只读，无写入，无 schema 迁移。
- 先接受“每项目复用现有 service”的 N 次查询；加 30 秒缓存，后续再合并 SQL。
- `viewerCanDecide` 由服务端根据 principal、角色槽位、已有决定派生。

### 8.4 `ReviewView` 增量字段

| 字段                      | 类型                      | 说明                                                 |
| ------------------------- | ------------------------- | ---------------------------------------------------- |
| `subjectLabel`            | `string`                  | 文档标题 / 任务步骤的人类可读标签                    |
| `requirement`             | `{ code, title } \| null` | 关联需求；文档类通过 `document.requirementId` 单独查 |
| `slots[].viewerCanDecide` | `boolean`                 | 当前用户是否可对该槽位作出决定                       |
| `decisions[].actor`       | `{ id, name, email }`     | 决定人；现在只有 `createdById`                       |

均为 additive，不改变现有调用方。

### 8.5 后续只读接口（M4）

- `GET /v1/requirements/:requirementId`：需求详情 + 任务 / 评审 / 变更 / 工件摘要。
- `GET /v1/change-events/:eventId`：变更字段与影响面（或直接由 `/workbench` 返回）。
- 可选：`GET /v1/projects/:projectId/me`：我的业务角色，用于非工作台场景。

### 8.6 不做

- 不新增 `SignOff` 表；现有 `ReviewDecision` 就是签字记录。
- 不为了文档→需求加外键；用单独查询解决。
- 不改票据、密码、CSRF、幂等、审计写入路径。

---

## 9. 实施计划

### 9.1 里程碑

| 里程碑          | 内容                                                                                      | 人日  | 依赖 | 可演示结果                       |
| --------------- | ----------------------------------------------------------------------------------------- | ----- | ---- | -------------------------------- |
| **M0 读模型**   | `GET /workbench`；`ReviewView` 增量字段；契约测试                                         | 0.5–1 | 无   | 一条请求拿到工作台首屏           |
| **M1 工作台**   | 视觉 token + 壳层 + 工作台 + 徽标；任务认领移出 Web；创建流程实例收进管理员并强制显式绑定 | 2–3   | M0   | 登录后看到“谁在等我”             |
| **M2 决定页**   | `/reviews/:reviewId`；文档 / 工件证据；一次确认；回执                                     | 3     | M1   | 从待办进入、看证据、签字、拿回执 |
| **M3 说人话**   | 字典 / 名称解析 / 错误条 / 设置页 IA / 可访问性                                           | 1–2   | M2   | 0 裸 UUID；键盘可走完            |
| **M4 需求详情** | `GET /requirements/:id`；`/requirements/:code`；门禁 + 时间线                             | 2–3   | M0   | 一条需求的全链路可追溯           |

合计 **8.5–12.5 人日**。一人约两周；两人并行（后端读模型 + 前端视觉）可压到一周半。

### 9.2 顺序与并行

```text
M0 读模型 ──┬─> M1 工作台 ──> M2 决定页 ──> M3 说人话 ──> M4 需求详情
            │
            └─> 视觉 token / 字体 / 组件底座（与 M1 并行）

内容字典 / 文案（与 M2 并行）
E2E 用例（M2 开始写，M3 跑通）
```

### 9.3 实施前提

- 当前工作树有未提交改动，M0 前先提交或 stash；本计划默认 additive，不重命名现有文件。
- 联调需要可用的 dev PostgreSQL + API；没有则先用 mock + contract test，M2 再做真实联调。
- 不删旧页面；新路由优先，验收通过后再清理 `Reviews.tsx` 的旧详情视图。

### 9.4 技术选择

| 决策            | 选择                                              | 理由                                                                 |
| --------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| 数据请求 / 轮询 | `@tanstack/react-query`（已在依赖里，当前未启用） | 缓存、窗口聚焦刷新、`refetchInterval`、局部错误隔离；不用自己写轮询  |
| Markdown 渲染   | `react-markdown` + `remark-gfm`                   | 默认不渲染 raw HTML，避免 XSS；替换 `<pre>` 纯文本                   |
| Diff            | `diff`（jsdiff）或自写 LCS                        | 现有按行号对齐会在插入一行时全量误报                                 |
| 状态管理        | 不新增                                            | 现有 zustand 只放 auth / project / toast；服务端状态交给 React Query |
| 清理            | 移除未使用的 `axios`                              | 当前所有请求走 `fetch`                                               |
| 样式            | 复用已有 `wb-*` / `gate-*` / `evidence-*` 类      | 约 50 个类已写好，只缺组件                                           |

运行时新依赖控制在三个以内（Playwright 为 devDependency）；M2 首屏不加载 Markdown / diff 解析，按需动态引入或仅在决定页加载。

---

## 10. 验收标准

### 10.1 里程碑验收

| 里程碑 | 验收                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| M0     | 契约测试通过；10 个项目规模下 p95 < 300ms；无写入；权限过滤有测试                                                                               |
| M1     | 待办 0 裸 UUID；登录 → 工作台 → 决定页 ≤2 点击；空 / 错 / 加载三态分离；徽标数正确                                                              |
| M2     | 文档类看到正文 + diff + 验收；工件类看到 sha256 / commit / checks；决定记录显示决定人；一次 `ConfirmationPrompt` 完成；回执可复制；失败原样展示 |
| M3     | 字典覆盖率 100%；正文对比度 ≥ 4.5:1；键盘可完成签字；`reduced-motion` 生效；旧路径重定向正确                                                    |
| M4     | `/requirements/:code` 可直接打开；门禁七段与后端一致；时间线含决定 / 变更 / 交付                                                                |

### 10.2 全局指标

- 进入工作台到提交签字 **≤3 次点击**、≤60 秒；
- 待办列表 **0 个裸 UUID**；
- 签字前证据可见率 **100%**；
- 待办平均年龄、变更 ack 中位时延可在工作台看到；
- TTFV（从 clone 到第一条需求被签字）**≤30 分钟**（与定位指标对齐）。

---

## 11. 测试与质量

- **API**：`workbench` 契约测试 + 权限用例（非成员项目不出现、角色槽位不越权）；复用现有 `apps/api/test` 风格。
- **Web**：Vitest + Testing Library，沿用现有 `mockFetch` 模式；新增 `Workbench` / `DecisionPage` 行为测试，不做纯快照。
- **E2E**：新增 Playwright（现有 `test:e2e` 是 API 集成，不是浏览器）一条主路径：登录 → 工作台 → 决定页 → 签字 → 回执 → 下一条。
- **视觉**：关键页截图对比（工作台、决定页、回执）；`axe` 或手工检查对比度 / 焦点 / 语义。
- **性能**：工作台首屏不阻塞；字体子集化；不在首屏引入 Markdown / diff 解析。

---

## 12. 风险与对策

| 风险                           | 影响 | 对策                                                          |
| ------------------------------ | ---- | ------------------------------------------------------------- |
| 聚合接口泄露越权项目           | 高   | 只复用 authorization service 做过滤；加“非成员项目不出现”测试 |
| N+1 查询拖慢工作台             | 中   | 30 秒缓存 + 项目数上限；后续合并 SQL                          |
| CSS 硬编码颜色导致深色主题遗漏 | 中   | 先 token 化再换主题；关键页截图对比                           |
| 字体许可证 / 体积              | 中   | 选 OFL / 可免费商用字体；子集化；落地前复核                   |
| 范围蔓延到执行平台             | 高   | 以“决定页”为界；非目标写进评审 checklist                      |
| 旧工作树冲突                   | 中   | additive 文件为主；M0 前提交 / stash                          |
| 文档继续漂移                   | 中   | M3 按当前实现更新 README 的 Web 描述                          |

**回滚**：新路由 + 新组件，旧页面保留；`/` 可切回旧工作台；API 均为只读增量，回滚不影响写入链路。

---

## 13. 开源借鉴与边界

> 这一节不是“选型”，是“别重造轮子”的边界说明。详细对比见讨论记录；落地时以各仓库 LICENSE 为准。

| 项目                                                                                                                                                       | 可借鉴                                                                     | 不要照搬                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| [Warrant](https://github.com/mv2a/warrant)                                                                                                                 | `intent / promise / check / evidence / gate / ledger` 词汇；隐藏检查防作弊 | 它只做代码 merge/release，且是 v0.1 单人项目          |
| [Microsoft AGT](https://github.com/microsoft/agent-governance-toolkit)                                                                                     | 策略引擎、零信任身份、审计、`require_approval` 的结构                      | 它是运行时 tool-call 治理，不是交付物签字             |
| [HumanLayer](https://github.com/humanlayer/humanlayer)                                                                                                     | 审批收件箱、上下文呈现                                                     | 它自己跑 Agent；WorkMesh 明确不执行                   |
| [in-toto](https://github.com/in-toto/in-toto) / [Sigstore cosign](https://github.com/sigstore/cosign)                                                      | 给“签字回执”做可验证签名                                                   | 不要自建哈希链再补签名；先对齐标准                    |
| [Flowable](https://github.com/flowable/flowable-engine) / [Temporal](https://github.com/temporalio/temporal)                                               | 人工任务、超时、升级、durable execution                                    | 通用 BPM 没有交付物模型；别把 WorkMesh 做成 BPMN 前端 |
| [Spec Kit](https://github.com/github/spec-kit) / [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) / [OpenSpec](https://github.com/Fission-AI/OpenSpec) | 角色 SOP、规格 → 计划 → 任务、变更提案                                     | 它们是本地工作流，没有跨人权威与证据托管              |
| [Documenso](https://github.com/documenso/documenso) / [Gerrit](https://github.com/GerritCodeReview/gerrit)                                                 | 签署仪式 / 回执；change page 的“左证据右投票”                              | Documenso 是 AGPL-3.0，不能把代码抄进 MIT 项目        |
| [Backstage](https://github.com/backstage/backstage)                                                                                                        | 目录、scorecards 的信息组织                                                | 它没有交付门禁                                        |

热度参考（2026-11）：HumanLayer ≈12.7k、Microsoft AGT ≈6.5k、Spec Kit ≈145k、OpenSpec ≈74k、Documenso ≈15.6k、Gerrit ≈1.2k；Warrant 仍是个位数 star 的实验。热度只说明生态位置，不说明适配度。

**最接近的四个**：

- **Warrant** 概念同构（intent → promise → check → evidence → gate → ledger），但只做代码 merge/release，v0.1、单人。
- **Microsoft AGT** 工程最完整（策略、身份、审计、`require_approval`），但管的是运行时 tool call，不是交付物版本。
- **HumanLayer** 产品形态最像“人审 Agent”，但它自己跑 Agent，已经转向执行平台；这反过来说明“只做审批层”很难独立获客。
- **Gerrit + Documenso** 是单点交互范式：change page（左证据右投票）和 signing ceremony（一次完成 + 回执），值得抄交互，不值得抄领域模型。

**结论**：WorkMesh 的护城河不是“审批 UI”，而是四件脏活——全角色交付模型、版本 + 摘要绑定、反自审、可验证证据。UI 只需把这四件脏活变得可见、可操作。许可提醒：Documenso 是 AGPL-3.0，不能把代码抄进 MIT 项目；Apache-2.0 / MIT 项目可借鉴实现，落地前仍以各仓库 LICENSE 为准。

---

## 14. 待决策项

| 编号 | 问题                                   | 建议默认                                   |
| ---- | -------------------------------------- | ------------------------------------------ |
| D1   | 工作台默认范围：全部项目还是当前项目？ | 全部项目 + 项目筛选                        |
| D2   | 决定页形态：全屏路由还是右侧抽屉？     | 全屏路由；抽屉只用于“确认变更”等短动作     |
| D3   | 是否允许新增只读接口和 additive 字段？ | 允许；不做迁移                             |
| D4   | 视觉默认：深色台面还是提供切换？       | 深色默认；文档用纸张面板；完整亮色主题后置 |
| D5   | 是否本期做 M4 需求详情？               | 先做 M0–M3，M4 视验收后排期                |

---

## 15. 附录

### 15.1 文件地图（预计）

**新增**

- `apps/api/src/workbench/workbench.controller.ts`
- `apps/api/src/workbench/workbench.service.ts`
- `apps/api/src/workbench/workbench.repository.ts`
- `apps/api/src/workbench/workbench.module.ts`
- `apps/web/src/api/workbench.ts`
- `apps/web/src/pages/ReviewDecision.tsx`
- `apps/web/src/components/TodoRow.tsx`
- `apps/web/src/components/WorkflowInstanceDialog.tsx`
- `apps/web/src/components/StatReadout.tsx`
- `apps/web/src/components/EvidencePanel.tsx`
- `apps/web/src/components/DecisionPanel.tsx`
- `apps/web/src/components/SignOffReceipt.tsx`
- `apps/web/src/components/ErrorBanner.tsx`
- `apps/web/src/lib/labels.ts`
- `apps/web/src/lib/relativeTime.ts`
- `apps/web/src/lib/diff.ts`

**修改**

- `apps/web/src/pages/Workbench.tsx`（重写）
- `apps/web/src/pages/Board.tsx`（只读，移除认领）
- `apps/web/src/pages/Requirements.tsx`（管理员初始化 + 显式绑定）
- `apps/web/src/App.tsx`（路由改造：`useRoutes` / `matchPath`）
- `apps/web/src/main.tsx`（`QueryClientProvider`）
- `apps/web/src/nav.ts`（收敛 + 徽标）
- `apps/web/src/api/resources.ts`（artifact API / 增量字段类型 / 移除 Agent-only 方法）
- `apps/web/src/index.css`（token + 主题 + 组件样式）
- `apps/api/src/reviews/v1-review.prisma-repository.ts`（增量 include / 字段）
- `apps/api/src/reviews/v1-review.repository.ts`（类型）

### 15.2 路由地图

```text
/                         工作台
/reviews                  评审收件箱
/reviews/:reviewId        决定页
/requirements             需求列表
/requirements/:code       需求详情（M4）
/projects                 项目
/settings/members         成员与角色（M3）
/settings/device          设备授权（M3）
/settings/acl             知识库 ACL（M3）
/profile                  用户中心
```

### 15.3 术语

| 术语         | 含义                                                              |
| ------------ | ----------------------------------------------------------------- |
| 待办         | 需要当前用户做出动作的评审 / 变更 / 可开工任务                    |
| 决定页       | 一个待办的证据 + 动作 + 回执的完整页面                            |
| 槽位（slot） | 评审中一个必须被满足的审批位置                                    |
| 回执         | 决定成功后的可复制审计记录（人 / 时间 / 版本 / 摘要 / requestId） |
| 证据         | 正文、diff、验收标准、工件、commit / PR、历史决定                 |

### 15.4 参考

- [项目定位](../positioning.md)
- [工作台与需求详情交互方案](workbench-and-requirement-detail.md)
- [SPEC](../../spec/SPEC.md)
- [API 清单](../api.md)
- [当前状态](../phase-status.md)
