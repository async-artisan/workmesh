# 项目准备清单概要读取验证

> 2026-11-10。对应 [文档概要方案](../design/document-history-pagination.md) 的 `readiness-summary-bounded / state / race / compatible`。r1 本地切片已通过，范围与执行证据如下。

用户展开准备清单后，只读取编译规则中必需且去重的文档 ID 的紧凑概要；判断所用字段仍为文档归属、类型、归档、发布指针和角色绑定。不下载该文档的完整修订数组，不把读取失败解释为缺失。404、403、409 和服务错误保持待确认；成功概要明确撤回、归档、跨项目或类型不符时才待准备。页面仍是只读诊断，正式权限、版本与批准由服务端核验。

实现范围为独立 `api/documentSummaries.ts`、`lib/projectReadiness.ts`、相应函数/组件用例和新增独立生产 Chromium fixture spec。公共 resources、既有文档 GET 和其他消费者不在本切片修改范围。组件原有请求代次检查继续隔离切换项目/流程后的迟到结果。概要与绑定等是独立请求，不承诺跨请求一致快照。

候选以已通过的概要后端 r2 为父，明确整合已验证的批量窗口源码，再只覆盖准备清单文件与文档；冻结清单记录依赖摘要并逐字节核对。后端 r2 的 API 1015、18 项契约和真实数据库/HTTP 65 仅覆盖相同未变化 API 源码；本轮先跑受影响 Web 包单元、类型、定向 ESLint、生产构建，再使用隔离生产预览执行完整 fixture 浏览器套件。浏览器新增 1440/390 各八场景，网络账本拒绝写请求及旧列表/详情/history/metadata/content。

冻结候选 `20261110-readiness-summary-r1` 共 1,088 文件，清单 `f1146cb5b9972e6e16ce333ef93ba3bb483f1fd0ffc4bc47a63aefd6bd2f3d1b`；全部冻结文件后置一致，十四个整合及本切片 live 实现/用例文件逐字节一致，API 与已通过父候选 r2 无差异。冻结安装、shared 构建、Web 69 文件 **725/725**、语义类型、定向 ESLint 和生产 Web 构建全部 exit 0，检查汇总 `c196c25ee22eb458b3b20902f938c0061509e22b4c0fe6a57d4aa2b21182847b`。

完整生产 Chromium fixture **117/117**，零跳过、失败和 flaky；其中新增十六场景在 1440/390 两种视口验证展开前不读概要、必需引用去重、409/404/503 待确认与手动刷新、撤回或归档待准备、切项目/流程后的迟到隔离。网络账本拒绝写请求和旧文档读取。报告摘要 `741352c68cb672b88a9be1f5dd8f19e4776c1725839e574334e433cefe1533f8`，预览 58443 结束后监听为零。最终汇总 `0d4838ae820eee92135f9426010c32b98eec79d6dd3b184ab154bb4e03cd17cc`，状态为 `LOCAL_READINESS_SUMMARY_SLICE_PASSED`。

本轮 API/数据库没有重跑，只沿用明确相同 API 源码的 r2 证据。fixture 的简短 ID 不是实际 UUID 路由或数据库授权证据。本轮不代表 Knowledge/Prds/Workflows 主列表已经迁移，不退役旧接口，也不覆盖容量基准、全仓 `pnpm verify`、制品、最终 clean SHA 的远端 CI、外部 GitHub 或 HUMAN 正式批准。上述状态文档在执行后补充，不属于 r1 的冻结清单。
