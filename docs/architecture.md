# WorkMesh 架构

当前交付情况与验证边界统一维护在[交付状态](phase-status.md)中。源码导航和架构图见[代码地图](code-wiki/ARCHITECTURE.md)与[架构图册](code-wiki/ARCHITECTURE_DIAGRAMS.md)。[文档导航](README.md)按用途区分现行指南、技术契约和历史记录。

WorkMesh 使用 pnpm 工作区组织项目。`apps/api` 负责 NestJS HTTP 接口与 Prisma 数据持久化，`apps/web` 提供 React 工作台，`apps/cli` 为 Agent 提供本地自动化能力，`packages/shared` 保存各应用共用的契约。

请求处理链路为 `controller → domain service → repository → Prisma`（控制器 → 领域服务 → 仓储 → Prisma）。服务端不直接信任客户端声明的身份、角色、版本或审批状态：认证守卫先根据 HUMAN 的 WebSession 或 AGENT 的 Bearer 凭据解析出主体 `Principal`，再在每次请求中重新检查项目成员身份与知识库读取权限。

所有改变领域状态的操作均在单个 Serializable（可串行化）事务中完成，并对项目行加锁、按版本号进行比较并更新，在发生序列化冲突时执行有限次数的重试。身份、评审决定、发布、确认票据、幂等操作与审计事件均采用追加式记录；撤销与撤回通过新增记录表达，保留原有历史。

Agent 的工作受不可变输入约束：已发布的角色包版本、确定性的上下文快照 `ContextSnapshot`，以及任务认领 `TaskClaim` 的代次。平台只接收包含真实字节内容或完整代码引用的工件；代码证据先由代码托管适配器归一化，再由平台使用。目前仅实现了 GitHub 代码托管适配器；适配器接口与稳定的仓库标识将厂商特有字段隔离在领域层之外。
