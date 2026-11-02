# WorkMesh 技术规格 v1：身份、权限与人工确认

日期：2026-11-01。状态：待实施的技术规格，不是已实现能力。本文只定义身份与授权契约，不授权修改应用、执行迁移、操作真实数据库、运行服务或外发数据。

**目标：** 将 Web 人工身份、受限 Agent 身份、项目管理、业务角色和知识库授权分别建模，让发布与批准只通过绑定准确版本的一次性人工确认成立。

**技术边界：** 延续 NestJS、Prisma、PostgreSQL 和模块化单体。Web 使用服务端 opaque 会话；CLI 通过浏览器设备授权取得 Agent 凭据。核心认证、撤销、限流和票据均依靠 PostgreSQL，不依赖 Redis、SSO 或 MFA。

本分册是 `Principal`、`PrincipalStamp`、`WebSession`、`AgentCredential`、`CliAuthorizationRequest`、`CliAuthorizationView`、`AuthRateWindow`、`ConfirmationTicket`、`ProjectMember`、`ProjectRole`、`ProjectRoleAssignment`、`KnowledgeBaseGrant`、`AuditEvent` 和认证路由的权威定义。领域分册定义知识库主体、修订、任务、审批槽位和工件，本分册只引用其 ID、版本和业务内容摘要。

## 1. 当前源码与替换范围

静态核对依据：

| 当前入口 | 当前行为 | v1 的处理 |
| --- | --- | --- |
| `apps/api/src/auth/auth.service.ts`、`auth.guard.ts`、`auth.controller.ts` | Web/CLI 共用 access/refresh JWT；JWT 带全局 role；刷新令牌落库 | 统一替换为本文会话和 Agent 凭据；不提供旧 JWT 的兼容鉴权或刷新路由 |
| `apps/api/src/projects/project-access.service.ts` | 主要按项目成员身份检查知识访问 | 增加当前成员、业务角色、KB ACL 和凭据子范围的逐动作判断 |
| `apps/api/src/projects/projects.service.ts` | 项目创建产生 OWNER；管理成员角色与业务角色未分开 | 管理角色保留；业务角色改为独立记录和显式分配 |
| `apps/api/src/knowledge/knowledge.service.ts`、`knowledge.controller.ts` | 知识读写主要以成员检查为门槛 | 所有正文及派生路径统一执行 KB READ/PROPOSE/PUBLISH/REVOKE |
| `apps/api/src/signoff/signoff.controller.ts`、`signoff.service.ts` | DTO 接受 `actorType`；签字按用户 ID 执行 | 删除自报身份入口；签字必须使用 HUMAN Web 会话、准确版本和一次性票据 |
| `apps/api/prisma/schema.prisma` | 存在 User、RefreshToken、ProjectMember、RoleType 和覆盖式 SignOff | 保留用户及历史业务数据；新建本文关系，由单独迁移方案处理旧表映射，不授权删表或删数据 |

仓库处于已有大量未提交改动的 `main` 分支。上述结论来自本次静态阅读，不表示已有认证、API 或数据库验证通过。旧数据不自动取得新的有效批准资格；移除旧认证能力与删除旧记录是两件事。

## 2. 凭据类别与信任边界

### 2.1 运行时 Principal

所有受保护入口只接受认证 Guard 放入请求上下文的对象：

```ts
type Principal = {
  kind: 'HUMAN' | 'AGENT';
  userId: string;
  agentCredentialId?: string;
  projectId?: string;
  roleIds?: string[];
  scopes: string[];
};
```

HUMAN 只来自有效 WebSession；AGENT 只来自有效 AgentCredential。HUMAN 的 `agentCredentialId` 必须缺省；AGENT 的 `agentCredentialId`、`projectId` 和仅含一项的 `roleIds` 必须存在。项目无关请求不设置 HUMAN 的 projectId/roleIds；项目动作在服务端解析项目后，从当前关系补充这两个值。HUMAN 的 scopes 只作本次动作能力的运行时结果，不是客户端令牌声明。

请求体、查询参数和自定义 header 中的 `actorType`、`kind`、`userId`、`roleIds`、`isAdmin` 等不能改变 Principal。DTO 没有声明的身份字段以 `400 INVALID_REQUEST` 拒绝，不静默采纳。用户 ID 作为被管理对象出现时，必须有明确的 `subjectUserId`/路径语义。

`User.role` 等旧全局角色不进入项目、知识、发布或批准判断。部署维护者不能以全局 ADMIN/SUPER_ADMIN 在业务 API 中绕过项目关系；首版不提供超级管理员读取受限内容的业务后门。

### 2.2 唯一的 Agent scope 注册表

scope 是区分大小写的有限字符串，不支持 `*`、前缀通配、角色名替代或客户端扩展：

| scope | 允许的操作；仍须满足当前业务条件 |
| --- | --- |
| `project:read` | 读取本凭据项目的非敏感项目元数据、可见成员及业务角色 |
| `workflow:read` | 读取已授权流程定义、选定版本及角色包契约 |
| `workflow:propose` | 创建或修改流程定义候选；不发布配置、不切换实例版本 |
| `requirement:read` | 读取可见需求及当前共享决定；引用受限知识时逐项过滤 |
| `requirement:propose` | 创建需求、理解、PRD 候选及候选修订；不确认理解、不发布基线 |
| `clarification:write` | 提交澄清、答复、落实证据；不代替正式理解确认或基线批准 |
| `knowledge:read` | 读取当前 KB READ 允许的发布正文、索引、检索和附件 |
| `knowledge:propose` | 在当前 KB PROPOSE 允许的库内提交候选；不发布或撤销发布 |
| `task:read` | 读取本项目任务及有权读取的工件元数据 |
| `task:claim` | 以本凭据的唯一业务角色持久认领；不认领其他角色任务 |
| `task:release` | 显式释放本凭据自己持有的认领；不以授权人的身份释放其其他凭据的认领 |
| `task:deliver` | 对本凭据当前有效认领交付；不设 DONE/TESTED/RELEASED |
| `context:read` | 读取当前仍有权访问的快照内容；快照不冻结 ACL |
| `context:create` | 为当前有权操作的任务创建确定版本快照 |
| `review:read` | 读取有权查看的评审请求与决定 |
| `review:request` | 创建独立人工评审请求；不批准、不拒绝、不撤销批准 |
| `change:read` | 读取发给本 userId 和凭据业务角色的可见变更 |
| `change:ack` | 代表本角色确认收到变更；不恢复任何旧批准 |

默认勾选八项只读 scope：`project:read`、`workflow:read`、`requirement:read`、`knowledge:read`、`task:read`、`context:read`、`review:read`、`change:read`。写 scope 必须由浏览器授权页明确展示并勾选，不因本地包、CLI 参数或个人规则自动增加。

Agent 永远不能获得项目成员/角色/KB ACL 管理、流程配置发布、知识发布或撤销、理解确认、需求基线发布、批准决定、模型外发授权、代码连接管理等能力。即使把这些动作名放进 scopes，也以 `422 UNSUPPORTED_SCOPE` 拒绝。增加管理角色、拥有多个业务角色或创建自定义 roleKey，均不会改变这条底线。

### 2.3 当前权限交集

对每次读取和写入，服务端按以下顺序判断，不只在凭据签发时判断：

1. 凭据存在、未过期/撤销，User active 且 `authVersion` 与凭据绑定值相同。
2. 解析目标真实项目，不从提交的 projectId 覆盖它；校验当前活动 ProjectMember。
3. AGENT 的 projectId 必须完全相同；其唯一 ProjectRole 和对应 ProjectRoleAssignment 仍须活动。
4. AGENT 必须具有路由要求的 scope；实际权限还要与授权人现在的关系求交集。
5. 检查目标业务角色、责任人/认领、当前版本、工作状态及依赖条件。
6. 有知识内容时，对每个实际 KB 检查同一 ACL，包括标题、摘要、切片、检索计数、快照和附件；不能先取正文再靠 UI 隐藏。
7. protected action 继续要求 HUMAN 会话、当前 Origin/CSRF 和一次性确认票据。

权限变更不能等待缓存、索引任务、JWT 到期或异步事件。写动作在 Serializable 事务内重新读取这些条件；读取以单次数据库查询/一致读取完成 ACL 过滤，返回前不使用过期授权缓存。Redis 故障不改变判断。

### 2.4 无法由同一凭据证明“人在操作”

HTTP 服务无法从同一份 cookie、密码或 bearer 的使用方式识别人还是脚本。HUMAN 表示“通过 Web 会话及当次密码验证的账号”，不表示密码输入一定来自物理人在场。自动化若取得人类 cookie 和密码，服务端不能仅凭 user-agent、鼠标事件、actorType 或提示词发现代签。

本文通过不向 CLI 下发人类凭据、严格分离凭据类别、受限 Agent scope、同源写保护、独立 Web 展示、逐动作密码验证和审计降低误用；不宣称形成抗钓鱼 MFA、可信执行环境或密码持有人之间的不可抵赖证明。人类会话、密码和一次性票据均不得交给本地 Agent、记录到 CLI 配置或上传模型。

## 3. Web 会话：同源 opaque cookie 与 CSRF

### 3.1 固定部署方案

