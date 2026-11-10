# 角色包与任务上下文诊断

`workmesh context --task <taskId> --inspect` 和正常获取上下文都会返回 `roleContext`，终端同时显示对应提示。诊断将三种情况分别说明：

- `UPDATE_AVAILABLE`：当前项目可见的同包、同角色存在更高的严格 SemVer。任务仍使用其已发布工作流锁定的版本；安装新版也不改变在途任务的锁。
- `LOCAL_ROLE_PACKAGE_MISMATCH`：本机 `.workmesh/lock.json` 未登记任务锁定的准确 packageId、roleKey、version、packageDigest，或安装目录的真实资源长度、SHA256 不匹配。缺失、损坏、不可读和符号链接都不会记为匹配；同时安装多个版本时只核对任务的准确版本。
- `ROLE_PACKAGE_UPDATED`：与该任务上一次可读快照相比，实际 `role:*` 引用的摘要或长度有变化，或引用增删。输出变化资源的路径和 ADDED / REMOVED / CHANGED 状态，提示重新阅读对应 SOP。单纯发布新版、工作流编号变化或相同内容换了资源数据库 ID 都不会产生这条提示。

首次获取没有旧快照时，资源比较是 `NO_SNAPSHOT`。旧平台未提供新诊断字段、任务锁缺失、旧快照不可读或其他输入导致本次不能完成比较时，结果保留 `UNAVAILABLE`；这不能证明资源没有变化。当前任务的权限和 `context:read` 检查同样适用于新增元数据。

`--snapshot <snapshotId>` 读取的是历史快照，不查询当前任务锁，也不拿当前安装版本为历史快照背书。它显示快照自身资源并标为 `NOT_COMPARED`。现有物化过程继续核验快照声明的真实 bytes。

这些字段是只读诊断，不更新本机包、不可变快照、已发布工作流或 HUMAN 的批准状态。context 创建和刷新继续使用精确认领、代次与任务版本；诊断读取不会自动接受服务端最新任务版本。
