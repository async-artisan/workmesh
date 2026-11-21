# 开发与验收脚本的概要读取验证

> 2026-11-10。对应[文档主页面方案](../design/document-catalog-ui.md)的脚本迁移范围。r1 只读回归与静态检查已通过，实际 first-run 与 baseline 浏览器链仍待重验。

`first-run-workflow` 的发布后核对与 baseline-change 的发布指针断言改读单文档 summary。YFF 演示脚本通过完整概要分页识别既有 Understanding 和知识文档，不再以项目首 50 份完整文档判断缺失。存在性查询核对准确可见标题，并按需读取分页历史；撤回选择器仅匹配当前发布标题，多个准确目标即失败。

新 helper 的只读回归覆盖首 100 份以外的文档、长标题、历史标题、仅需求文字命中、完整分页、重复游标与 ID、total/version 变化、错误传播及不完整数据拒绝。撤回单独覆盖改名的历史命中排在真正目标前、仅候选标题命中、重复发布标题及后续分页不完整。

代码审查发现初版复用历史标题查询会选错撤回对象，已限定调用和补充回归。受控调用回归不等于实际 seed 执行，且不会连接默认数据库、清理限流窗口、生成批准或撤回数据。真实 first-run 与 baseline 浏览器链、完整 `pnpm verify`、打包和远端 CI 需在后续独立环境验收。

## r1 执行证据

`G:\yesgoo\workmesh-validation\20261110-script-summary-r1` 由已通过 PRD r2 源码加八个明确覆盖文件冻结，共 1,105 文件；API 与已通过概要 API r3 一致。固定 Node 20.19.0 / pnpm 10.28.2 下，helper 与 verify 编排回归 **47/47**、五份脚本语法、覆盖文件 Prettier 和 baseline-change 定向 ESLint 均 exit 0。源文件后置和六份 live 实现/用例一致；清单 `65fb40a29e34aa4f9758955ded475452c864bbb26f43f1c727503b566521d4a1`，汇总 `6f4ec9b6d8585d67f3f9bb439adc952e768e259382a3b9a62aaf5f4774e623c7`。不包含实际 API/数据库、seed、HUMAN 批准、完整门禁或新制品。