生产默认是一个 HTTPS origin，通过反向代理把 Web 与 `/api/v1` 放在同一 origin。API 不为其他 origin 开启 credentialed CORS。代理的信任来源由显式配置限定，不能根据任意 Host、Origin 或 Forwarded header 自动关闭 Secure。

| 属性 | 生产 | 明确启用的本地开发例外 |
| --- | --- | --- |
| 会话 cookie | `__Host-wm_session` | `wm_session` |
| CSRF cookie | `__Host-wm_csrf` | `wm_csrf` |
| scheme/host | HTTPS，同源 | HTTP，仅 `localhost` 或 `127.0.0.1`，Vite 将 `/api` 代理至本地 API |
| Secure | true | false |
| HttpOnly | session=true；csrf=false | 相同 |
| SameSite / Path / Domain | Lax / `/` / 不设置 | 相同 |

开发例外只能通过服务端 `cookieMode=LOCAL_INSECURE` 显式开启，且服务端配置的 publicOrigin 必须是上述 loopback host；其他组合启动配置校验失败。默认 `cookieMode=SECURE`。这只是未来配置契约，本次不读取或改写任何环境文件。跨主机 HTTP、LAN IP 和生产环境不适用开发例外。

session、CSRF、deviceCode、票据和 Agent secret 均使用操作系统 CSPRNG 生成 32 字节，base64url 无填充编码为 43 字符。服务端只保存 SHA-256 lowercase hex 摘要，使用常量时间比较；不在 URL、业务日志、审计明细、错误 details 或链路追踪中记录原值。session cookie值格式为 `wm_s1.<sessionId>.<secret>`，csrf cookie为单独43字符原值；Guard按sessionId定位后比较SHA256(secret)，数据库不保存完整cookie。

### 3.2 生命周期和请求规则

`GET /auth/session` 是会话 bootstrap：缺少/无效会话时建立 10 分钟匿名 WebSession，设置会话与 CSRF cookie，返回 csrfToken。已有有效会话且 CSRF cookie 摘要匹配时复用它；缺失时仅轮换 CSRF，不轮换账号。匿名会话无任何业务权限。所有认证响应、个人信息、正文/快照及ACL响应使用 `Cache-Control:no-store`，不允许CDN或service worker缓存；session Set-Cookie的Max-Age为绝对剩余秒数，服务端仍执行更短idle检查；匿名cookie Max-Age=600，登录cookie Max-Age=28800。

登录/注册必须先 bootstrap，并携带 Origin 和 `X-CSRF-Token`。成功后撤销旧匿名或已登录会话，轮换两个随机值，建立 8 小时绝对有效期、30 分钟 idle timeout 的已登录会话。请求只向后延长 `lastSeenAt/idleExpiresAt`，不得越过 expiresAt；过期后重新登录，没有 refresh API。登出撤销行并清 cookie。

所有 cookie 认证的非安全方法（POST/PUT/PATCH/DELETE，包括登录、注册、登出）必须同时满足：Origin 完整精确匹配 configured publicOrigin；`X-CSRF-Token` 与 CSRF cookie 相同，且其摘要匹配本 WebSession。Origin 缺失、`null`、额外端口或相似子域一律拒绝。GET/HEAD 不执行业务写操作；bootstrap 仅产生匿名认证材料。

Agent bearer 路由不依赖 cookie/CSRF；它不因缺少 CSRF 获得人类专属权限。一个请求同时带 Authorization 和任一会话 cookie 时以 `400 CREDENTIAL_CONFLICT` 拒绝，不设“优先取更高权限”的规则。Web 页面不把 session 或密码存入 localStorage/sessionStorage，不把 csrfToken当 bearer。

已登录 WebSession 每次检查 User active、authVersion、revokedAt、expiresAt 和 idleExpiresAt。修改密码、账号停用或 `logout-all` 在同一事务中递增 User.authVersion，撤销该用户所有 WebSession、AgentCredential 和未消费 ConfirmationTicket；本次会话也清除，用户需重新登录。退出单个会话不撤销其已授权 Agent，Web 需单独展示并提供凭据撤销。

密码沿用 bcrypt cost=12，哈希列不返回客户端；新密码为 12–72 个 Unicode code point 且 UTF-8 总字节数不超过 72，不 trim、不截断、不要求特定字符组合。登录与二验同样拒绝超过 72 字节输入，避免 bcrypt 的静默截断。已有满足输入界限的 bcrypt 哈希可验证，不自动变更其密码；超界旧账号通过另行授权的密码重置处理，不能绕过认证。首版不新增邮件重置、SSO、MFA 或邮箱所有权验证；email 仅是登录标识，不能作为已验证的外部代码托管身份。

## 4. CLI 浏览器设备授权与响应丢失恢复

### 4.1 不把人类 refreshToken 搬到 CLI

CLI 在本地生成独立的 codeVerifier 和 credentialSecret，各 32 随机字节。`codeChallenge=base64url(SHA256(ASCII(codeVerifier)))`，`credentialSecretHash=hex(SHA256(ASCII(credentialSecret)))`。二者不能相同或相互派生。服务端从不接收 credentialSecret 明文，也不在批准页或 poll 响应中返回它。

固定时序如下：

1. CLI 先保存本次临时恢复文件，再 POST 创建设备请求。服务端生成 authorizationId、deviceCode、userCode，保存 hash，不创建 AgentCredential。
2. CLI 打开固定 `/cli/authorize` 页面，并在终端显示 userCode。verificationUri 只含固定页面路径，不附 deviceCode、userCode、verifier、凭据或重定向地址。用户在页面手工输入 userCode；页面通过 POST lookup 查询。
3. Web 已登录用户看到 clientName、创建时间、到期时间，选择自己当前具备的一个 projectId、一个 roleId 和有限 scope；默认只读。授权页不得自动勾选写操作。它展示的用户提供 clientName 是不可信标签，不证明工具来源或完整性。
4. 浏览器调用 action-preview 和密码二验创建 `AGENT_CREDENTIAL_AUTHORIZE` 票据，再以该票据 approve。批准事务把准确 project/role/scopes/有效期写入请求，不立即签发凭据。
5. CLI 每 5 秒 POST poll，携带 authorizationId、deviceCode 和 codeVerifier。服务端常量时间验证两个 proof，Serializable 事务将 APPROVED 只消费一次，创建 AgentCredential，tokenHash 使用创建请求时锁定的 credentialSecretHash，记录 credentialId，状态变 ISSUED。
6. poll 只返回 credentialId、授权人 userId、projectId、roleId/roleKey、scopes、expiresAt。CLI 拼装 `wm_a1.<credentialId>.<credentialSecret>` 并原子存入凭据存储；删除临时 verifier/deviceCode。bearer 从此只作为 AGENT 使用。

成功lookup在服务端写入 `CliAuthorizationView`，绑定 authorizationId、当前userId和webSessionId，至设备expiresAt失效。approve、deny、相应preview和ticket创建都要求本会话有这条view，不接受只知道UUID就操作。另一会话可以用同短码建立自己的view，但批准事务只允许一个人成功；session轮换/过期后重新输入短码。view不授予项目、角色或内容权限。Web明确要求确认“这是你刚刚在本机发起的CLI登录”；仅凭短码不能证明远端工具可信，勿批准他人发来的授权请求。

userCode 使用不含易混淆字符的 Crockford Base32 字母表 `0123456789ABCDEFGHJKMNPQRSTVWXYZ`，长度 10；输入先去掉显示用连字符和空格，再转大写，其他字符拒绝。数据库只存规范化值 SHA-256；短码碰撞重生成，不覆盖另一请求。

设备请求从 createdAt 起有效 10 分钟，包括等待批准和首次 poll 消费。approve/deny 只能在有效期内且 PENDING 时执行。默认 Agent 有效期 7 天；浏览器可选 `expiresInDays` 的整数 1–30，`AgentCredential.expiresAt=approvedAt+expiresInDays×24小时`，poll不得改变它。没有 refresh；到期后重新进行浏览器授权。所有时间判断使用数据库当前时间，终端或浏览器时钟不参与授权有效性。

### 4.2 状态和恢复边界

`PENDING → APPROVED → ISSUED` 是成功路径；PENDING 可以变 DENIED，PENDING/APPROVED 超时变 EXPIRED。ISSUED 不重新变 APPROVED。不靠 CLI 自报“批准过了”恢复。

| 中断点 | 固定处理 |
| --- | --- |
| create 请求响应丢失 | CLI 不知道 deviceCode，放弃该请求并重新创建；旧请求 10 分钟失效，不曾创建凭据。禁止猜测或按 clientName 查询秘密 |
| 用户批准后 CLI 离线，首次 poll 前过期 | 请求 EXPIRED，不签发凭据；用户重新授权 |
| 首次 poll 已提交但响应丢失 | 保留本地 verifier/secret/deviceCode；用相同 proof 在 `issuedAt+10分钟` 内重取同 credential metadata，不新增凭据 |
| poll 响应收到但本地落盘失败 | 同上一规则恢复；先完成受限原子落盘再清临时文件 |
| issued 恢复窗口已过或临时 secret 丢失 | 不回传或重建 secret；重新授权，用户可在 Web 撤销遗留凭据 |
| 已签发凭据被撤销或授权人失去角色 | poll 恢复和 bearer 使用均拒绝，不返回成功假象 |

ISSUED 的恢复窗口只返回原有 metadata，不延长凭据期限。恢复也重新校验用户、membership、role assignment、credential 未撤销。deviceCode hash、challenge 和 secret hash 不允许在批准后替换；错误 verifier 不推进状态。

poll 间隔小于 5 秒返回 `429 AUTHORIZATION_SLOW_DOWN`、`Retry-After: 10`，同时将该请求下一次允许时间设为当前时刻加 10 秒；正确 proof 后才返回其状态。无效 proof 统一 `401 AUTH_INVALID`，不区分 authorizationId 是否存在。Web deny 需要 HUMAN+Origin+CSRF，但不需要密码票据，因为它不授予任何能力。

## 5. 项目管理、业务角色和知识权限

### 5.1 管理角色不等于业务角色

ProjectMember.role 只有 OWNER/ADMIN/MEMBER，表示项目治理权限。ProjectRole 是独立业务角色，默认 key 为 product/ui/frontend/backend/qa/ops。每个 key 在项目内稳定且不可改名；title 可改。自定义 key 使用 `^[a-z][a-z0-9-]{0,47}$`，不能与默认 key 冲突。任务、流程、角色包和审批槽位引用 roleId，不以 enum 或展示 title 作为唯一身份。

创建项目在同一事务内创建六个默认 ProjectRole、创建者的 OWNER membership，以及创建者对六个角色的六条显式 ProjectRoleAssignment。此初始化写入审计。后续加入 OWNER/ADMIN/MEMBER 不自动获得业务角色；由 OWNER/ADMIN 逐项明确授予。一个人可以持有多个业务角色，每次决定选择一个准确 roleSlot 并独立记录，不强制所有决定两人会签。

每项目恰有一个活动 OWNER；转移使用独立事务，将原 OWNER 降为 ADMIN、新 OWNER 提为 OWNER，业务角色与 KB grants 均保持原样，不随管理头衔复制。ADMIN 不能授予/撤销 ADMIN 或 OWNER、修改 OWNER、移交所有权；OWNER 可以管理 ADMIN。ADMIN 只可增删 MEMBER 和分配业务角色。业务角色停用不删除历史，当前任务返回 ROLE_INACTIVE 阻塞，不把该角色的必需门槛当成已裁剪。

### 5.2 权限矩阵

表内“有条件”指仍需当前角色/KB/责任关系，并非头衔继承。

| 动作 | OWNER | ADMIN | MEMBER | AGENT |
| --- | --- | --- | --- | --- |
| 项目元数据/可见成员读取 | 是 | 是 | 是 | `project:read`，限本项目 |
| 项目元数据修改、流程配置发布、KB ACL 管理、外发 allowlist 管理、代码连接管理 | 是，Web 票据 | 是，Web 票据 | 否 | 否 |
| 添加/移除 MEMBER、授予/撤销业务角色 | 是，Web 票据 | 是，Web 票据 | 否 | 否 |
| 添加/修改 ADMIN、OWNER 转移、项目归档 | 是，Web 票据 | 否 | 否 | 否 |
| 业务候选、认领、交付 | 按当前业务角色 | 按当前业务角色 | 按当前业务角色 | 当前单角色+scope+owner当前权限 |
| 理解确认、基线发布、审批槽位决定 | 当前所需角色+Web 票据 | 相同 | 相同 | 否 |
| KB READ/PROPOSE/PUBLISH/REVOKE | 按 KB 规则，不旁路 | 相同 | 相同 | 仅 READ/PROPOSE 且对应 scope |
| 撤销本人的 Agent 凭据 | Web 票据 | Web 票据 | Web 票据 | 只能自撤销当前凭据，不撤销其他凭据 |
| 释放他人 claim | Web 管理动作，原因必填 | 相同 | 否 | 否 |

普通项目/候选写入仍按路由授权和版本校验；不是每个编辑都要求密码二验。密码二验覆盖第 7 节明确列出的受保护正式动作。管理员释放 claim 的 target/version/原因属于受保护动作，不授权其伪造交付。

### 5.3 KB 授权语义

KnowledgeBase 主体字段由领域分册定义：`id, projectId, key, name, visibility, authzVersion, version, publicationApproverUserId, publicationApproverRoleId, archivedAt`。本分册固定以下规则：

- `visibility=PROJECT`：所有活动项目成员默认 READ；不默认 PROPOSE/PUBLISH/REVOKE。
- `visibility=RESTRICTED`：只有命中活动 USER grant 或当前业务 ROLE grant 的活动成员才有 READ。管理头衔不参与匹配。
- grant 的 permissions 是 READ/PROPOSE/PUBLISH/REVOKE 的非空去重数组；包含其他值或非 READ 权限却缺少 READ 时以 `422 INVALID_GRANT` 拒绝。多个命中的 grant 求并集，首版无 deny 规则。
- PROPOSE 允许候选写入/修订，不允许发布。PUBLISH 和 REVOKE 分别允许发布与撤销发布，互不自动包含；两者仅 HUMAN+票据可执行。
- USER grant 可以直接授权成员，无需额外业务角色，发布时 roleSlot=null。ROLE grant 必须匹配当前活动 assignment；知识出版决定时绑定 `{roleId,approvalSlotId:slotId}`，撤销发布时绑定 `{roleId,approvalSlotId:null}`。拥有多个合法路径时由 Web 明确选择一条，不从管理头衔补造业务角色。AGENT对ROLE grant只可匹配credential.roleId，不借授权人的其他业务角色读写；USER grant仍只在本人当前有效且scope允许时匹配。
- KB 创建者必须是 OWNER/ADMIN；创建事务给其新增显式 USER `[READ,PROPOSE,PUBLISH,REVOKE]` grant，并记录授予行为。不是凭 ADMIN 头衔永久读取该库；这条 grant 撤销后按正常规则失权。
- `publicationApproverUserId` 是指定出版审批责任人，创建时设为 creator；`publicationApproverRoleId` 为 null 表示其 USER grant 路径，非空时表示明确选定的 ROLE grant 路径。创建知识出版 ReviewRequest 时只从此已发布配置生成槽位，不接受 Agent 指定审批人。修改配置经 KB_ACCESS_REPLACE 票据，保存时和每次决定时重验指定人当前的 PUBLISH；设置责任人本身不授予 READ/PUBLISH。指定人失权时阻塞，不回退为管理员或任意成员。
- OWNER/ADMIN 可通过密码二验显式给自己授予受限内容权限；必须留下授权前后差异、授予人和原因审计。不能悄悄读取再补 grant，也不把所有授权都强制两人批准。
- 撤销成员使其 USER/ROLE grant 不再生效；重新加入不自动恢复旧 grant。成员撤销事务将其 USER grants 和业务 assignments 标记 revokedAt；角色 grants 保持，但只对该角色其他活动成员有效。

管理页为了管理不可读的 KB，只返回 id、visibility、authzVersion、version、ACL 和不可读标记；不返回该库 name、description、文档标题、正文、索引或搜索统计。普通知识列表/搜索对不可读库完全不返回，直接指定不可读内容返回 `404 RESOURCE_NOT_FOUND`。ACL 管理接口本身只向 OWNER/ADMIN 返回，不对普通成员暴露受限库存在性。

grant、visibility 或角色/成员授权变化，在同一事务内递增受影响 KnowledgeBase.authzVersion 并追加审计。读快照、附件、缓存结果、检索命中、摘要和切片前都检查当前权限；索引清理失败不构成继续返回内容的理由。已下载到用户电脑的历史字节无法被服务端远程收回，CLI 应标记副本失权，但不得宣称销毁所有离线副本。

### 5.4 默认不外发

平台管理的模型调用、摘要、向量、日志处理默认不能外发知识。OWNER/ADMIN 可以经密码票据批准项目的具体提供商连接和内容范围；内容还须满足当前 KB READ，提供商批准不授予内容读取权。授权记录、配置版本与实际外发审计不可混为一次“全项目永久允许”。该业务实体和提供商适配由其他分册定义。

用户从授权下载后在自己的本地工具中如何使用内容，平台不能技术上完全监测；CLI 必须展示适用政策，不把设备授权或知识读取成功表述为已获任意模型外发许可。

## 6. 实体字段、约束与持久身份

### 6.1 通用数据库约定

公开 ID 是 UUID 字符串；新 ID 使用 UUID v4。数据库类型写为 PostgreSQL `uuid`，现有 text ID 的转换单独迁移，不由本计划直接执行。version/authVersion/authzVersion 等均为 `integer NOT NULL DEFAULT 1 CHECK >=1`。时间为 `timestamptz(3)`，API UTC ISO-8601。hash 是 `char(64)` lowercase hex；CSPRNG 原值不入库。`?` 表示可空，其他字段 NOT NULL。

本文实体均保留审计和撤销历史，不提供硬删除 API；引用 User、Project、角色、凭据、会话、票据和历史 stamp 的外键使用 `ON DELETE RESTRICT`。过期认证临时记录的物理清理属于另行留存操作，不能通过级联删除抹去业务决定。表中列出的组合 FK/partial index 由显式 SQL migration 表达，不能以 Prisma schema 的表达限制跳过约束。数组CHECK复用migration内声明的不可变SQL函数 `wm_valid_set(values text[],allowed text[]) returns boolean`，语义固定为非空、元素非null、cardinality等于去重后数量且全部属于allowed；该函数不访问业务表。scope/permission的allowed数组写死于对应CHECK，增加注册值必须随迁移更新。

### 6.2 User 与项目授权实体

| 实体 | 精确字段 |
| --- | --- |
| User（本文修改部分） | `id uuid PK; email varchar(254); passwordHash varchar(255); name varchar(80)?; isActive boolean=true; authVersion int=1; createdAt timestamptz; updatedAt timestamptz; lastLoginAt timestamptz?`。现有 organization/profile 列保留，不作为内容权限 |
| ProjectMember | `projectId uuid; userId uuid; role enum(OWNER,ADMIN,MEMBER); version int=1; grantedById uuid; grantedAt timestamptz; revokedAt timestamptz?; revokedById uuid?; updatedAt timestamptz`；PK(projectId,userId) |
| ProjectRole | `id uuid PK; projectId uuid; key varchar(48); title varchar(80); isActive boolean=true; version int=1; createdById uuid; createdAt timestamptz; updatedAt timestamptz` |
| ProjectRoleAssignment | `id uuid PK; projectId uuid; userId uuid; roleId uuid; version int=1; grantedById uuid; grantedAt timestamptz; revokedAt timestamptz?; revokedById uuid?; updatedAt timestamptz` |
| KnowledgeBaseGrant | `id uuid PK; projectId uuid; knowledgeBaseId uuid; subjectKind enum(USER,ROLE); subjectUserId uuid?; subjectRoleId uuid?; permissions text[]; version int=1; grantedById uuid; grantReason varchar(1000); grantedAt timestamptz; revokedAt timestamptz?; revokedById uuid?; updatedAt timestamptz` |

约束和索引：

- User：UNIQUE(email)，写入 trim+lowercase；密码原文不 trim。账户停用递增 authVersion。既有 Organization 只作项目命名空间，不因属于同组织自动成为项目成员。
- ProjectMember：FK projectId→Project、userId/grantedById/revokedById→User；活动 OWNER 的 partial UNIQUE(projectId) WHERE role=OWNER AND revokedAt IS NULL；INDEX(userId,revokedAt,projectId)。OWNER 存在性由创建/转移/撤销事务和专门不变量测试保证。
- ProjectRole：FK projectId→Project，createdById→User；UNIQUE(projectId,key)、UNIQUE(projectId,id)，INDEX(projectId,isActive)。key 创建后不可修改。
- ProjectRoleAssignment：FK(projectId,userId)→ProjectMember，FK(projectId,roleId)→ProjectRole(projectId,id)，授予/撤销人→User；UNIQUE(projectId,userId,roleId)、UNIQUE(projectId,id)，INDEX(projectId,roleId,revokedAt)、INDEX(userId,projectId,revokedAt)。重复授权只可按 expectedVersion 更新原行，不能平行建立第二条活动关系。
- KnowledgeBaseGrant：FK(projectId,knowledgeBaseId)→KnowledgeBase(projectId,id)；USER 分支 FK(projectId,subjectUserId)→ProjectMember；ROLE 分支 FK(projectId,subjectRoleId)→ProjectRole；授予/撤销人→User。CHECK 恰好一个 subject ID 非空且符合 subjectKind；CHECK permissions 非空、无重复、全部在四项内且含 READ；USER/ROLE 各建 partial UNIQUE(knowledgeBaseId,subjectUserId) / UNIQUE(knowledgeBaseId,subjectRoleId)（覆盖撤销行，重授更新同一行）；INDEX(projectId,knowledgeBaseId,revokedAt)。
- 再授予已撤销成员/assignment/grant 必须显式动作、expectedVersion 与新审计；清空 revokedAt、递增 version，不因登录、读取、Agent poll 或名称相同自动复活。

### 6.3 会话、Agent 与设备请求

| 实体 | 精确字段 |
| --- | --- |
| WebSession | `id uuid PK; userId uuid?; tokenHash char(64); csrfTokenHash char(64); userAuthVersion int?; createdAt timestamptz; lastSeenAt timestamptz; idleExpiresAt timestamptz; expiresAt timestamptz; revokedAt timestamptz?; version int=1` |
| AgentCredential | `id uuid PK; userId uuid; projectId uuid; roleId uuid; tokenHash char(64); name varchar(80); scopes text[]; userAuthVersion int; version int=1; authorizationRequestId uuid; authorizedByStampId uuid; authorizedAt timestamptz; createdAt timestamptz; expiresAt timestamptz; lastUsedAt timestamptz?; revokedAt timestamptz?; revokedByStampId uuid?; revokeReason varchar(1000)?` |
| CliAuthorizationRequest | `id uuid PK; clientName varchar(80); deviceCodeHash char(64); userCodeHash char(64); codeChallenge char(43); codeChallengeMethod enum(S256); credentialSecretHash char(64); status enum(PENDING,APPROVED,ISSUED,DENIED,EXPIRED); version int=1; createdAt timestamptz; expiresAt timestamptz; nextPollAt timestamptz; approvedUserId uuid?; approvedProjectId uuid?; approvedRoleId uuid?; approvedScopes text[]?; approvedExpiresInDays int?; approvedByStampId uuid?; approvedAt timestamptz?; issuedCredentialId uuid?; issuedAt timestamptz?; recoveryExpiresAt timestamptz?; deniedAt timestamptz?; deniedByStampId uuid?` |
| CliAuthorizationView | `authorizationRequestId uuid; webSessionId uuid; userId uuid; viewedAt timestamptz; expiresAt timestamptz`；PK(authorizationRequestId,webSessionId) |
| AuthRateWindow | `id uuid PK; kind enum(LOGIN_EMAIL,LOGIN_IP,PASSWORD_SESSION,DEVICE_CREATE_IP,DEVICE_LOOKUP_SESSION,SESSION_BOOTSTRAP_IP); keyHash char(64); windowStart timestamptz; attempts int; expiresAt timestamptz` |

约束和索引：

- WebSession：UNIQUE(tokenHash)，FK userId→User；CHECK userId/userAuthVersion 同为 null 或同非 null；CHECK idleExpiresAt<=expiresAt；INDEX(userId,revokedAt,expiresAt)、INDEX(expiresAt)。匿名与已登录行均不能修改为另一用户，登录始终新建。
- AgentCredential：UNIQUE(tokenHash)、UNIQUE(authorizationRequestId)、UNIQUE(projectId,id)；FK userId→User、(projectId,userId)→ProjectMember、(projectId,roleId)→ProjectRole、authorizationRequestId→CliAuthorizationRequest；两个 stamp→PrincipalStamp；CHECK scopes 非空、去重、全部在注册表；INDEX(userId,projectId,revokedAt)、INDEX(projectId,roleId,expiresAt)。授权时必须有活动 assignment，使用时再次验证。
- CliAuthorizationRequest：UNIQUE(deviceCodeHash)、UNIQUE(userCodeHash)、UNIQUE(issuedCredentialId)；FK approvedUserId→User、(approvedProjectId,approvedUserId)→ProjectMember、(approvedProjectId,approvedRoleId)→ProjectRole、issuedCredentialId→AgentCredential、批准/拒绝 stamp→PrincipalStamp；INDEX(status,expiresAt)、INDEX(approvedUserId,createdAt)。APPROVED/ISSUED 的批准字段全部非空；ISSUED 的 issuedCredentialId/issuedAt/recoveryExpiresAt 全非空；PENDING 不含批准或签发字段。循环 FK 通过先写无 issuedCredentialId 的设备请求、创建凭据、再更新设备请求完成，不级联删除。
- CliAuthorizationView：FK authorizationRequestId→CliAuthorizationRequest、webSessionId→WebSession、userId→User；INDEX(webSessionId,expiresAt)。lookup upsert刷新viewedAt，但expiresAt始终等于设备请求expiresAt、不续期；service必须确认session.userId等于view.userId。
- AuthRateWindow：UNIQUE(kind,keyHash,windowStart)、INDEX(expiresAt)。keyHash 对规范化邮箱或来源 IP 使用部署秘密的 HMAC-SHA256，不保存明文邮箱/IP；Origin 不作为可信来源 IP。计数在 PostgreSQL 原子 upsert，Redis 仅可作为额外加速。
- 固定窗口：login 每 email 每 15 分钟最多 5 次失败、每 IP 每 15 分钟最多 30 次尝试，register复用该IP窗口；密码二验每 session 每 15 分钟最多 5 次失败；device create 每 IP 每 10 分钟最多 10 次；Web userCode lookup 每 session 每 10 分钟最多 10 次；新建匿名session每IP每10分钟最多60次（已有有效session的读取不计）。达到上限返回 429 与窗口剩余秒数 Retry-After。成功不会清零其他来源的失败窗口。不存在的用户使用等价密码比较路径且返回同一 AUTH_INVALID。

Agent bearer 格式为 `wm_a1.<UUID>.<43字符secret>`，Guard 先严格解析版本和长度，再按 id 读取，用 SHA256(secret) 常量时间比较 tokenHash。任何未知前缀、JWT、人类 refreshToken、跨项目凭据均不转换为其他类别。Authorization 不允许 query/body 替代。

### 6.4 一次性票据与 PrincipalStamp

| 实体 | 精确字段 |
| --- | --- |
| ConfirmationTicket | `id uuid PK; secretHash char(64); userId uuid; webSessionId uuid; projectId uuid?; userAuthVersion int; action varchar(64); targetType varchar(40); targetId uuid; expectedVersion int; actionDigest char(64); roleId uuid?; approvalSlotId uuid?; createdAt timestamptz; expiresAt timestamptz; consumedAt timestamptz?; consumedRequestId uuid?; consumedOperationId uuid?; invalidatedAt timestamptz?` |
| PrincipalStamp | `id uuid PK; kind enum(HUMAN,AGENT); userId uuid; webSessionId uuid?; agentCredentialId uuid?; projectId uuid?; roleId uuid?; roleKeySnapshot varchar(48)?; scopeSnapshot text[]; userAuthVersion int; memberVersion int?; roleAssignmentVersion int?; credentialVersion int?; requestId uuid; createdAt timestamptz` |
| AuditEvent | `id uuid PK; projectId uuid?; actorStampId uuid?; webhookReceiptId uuid?; action varchar(64); targetType varchar(40); targetId uuid; targetVersion int?; outcome enum(SUCCESS,DENIED); reasonCode varchar(64)?; details jsonb; createdAt timestamptz` |

约束和索引：

- ConfirmationTicket：UNIQUE(secretHash)；FK userId→User、webSessionId→WebSession、projectId→Project、(projectId,roleId)→ProjectRole；approvalSlotId→领域 ApprovalSlot，consumedOperationId→公共IdempotentOperation.id；CHECK expectedVersion>=1，approvalSlotId 非空要求 roleId 非空；expiresAt=createdAt+5分钟；消费三字段同为 null 或同非 null；INDEX(webSessionId,expiresAt)、INDEX(userId,action,targetId)、INDEX(expiresAt)。
- targetType/targetId 是受限 action registry 的验证绑定，不是任意追溯关系；registry 明确目标表，在预览、二验和最终事务中查询该真实目标及项目。最终产生的领域决定以各自 FK 指向真实目标，不能只保留票据的多态 ID。审批槽位、业务角色、会话和主体均保持真实 FK。
- PrincipalStamp：FK userId→User、webSessionId→WebSession、agentCredentialId→AgentCredential、projectId→Project、(projectId,roleId)→ProjectRole；CHECK HUMAN 时 webSessionId 非空且 agentCredentialId/credentialVersion 为空；AGENT 时相反且 projectId/roleId/credentialVersion 非空。INDEX(projectId,createdAt,id)、INDEX(userId,createdAt,id)、INDEX(agentCredentialId,createdAt)。bootstrap/login 前的失败只写含requestId/action/errorCode的脱敏运行日志，不写AuditEvent、不伪造已认证 PrincipalStamp。
- AuditEvent：FK projectId→Project、actorStampId→PrincipalStamp、webhookReceiptId→WebhookReceipt；CHECK actorStampId与webhookReceiptId精确一项非空；INDEX(projectId,createdAt,id)、INDEX(targetType,targetId,createdAt)、INDEX(actorStampId)、INDEX(webhookReceiptId)。details只允许各action声明的授权差异、scope名、版本、ID和reasonCode，不含密码、secret、csrf、cookie、票据、完整请求/响应或知识正文。

经过HUMAN／AGENT授权的共享写入在业务事务内生成PrincipalStamp，业务记录以actorStampId FK引用，不从请求接收stamp。仅04已验证厂商Webhook的系统事实使用持久WebhookReceipt来源，不能伪造人类会话，也不引入可调用业务API的SYSTEM身份。stamp的member/assignment/credential version是当时事实快照，只用于审计，不作为以后权限缓存。同一HTTP请求在成功重试后仅产生一个业务动作；幂等重放不生成第二个决定。拒绝审计不能将业务失败改成成功，日志只记录requestId、拒绝码及脱敏目标。

## 7. 密码二验和受保护动作协议

### 7.1 ActionBinding 与摘要

服务端 action registry 为每个受保护动作定义一项 handler，包含目标解析、当前授权、严格 payload schema、事务锁定和 canonical payload 生成。不能接受未知 action 或把任意 URL 当作可批准动作。

```ts
type RoleSlot = { roleId: string; approvalSlotId: string | null } | null;
type ActionBinding = {
  action: string;
  projectId: string | null;
  targetType: string;
  targetId: string;
  expectedVersion: number;
  roleSlot: RoleSlot;
  payload: Record<string, unknown>;
};
type Confirmation = { ticketId: string; ticketSecret: string };
```

`actionDigest=hex(SHA256(UTF8(canonicalJson({schemaVersion:1,...ActionBinding}))))`。canonicalJson 采用 RFC 8785 对象键顺序/字符串转义；schema 只允许字符串、布尔、null、安全范围整数、数组和对象，不接受 float/NaN/undefined。数组按业务 schema 固定顺序；表示集合的 ID 数组先去重并按 ID 字典序排序。内容原始字节摘要由领域分册计算，不改成规范化正文。password、confirmation、CSRF、requestId、Idempotency-Key 和 UI 文案不进入 payload；有业务意义的 comment/reason 必须进入。

projectId由服务端目标解析派生；项目成员的真实目标是 `(projectId,targetId=userId)`，不能只用用户ID跨项目复用票据。CLI授权从待批准payload的projectId派生并检查；项目无关动作才允许null。客户端binding中的projectId与派生值不符即拒绝，不能把它当授权来源。最终业务请求不必重复此字段，由实际route推导相同binding。

Web 先 POST preview，服务端返回规范化 ActionBinding、actionDigest 和可读的准确版本/工件/证据摘要；不能仅显示“确定吗”。再提交同 binding、预览 digest 和当次 password 创建票据。服务端重读目标、重新校验授权和摘要；变化返回 ACTION_CHANGED/VERSION_CONFLICT，不签发对旧内容的票据。密码成功只签发一张 5 分钟票据，不提高 session 的通用权限，不产生“5分钟内所有动作免密码”。

### 7.2 Registry 的固定动作与目标

| action | targetType 与 targetId | roleSlot / 授权 | 最终动作入口 |
| --- | --- | --- | --- |
| `AGENT_CREDENTIAL_AUTHORIZE` | CLI_AUTHORIZATION / authorizationId | null；当前用户具备所选项目角色，payload含projectId/roleId/scopes/expiresInDays | `POST /auth/cli-authorizations/:id/approve` |
| `AGENT_CREDENTIAL_REVOKE` | AGENT_CREDENTIAL / credentialId | null；凭据本人，或该项目 OWNER/ADMIN | `POST /projects/:projectId/agent-credentials/:id/revoke` |
| `PROJECT_UPDATE` | PROJECT / projectId | null；OWNER/ADMIN | `PATCH /projects/:id` |
| `PROJECT_MEMBER_ADD` | PROJECT / projectId | null；OWNER/ADMIN，受管理角色边界限制 | `POST /projects/:id/members` |
| `PROJECT_MEMBER_UPDATE` / `PROJECT_MEMBER_REVOKE` | PROJECT_MEMBER / subject userId | null；按第5节矩阵 | `PATCH /projects/:id/members/:userId` / `POST .../revoke` |
| `PROJECT_OWNER_TRANSFER` | PROJECT / projectId | null；当前 OWNER | `POST /projects/:id/owner-transfer` |
| `PROJECT_ROLE_CREATE` | PROJECT / projectId | null；OWNER/ADMIN | `POST /projects/:id/roles` |
| `PROJECT_ROLE_UPDATE` | PROJECT_ROLE / roleId | null；OWNER/ADMIN | `PATCH /projects/:id/roles/:roleId` |
| `PROJECT_ROLE_ASSIGN` / `PROJECT_ROLE_UNASSIGN` | PROJECT_MEMBER / subject userId | null；OWNER/ADMIN | `PUT /projects/:id/members/:userId/roles/:roleId` / `POST .../revoke` |
| `KB_ACCESS_REPLACE` | KNOWLEDGE_BASE / knowledgeBaseId | null；OWNER/ADMIN，无隐式 READ | `PUT /knowledge-bases/:id/access` |
| `PROJECT_KNOWLEDGE_BINDINGS` | PROJECT / projectId | null；OWNER/ADMIN且所有绑定文档当前READ；payload含文档、role和required集合及其摘要 | `PUT /projects/:projectId/knowledge-bindings` |
| `KNOWLEDGE_WITHDRAW` | KNOWLEDGE_DOCUMENT / documentId | USER grant时null；ROLE grant时该roleId+null槽位 | `POST /documents/:id/withdraw` |
| `REVIEW_DECIDE` | REVIEW_REQUEST / reviewRequestId | 普通槽位为`{roleId,approvalSlotId:slotId}`；知识USER-grant出版槽位为null，但payload仍绑定slotId | `POST /review-requests/:id/decisions` |
| `REVIEW_REVOKE` | REVIEW_DECISION / decisionId | 原决定准确roleSlot；原决定人或该slot当前有权人员，按领域撤销规则 | `POST /review-decisions/:id/revoke` |
| `WORKFLOW_CONFIG_PUBLISH` | PROJECT / projectId | null；OWNER/ADMIN；payload绑定workflowKey、expectedCurrentRevision和compiledDigest | `POST /projects/:projectId/workflow-definitions/:workflowKey/publish` |
| `ROLE_PACKAGE_PUBLISH` | PROJECT / projectId | null；OWNER/ADMIN；payload绑定packageId、SemVer、manifestDigest及全部资源摘要，不能自动执行脚本 | `POST /projects/:projectId/role-packages` |
| `WORKFLOW_INSTANCE_CREATE` / `WORKFLOW_INSTANCE_UPGRADE` | REQUIREMENT / requirementId 或 WORKFLOW_INSTANCE / instanceId | null；OWNER/ADMIN；绑定定义版本、全部责任人与slot映射及影响说明 | `POST /requirements/:id/workflow-instances` / `POST /workflow-instances/:id/upgrade` |
| `TASK_ADMIN_RELEASE` | TASK / taskId | null；OWNER/ADMIN，原因必填 | `POST /tasks/:id/release`，body force=true；普通责任人force=false不使用此动作 |
| `PROJECT_ARCHIVE` / `REQUIREMENT_ARCHIVE` | PROJECT / projectId 或 REQUIREMENT / requirementId | null；项目仅OWNER；需求OWNER/ADMIN | `POST /projects/:id/archive` / `POST /requirements/:id/archive` |
| `EXTERNAL_PROVIDER_APPROVE` / `EXTERNAL_PROVIDER_REVOKE` | PROJECT / projectId | null；OWNER/ADMIN；payload绑定mode和providerRefs:string[]。ALLOWLIST非空使用APPROVE，DENY_ALL且空列表使用REVOKE；缩小ALLOWLIST仍按准确新列表确认 | `PUT /projects/:projectId/model-policy` |
| `HOSTING_CONNECTION_CONFIGURE` | PROJECT / projectId | null；OWNER/ADMIN，绑定secret reference而非secret原文 | `POST /projects/:projectId/code-connections` |
| `HOSTING_CONNECTION_ARCHIVE` | CODE_CONNECTION / connectionId | null；OWNER/ADMIN，保留历史证据 | `POST /code-connections/:id/archive` |
| `PROJECT_REPOSITORY_BIND` | PROJECT / projectId | null；OWNER/ADMIN，绑定完整repo identity与连接版本 | `POST /projects/:projectId/repositories` |
| `PROJECT_REPOSITORY_ARCHIVE` | PROJECT_REPOSITORY / repositoryId | null；OWNER/ADMIN，绑定版本与原因，不删除历史证据 | `POST /repositories/:id/archive` |
| `CHANGE_RECIPIENT_REASSIGN` | CHANGE_RECIPIENT / recipientId | null；OWNER/ADMIN；绑定新user/role与原因，保留原收件和确认 | `POST /change-recipients/:recipientId/reassign` |

理解确认、PRD出版、知识出版、任务验收和发布验收统一通过 ReviewRequest：kind/slot.kind 分别使用 `UNDERSTANDING_CONFIRM`、`PRD_PUBLICATION`、`KNOWLEDGE_PUBLICATION`、`TASK_ACCEPTANCE`、`RELEASE_ACCEPTANCE`。最终请求为 `POST /review-requests/:id/decisions {slotId,decision:'APPROVE'|'CHANGES_REQUESTED'|'REJECT',expectedVersion,comment?,confirmation}`。有效APPROVE覆盖全部必需槽位后，同一领域事务才更新理解确认、PRD/知识发布指针或任务验收状态。不得另开直接理解确认、PRD publish、知识 publish或通用状态写入旁路。Web按kind展示目的，PRD/知识批准按钮和摘要必须明确写“批准并发布”，不把出版藏在普通评审文案中。

registry 中的 roleId 指真实 ProjectRole，不信任字符串 `product` 就有资格；初始 product key 用于查找预置角色，其 ID 写入正式关系。配置的 ApprovalSlot.kind 表示审批目的，roleId 表示所需业务资格；不另建一套 user qualification ACL。知识USER-grant出版槽位允许roleId=null，其余普通业务槽位必须有真实roleId。某人兼任多个 slot 时分别选择并产生决定，不合并成一个笼统 approve。IMPL 的有效他人代码评审和合并证据由领域门禁独立强制，任何 roleKey、角色裁剪或 OWNER 权限都不能豁免。

本文只规定统一票据，不重复定义领域 payload；领域分册必须为相应动作列出基线、修订、snapshot、artifactSet、外部证据及其 digest。registry handler 直接复用相应领域校验函数，不能实现一套较松的“预览权限”。

### 7.3 最终事务及幂等顺序

客户端在最终业务请求内带 `confirmation:{ticketId,ticketSecret}` 和该路由规定的 `Idempotency-Key`。服务端先执行新鲜认证、Origin/CSRF、当前授权，再按公共 `IdempotentOperation` 的 `(projectId,principalScopeKey,key)` 查已有幂等结果；同键同语义返回原结果，不再验证已成功动作的expectedVersion或消费旧票据；同键跨route/action或异语义返回 IDEMPOTENCY_CONFLICT，action不加入unique以免误复用。consumedOperationId指该实体服务端生成的id，不是header key。失权后的重放不能取得原先敏感结果。

新动作以 Serializable 事务完成：重新读目标及版本 → 重新读当前成员/assignment/KB grant/slot与业务条件 → 重算 actionDigest → 验 ticket 的 userId、同一 webSessionId、userAuthVersion、projectId、action、targetType/targetId、expectedVersion、roleSlot、digest、未失效/未使用/未过期及 secretHash → 条件 UPDATE 消费票据，要求影响行数为1 → 写领域决定/审计/stamp/幂等结果/事务事件 → commit。消费、批准和幂等结果不能分开提交。

目标版本、内容或证据变化时拒绝 ACTION_CHANGED/VERSION_CONFLICT；票据不消费，客户端重新预览并重新输密码。事务回滚不消费票据；并发两次消费只允许一次成功。序列化冲突最多重试三次，每次重读关系；重试不需要再次让用户输密码，但不能延长 expiresAt。外部厂商查询不放进事务；使用其已规范化、带核验时间和版本的领域证据，并遵循签字前取证及后续失效重算规则。

## 8. 公开 API 精确契约

### 8.1 通用形状和公开 DTO

所有路径前缀为 `/api/v1`；成功 `{data,meta:{requestId}}`，错误 `{error:{code,message,details?,requestId}}`。requestId 为服务端 UUID；未知字段拒绝。除特别说明 create=201，其余成功=200；撤销/登出也返回200 JSON，不以204破坏统一响应。secret响应 `Cache-Control:no-store`，认证接口不返回密码hash或tokenHash。

`UserView={id,email,name,isActive}`；`SessionView={authenticated,user:UserView|null,expiresAt:string|null,idleExpiresAt:string|null,csrfToken:string}`；`RoleView={id,projectId,key,title,isActive,version}`；`MemberView={projectId,userId,name,role,version,roleAssignments:[{id,roleId,roleKey,version}],revokedAt}`。

`CredentialView={id,userId,projectId,roleId,roleKey,name,scopes,version,authorizedAt,expiresAt,lastUsedAt,revokedAt}`；`AgentAuthView={principal:{kind:'AGENT',userId,agentCredentialId,projectId,roleIds,scopes},credential:CredentialView}`。

`GrantInput={subjectKind:'USER'|'ROLE',subjectUserId:UUID|null,subjectRoleId:UUID|null,permissions:('READ'|'PROPOSE'|'PUBLISH'|'REVOKE')[]}`；`AccessView={knowledgeBaseId,projectId,visibility,version,authzVersion,publicationApproverUserId,publicationApproverRoleId,grants:[{id,...GrantInput,version,grantedById,grantReason,grantedAt,revokedAt}]}`。管理接口不返回不可读知识正文或标题。

列表使用 `{items,nextCursor,hasMore}`，limit 默认20/最大100；cursor 为公共契约定义的opaque游标，排序位置使用稳定 `(createdAt,id)` 或 `(grantedAt,id)`，先鉴权/过滤再分页，不返回原始数据库游标或跨权限总量。项目成员固定用 userId 排序；项目角色用 key,id；单项目角色总数至多64（含停用行），创建时超限以422拒绝，避免停用后绕过总量约束。

### 8.2 Web 与个人认证

| method/path | 请求与认证 | data | 指定错误 |
| --- | --- | --- | --- |
| `GET /auth/session` | 公共；可读已有cookie，否则bootstrap | SessionView | 429 RATE_LIMITED（仅新建匿名session计数） |
| `POST /auth/register` | 匿名session+Origin/CSRF；`{email:string<=254,password:string,name?:string<=80}` | `{user:UserView,session:SessionView}`；201并设置新cookie | 400 INVALID_REQUEST；409 EMAIL_IN_USE；429 RATE_LIMITED |
| `POST /auth/login` | 匿名/现有session+Origin/CSRF；`{email,password}` | `{user,session}`；轮换cookie | 401 AUTH_INVALID；429 RATE_LIMITED |
| `POST /auth/logout` | HUMAN/匿名session+Origin/CSRF；`{}` | `{revoked:true}`；清cookie | 403 CSRF_REJECTED/ORIGIN_REJECTED |
| `POST /auth/logout-all` | HUMAN+Origin/CSRF；`{password}` | `{revoked:true,requiresLogin:true}`；撤销所有session/Agent/票据并递增authVersion | 401 AUTH_INVALID；429 RATE_LIMITED |
| `PATCH /auth/password` | HUMAN+Origin/CSRF；`{currentPassword,newPassword}` | `{changed:true,requiresLogin:true}`；同上全撤销 | 400 INVALID_REQUEST；401 AUTH_INVALID；429 RATE_LIMITED |
| `PATCH /auth/profile` | HUMAN+Origin/CSRF；`{name:string\|null}`，非空时1–80 | UserView | 400 INVALID_REQUEST |
| `GET /auth/me` | 有效HUMAN cookie或AGENT bearer，不能并存 | HUMAN：`{principal,user,session:{expiresAt,idleExpiresAt}}`；AGENT：AgentAuthView | 401 AUTH_REQUIRED/AUTH_INVALID/SESSION_EXPIRED/CREDENTIAL_REVOKED |

注册保留当前本地密码账号产品能力：创建账号及其个人 Organization，不加入其他人的项目；无邮箱验证不允许自动关联外部代码托管身份。公开注册不会授予现有项目权限。重复邮箱的409只在注册入口使用；登录及密码校验不透露用户存在性。`/auth/refresh`、旧profile token返回和HUMAN bearer接口不在v1注册。

### 8.3 CLI 授权

| method/path | 请求与认证 | data | 指定错误 |
| --- | --- | --- | --- |
| `POST /auth/cli-authorizations` | 无cookie、无bearer；`{clientName,codeChallenge,codeChallengeMethod:'S256',credentialSecretHash}` | `{authorizationId,deviceCode,userCode,verificationUri:'/cli/authorize',expiresAt,intervalSeconds:5}`；201 | 400 INVALID_REQUEST；429 RATE_LIMITED |
| `POST /auth/cli-authorizations/lookup` | HUMAN+Origin/CSRF；`{userCode}` | `{authorizationId,clientName,status,createdAt,expiresAt,version}` | 404 RESOURCE_NOT_FOUND（含非法/过期短码）；429 RATE_LIMITED |
| `POST /auth/cli-authorizations/:id/approve` | HUMAN+Origin/CSRF+本session有效lookup view+票据；`{expectedVersion,projectId,roleId,scopes,expiresInDays,confirmation}` | `{authorizationId,status:'APPROVED',version,expiresAt}` | 403 FORBIDDEN；409 VERSION_CONFLICT/ACTION_CHANGED；410 AUTHORIZATION_EXPIRED；422 UNSUPPORTED_SCOPE；票据错误 |
| `POST /auth/cli-authorizations/:id/deny` | HUMAN+Origin/CSRF+本session有效lookup view；`{expectedVersion}`，仅PENDING | `{authorizationId,status:'DENIED',version}` | 404 RESOURCE_NOT_FOUND；409 VERSION_CONFLICT；410 AUTHORIZATION_EXPIRED |
| `POST /auth/cli-authorizations/poll` | 无cookie、无bearer；`{authorizationId,deviceCode,codeVerifier}` | PENDING/APPROVED待消费前统一`{status:'PENDING',intervalSeconds:5}`；签发/恢复`{status:'ISSUED',credential:CredentialView}` | 401 AUTH_INVALID；403 AUTHORIZATION_DENIED；410 AUTHORIZATION_EXPIRED；429 AUTHORIZATION_SLOW_DOWN |
| `POST /auth/agent-credential/revoke-self` | 当前AGENT bearer；`{reason:string(1..1000)}` | `{revoked:true}`，原token立即失效 | 401 AUTH_INVALID/CREDENTIAL_REVOKED |

APPROVED 的正确 poll 在本请求内签发，正常不向客户端暴露一个可重用批准票据。DENIED 的正确 proof 返回403，不泄露其他请求状态。poll 响应中的 CredentialView 从不含 secret。`GET /auth/me` 是 CLI doctor 的认证探针；doctor 不能通过探针创建/扩大权限。

`revoke-self` 是注销当前 Agent 的唯一机器撤销入口，不是通用protected action；它只能减权且不可指定其他凭据。其他凭据撤销走Web票据，不允许提供别人的credentialId借自撤销入口代办。

### 8.4 预览与票据

| method/path | 请求与认证 | data | 指定错误 |
| --- | --- | --- | --- |
| `POST /auth/action-previews` | HUMAN+Origin/CSRF；ActionBinding | `{binding:ActionBinding,actionDigest,display:{targetLabel,versionLabel,summaryItems:[{label,value}]}}` | 403 HUMAN_SESSION_REQUIRED/FORBIDDEN；404 RESOURCE_NOT_FOUND；409 VERSION_CONFLICT/ACTION_CHANGED |
| `POST /auth/confirmation-tickets` | HUMAN+Origin/CSRF；`{...ActionBinding,actionDigest,password}` | `{ticketId,ticketSecret,expiresAt,actionDigest}`；201 | 401 AUTH_INVALID；403 HUMAN_SESSION_REQUIRED/FORBIDDEN；409 ACTION_CHANGED/VERSION_CONFLICT；429 RATE_LIMITED |

display 只包含此用户已授权可读内容；它不是digest输入。targetLabel对没有KB READ的ACL管理动作使用“知识库 <id>”，不能为了确认授权而泄露标题。请求不得提供自定义 display 代替服务端摘要。票据错误为：缺少/绑定不匹配/secret无效→403 CONFIRMATION_INVALID；过期→410 CONFIRMATION_EXPIRED；已消费→409 CONFIRMATION_USED；已失效→403 CONFIRMATION_INVALID。

### 8.5 项目授权与凭据管理

本表只定管理与身份路由，项目/知识主体的其他CRUD由领域分册定义。所有写操作为HUMAN+Origin/CSRF；标注“票据”的动作还必须使用第7节相应ActionBinding。业务payload排除expectedVersion和confirmation以外的传输字段时，normalizer必须将expectedVersion放回binding，而不是丢失并发保护。

| method/path | 业务请求 | data / 规则 |
| --- | --- | --- |
| `GET /projects/:id/members?limit&cursor` | HUMAN成员，或本项目AGENT+project:read | MemberView分页；活动成员；不返回邮箱或grant明细 |
| `POST /projects/:id/members` | 票据；`{expectedVersion:Project.version,userId,role:'ADMIN'\|'MEMBER',reason,confirmation}` | `{member:MemberView,projectVersion}`；ADMIN只能新增MEMBER；目标必须已有active User |
| `PATCH /projects/:id/members/:userId` | 票据；`{expectedVersion:Member.version,role:'ADMIN'\|'MEMBER',reason,confirmation}` | MemberView；仅OWNER调整管理role；不能借此移交OWNER |
| `POST /projects/:id/members/:userId/revoke` | 票据；`{expectedVersion:Member.version,reason,confirmation}` | `{revoked:true,memberVersion}`；拒绝当前OWNER；原子撤销该用户assignment、USER grants及项目Agent凭据，触发授权版本失效 |
| `POST /projects/:id/owner-transfer` | 票据；`{expectedVersion:Project.version,newOwnerUserId,reason,confirmation}` | `{projectVersion,previousOwnerUserId,ownerUserId}`；newOwner必须活动成员；同一人返回400 |
| `GET /projects/:id/roles?limit&cursor&includeInactive` | HUMAN成员，或本项目AGENT+project:read；includeInactive默认false | RoleView分页；includeInactive=true仅HUMAN管理者可用 |
| `POST /projects/:id/roles` | 票据；`{expectedVersion:Project.version,key,title,reason,confirmation}` | `{role:RoleView,projectVersion}`；201；总角色上限64 |
| `PATCH /projects/:id/roles/:roleId` | 票据；`{expectedVersion:Role.version,title?,isActive?,reason,confirmation}` | RoleView；不接受key；停用使相关任务明确阻塞而非删除角色要求 |
| `PUT /projects/:id/members/:userId/roles/:roleId` | 票据；`{expectedVersion:Member.version,reason,confirmation}` | `{assignmentId,assignmentVersion,memberVersion,roleId,userId}`；显式授予/重授；变更member.version |
| `POST /projects/:id/members/:userId/roles/:roleId/revoke` | 票据；`{expectedVersion:Member.version,reason,confirmation}` | `{revoked:true,assignmentVersion,memberVersion}`；撤销对应Agent凭据，并使角色授权不再命中 |
| `GET /projects/:id/agent-credentials?userId&limit&cursor` | HUMAN；本人只能查本人，OWNER/ADMIN可查项目内；Agent不能枚举其他凭据 | CredentialView分页，不返回hash/secret |
| `POST /projects/:id/agent-credentials/:credentialId/revoke` | 票据；`{expectedVersion:Credential.version,reason,confirmation}` | `{revoked:true,credentialVersion}`；本人或OWNER/ADMIN；可撤销但不替本人签发凭据 |
| `GET /knowledge-bases/:id/access` | 当前项目OWNER/ADMIN | AccessView；不要求READ但不返回正文/名称 |
| `PUT /knowledge-bases/:id/access` | 票据；`{expectedVersion:KB.version,expectedAuthzVersion,visibility,publicationApproverUserId,publicationApproverRoleId,grants:GrantInput[],reason,confirmation}` | AccessView；整集合替换：缺席grant标记撤销、已有更新、增加创建；authzVersion与version同增；指定审批人须有替换后PUBLISH；不物理删行 |
| `GET /projects/:id/audit-events?limit&cursor` | HUMAN OWNER/ADMIN；无AGENT入口 | `{items:[{id,action,targetType,targetId,targetVersion,outcome,reasonCode,actor:{kind,userId,roleId},createdAt,details}],nextCursor,hasMore}`；details仍按内容权限过滤，管理不绕READ |

reason 长度1–1000，所有变更必须提供；只写授权目的，不允许粘贴凭据或正文。管理写接口都要求Idempotency-Key，其语义、保存期限和冲突行为使用公共契约；首次执行成功后响应丢失重试不重复授权。版本错误409，目标不可见404，管理能力不足403，最后OWNER不变量409 LAST_OWNER_REQUIRED，角色/成员不活动422 ROLE_INACTIVE/MEMBER_INACTIVE，grant无效422 INVALID_GRANT，已存在active成员/role key409 RESOURCE_CONFLICT。

授权变更必须使其读写参与同一行版本：授予/撤销业务角色递增ProjectMember.version；项目成员增删、管理role变化和OWNER转移递增Project.version；KB ACL改变递增KB.version/authzVersion。角色停用/成员撤销连带受影响KB.authzVersion递增，不需要等异步重建索引。领域基线变更不修改这些授权版本。活动assignment的相同重授是409 RESOURCE_CONFLICT，不用新请求伪造授权变化；KB整集合替换保留相同grant不更新其grant版本，若整个ACL及责任配置均未变化则400 INVALID_REQUEST；幂等键的合法重放仍返回原结果。revoke明确返回原撤销事实仅用于同一幂等操作，其他新撤销请求以409 RESOURCE_CONFLICT提示已撤销。

## 9. 实施文件边界与顺序

这是一份后续实施清单，不是本次执行授权。所有步骤在授权实施后按已有dirty worktree逐文件核对，不覆写他人变更。

| 顺序 | 文件责任 | 必须交付的证据 |
| --- | --- | --- |
| 1 | `packages/shared/src/auth.ts`及其导出；`apps/api/src/auth/dto.ts` | Principal、views、ActionBinding、scope/error有限注册表及运行时DTO；类型与未知字段拒绝测试 |
| 2 | `apps/api/prisma/schema.prisma`及一份显式migration设计 | 本文FK、check/partial unique、撤销字段；迁移单独确认后验证，不删除既有业务证据 |
| 3 | `apps/api/src/auth/auth.service.ts`、`auth.guard.ts`、`auth.controller.ts`、`auth.module.ts`；新增`session.service.ts`、`agent-credential.service.ts`、`cli-authorization.service.ts` | Web会话、CSRF、device proof、poll恢复与即时撤销测试；不再注册旧refresh |
| 4 | 新增`authorization.service.ts`、`principal-stamp.service.ts`、`confirmation.service.ts`和`action-registry.ts` | 单一授权判断、动作绑定与原子消费；领域handler调用同一服务 |
| 5 | `apps/api/src/projects/project-access.service.ts`、`projects.service.ts`、`projects.controller.ts`及必要DTO | 管理role/业务role分离、成员/role/grant授权与审计；OWNER不变量 |
| 6 | 知识、任务、审批、流程和代码连接各业务入口 | 删除自报actorType与旁路；逐route scope mapping；事务重读权限/KB检查覆盖所有内容出口 |
| 7 | `apps/web/src/store/auth.ts`、`apps/web/src/api/client.ts`、登录注册页；新增设备授权与动作确认页 | cookie+CSRF、独立Web确认、准确版本摘要、逐动作密码输入、不把人类secret下发CLI |
| 8 | CLI client/config/login/doctor，按本地工作流分册实施 | 仅Agent凭据、按平台隔离、临时proof受限落盘、poll丢响应恢复；stdout不泄secret |

会话和票据实现不放进通用任务service重复建设；KB ACL使用共享服务，不在搜索/附件/快照分别复制不同规则。业务领域持有内容摘要和门禁事实，认证模块不自己判断代码评审是否有效。

## 10. 验收用例与证据层级

以下是后续必须编写和执行的测试，不是本次已运行结果。服务端单元测试可以模拟仓储验证归一化；事务、并发和索引约束必须使用隔离PostgreSQL集成测试；cookie/Origin/独立确认必须通过真实浏览器验证。禁止用内存mock的通过替代真实数据库原子性。

| 编号 | 最小输入/场景 | 必须断言 |
| --- | --- | --- |
| A01 | AGENT body附actorType=HUMAN，或直接调用最终approve | 未知字段400；仅AGENT时HUMAN_SESSION_REQUIRED；没有决定、票据或门禁变更 |
| A02 | Web登录成功后把旧匿名cookie继续用；把HUMAN JWT作bearer | 旧cookie无业务权限；JWT401；新cookie HttpOnly/Secure/Lax/Path=/且无Domain |
| A03 | POST的Origin缺失/null/恶意子域，或CSRF header缺失/错误 | 403，对照合法Origin+匹配cookie/header成功；不能通过Authorization与cookie混用提权 |
| A04 | 会话idle=30分钟、绝对8小时临界点，修改密码/停用/全登出 | 到期即拒绝；authVersion变化使所有旧session/Agent/ticket失效；当前页面需重登 |
| A05 | production HTTP或非loopback LOCAL_INSECURE；loopback Vite代理 | 非法配置失败；开发cookie名不同且只有显式dev模式关闭Secure；不因Host/Forwarded伪造降级 |
| A06 | CLI请求A的deviceCode配请求B verifier；修改secretHash后poll | 401且不推进状态；challenge与预登记secretHash不可替换 |
| A07 | PENDING未批准、DENIED、10分钟过期的APPROVED请求poll | 分别PENDING/403/410；不创建AgentCredential；原Web票据不能跨请求使用 |
| A08 | 同一APPROVED请求同时两个正确poll | 一个Credential、一条授权消费；两个成功结果credentialId一致；唯一约束真实生效 |
| A09 | 首次poll事务成功但丢响应；5分钟后同proof重试 | 取同metadata、同到期时间、无secret回传、不增加Credential；恢复窗后410 |
| A10 | 默认浏览器scope，尝试额外publish/*；Agent越项目/角色 | 默认仅八项read；额外scope422；越项目404/403且无写；不能靠owner管理role提权 |
| A11 | 授权后撤销membership/assignment/KB grant，再调用同token | 立即拒绝；不等待token到期/缓存刷新；旧context/search/cache/附件都无内容泄露 |
| A12 | 管理ADMIN但无业务assignment，产品确认或任意slot决定 | 403；显式分配后才按角色成功；同人两个roleSlot需要两份独立决定和票据 |
| A13 | PROJECT成员仅默认READ；RESTRICTED未grant的OWNER | 前者读成功写候选403；后者普通列表无库/标题/计数，内容404；ACL管理只见最小元数据 |
| A14 | OWNER显式授自己受限库READ，随后撤销 | 授予需要密码票据并产生授权差异审计；有grant时可读，撤销后立即不可读；无“先读后补权” |
| A15 | 两个用户/两个业务角色grant并集；grant只有PUBLISH无READ | 并集准确；无READ的输入422；USER发布roleSlot可null，ROLE发布须当前assignment |
| A16 | 密码二验成功后修改target version/artifact digest/roleSlot/comment | 最终ACTION_CHANGED/VERSION_CONFLICT，票据未消费，无决定；只能重新预览二验 |
| A17 | 同票据并发提交两个不同幂等键；一份票据跨session/user/target使用 | 并发单胜；跨绑定403；不能共用5分钟通用提升权限 |
| A18 | 事务在consume后故障回滚；原请求同key重试 | 回滚无消费和决定；重试仅一次成功；已成功响应丢失时同key同语义取原结果，不二次消费 |
| A19 | 原决定成功后成员失权，再同key重放 | 先新鲜鉴权而拒绝，不泄露已失权的历史响应；同key异payload409 |
| A20 | author改custom roleKey/管理员头衔，尝试绕IMPL他人review | 仍缺有效他人评审即关门失败；一个人多角色不能造他人代码评审 |
| A21 | MEMBER增删/OWNER转移并发；ADMIN尝试升自己OWNER | 始终一个活动OWNER；ADMIN403；无孤儿项目；业务角色和KB grant不跟随头衔复制 |
| A22 | 无Redis运行，限流与并发授权请求 | PostgreSQL核心路径成立；限流不可因进程多副本绕过；Redis不承担唯一撤销/票据状态 |
| A23 | 认证/二验/设备/凭据/KB拒绝路径的日志和审计采样 | 不含密码、cookie、secret、deviceCode、verifier、ticket、知识正文；仅requestId/ID/版本/拒绝码 |
| A24 | codeVerifier/credentialSecret临时落盘后create响应丢失和本地落盘失败 | create丢响应重新开始不签发孤儿凭据；poll丢响应按原proof恢复；不丢失仍需要的secret、不输出token |
| A25 | 仅知道authorizationId的另一个Web session直接approve/deny；同USER不同session移用票据 | 无本session lookup view则404；有view仍要当前角色与密码票据；跨session票据403 |
| A26 | user拥有frontend/backend两角色，Agent只frontend，KB仅授backend ROLE READ | HUMAN可读；该Agent不可读；不能从owner的其他角色放大凭据 |

文档完成只表示身份权限方案已具备字段、路由和验收定义。应用验证应分别报告静态/单元、PostgreSQL并发、鉴权HTTP、真实浏览器以及与领域门禁联调结果；任何未执行层级明确标记未验证。
