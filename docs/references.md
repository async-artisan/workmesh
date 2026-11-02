# 外部参照台账

> 用途：记录每个设计判断借了哪个成熟实践、借了什么、没借什么，避免「凭感觉设计」。
> 标记：✅ 本次已打开核验；◻ 通用来源，未逐条核验（对外发布前应补验）。

## 1. 定位与交付节奏

| 来源                                                                         | 借了什么                                             | 没借什么               | 核验 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------- | ---- |
| [Theory of Constraints](https://en.wikipedia.org/wiki/Theory_of_constraints) | 瓶颈决定系统产出，非瓶颈提效只增加库存               | 五步法全套、鼓-缓冲-绳 | ◻    |
| [Little's Law](https://en.wikipedia.org/wiki/Little%27s_law)                 | 在制品 × 周期时间 ≈ 队列长度，用于度量等待           | 公式推导与排队论       | ◻    |
| [DORA](https://dora.dev/)                                                    | 四项交付指标（前置时间、部署频率、失败率、恢复时间） | 问卷方法与成熟度打分   | ✅   |

## 2. 并行与大厂实践

| 来源                                                                                                                    | 借了什么                                               | 没借什么                           | 核验 |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------- | ---- |
| [Amazon Working Backwards](https://www.aboutamazon.com/news/workplace/an-insider-look-at-amazons-culture-and-processes) | PR/FAQ 先于实现；篇幅约束是思考的强制函数              | 六页纸评审会、逐行评审仪式         | ✅   |
| [Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/)                                 | 设计先于编码；写权衡与备选；10–20 页或 1–3 页 mini doc | Google Docs 工具链、正式设计评审会 | ✅   |
| [DORA: Trunk-based development](https://dora.dev/capabilities/trunk-based-development/)                                 | 小批量、每日合流、避免长冻结；代码评审过重会反噬       | 三分支上限等硬指标                 | ✅   |
| [Feature Toggles](https://martinfowler.com/articles/feature-toggles.html)                                               | 发布与上线解耦，让并行分支不必等齐                     | 复杂开关治理与开关债务管理         | ◻    |

> 未采用：Spotify 双轨制、SAFe PI Planning。前者缺少稳定可引的原始出处，后者对 3–30 人团队过重。

## 3. 老项目改造

| 来源                                                                         | 借了什么                                     | 没借什么                             | 核验 |
| ---------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------ | ---- |
| [Strangler Fig](https://martinfowler.com/bliki/StranglerFigApplication.html) | 增量替换、保留宿主、过渡架构可接受           | 组织变革四活动全套、遗留系统迁移目录 | ✅   |
| Working Effectively with Legacy Code（Michael Feathers）                     | characterization tests：改之前先锁住现状行为 | 全书的重构手法目录                   | ◻    |

## 4. 验收标准

| 来源                                                                          | 借了什么                               | 没借什么                | 核验 |
| ----------------------------------------------------------------------------- | -------------------------------------- | ----------------------- | ---- |
| [INVEST](<https://en.wikipedia.org/wiki/INVEST_(software)>)                   | 可测、足够小、独立；用于验收粒度判断   | 故事点估算与速度度量    | ◻    |
| [Three Amigos](https://agilealliance.org/glossary/three-amigos/)              | 产品、开发、测试共同评审验收，歧义前置 | 固定会议形式与角色分工  | ◻    |
| [Example Mapping](https://cucumber.io/blog/bdd/example-mapping-introduction/) | 用具体例子消解验收歧义                 | Cucumber/Gherkin 工具链 | ◻    |

## 5. 项目开发规范

| 来源                                                                                                                         | 借了什么                                               | 没借什么           | 核验 |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------ | ---- |
| [AGENTS.md](https://agents.md/)                                                                                              | 仓库级 Agent 指令入口；就近文件优先；README 与规范分离 | 任一厂商的私有格式 | ✅   |
| [Google Style Guides](https://google.github.io/styleguide/)                                                                  | 成文规范 + 好/坏示例的写法                             | 具体语言的规则条目 | ◻    |
| [ESLint](https://eslint.org/docs/latest/) / [Prettier](https://prettier.io/docs/) / [commitlint](https://commitlint.js.org/) | 规范要能执行；`enforcement: LINT/CI`                   | 具体规则集与配置   | ◻    |

## 6. 通用性与单元模型

| 来源                                                                               | 借了什么                                       | 没借什么               | 核验 |
| ---------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------- | ---- |
| [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/) | 单元作为一等实体；从单元页发现文档与归属       | 插件生态与目录规模     | ◻    |
| [C4 model](https://c4model.com/)                                                   | 分层视图（上下文 / 容器 / 组件）用于 Unit 描述 | 绘图工具与符号规范     | ◻    |
| [Team Topologies](https://teamtopologies.com/)                                     | 认知负荷上限，按角色给最小充分上下文           | 团队拓扑模板与组织改造 | ✅   |

## 7. 知识闭环

| 来源                                                                                                                         | 借了什么                                          | 没借什么             | 核验 |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------- | ---- |
| [KCS](https://library.serviceinnovation.org/KCS/Knowledge-Centered_Success_Practices_Guide/402-Purpose_Behind_the_Practices) | Solve/Evolve 双环、按需捕获、使用即评审、文章状态 | 客服场景的认证与绩效 | ✅   |
| [Diátaxis](https://diataxis.fr/start-here/)                                                                                  | 教程 / 操作 / 参考 / 解释四类分开                 | 全站目录结构         | ✅   |
| [Backstage TechDocs](https://backstage.io/docs/next/features/techdocs/)                                                      | 文档跟代码走、挂在单元上、Trust Score 与维护提醒  | 静态站点托管         | ✅   |
| [ADR](https://adr.github.io/)                                                                                                | 决策记录 + superseded 状态                        | 每个小决定都写 ADR   | ✅   |

## 8. 变更管理

| 来源                                                                  | 借了什么                                          | 没借什么             | 核验 |
| --------------------------------------------------------------------- | ------------------------------------------------- | -------------------- | ---- |
| [Parallel Change](https://martinfowler.com/bliki/ParallelChange.html) | expand → migrate → contract 三步走                | 具体接口改造手法     | ✅   |
| [OpenGitOps](http://opengitops.dev/)                                  | 期望态与实际态持续对账                            | 部署工具链           | ◻    |
| [Keep a Changelog](https://keepachangelog.com/)                       | 变更通知的 diff 结构（Added / Changed / Removed） | 版本号规范细节       | ◻    |
| [Change Impact Analysis](https://arxiv.org/abs/2501.11778)            | 反向遍历依赖图、ripple effect                     | 微服务场景的全部实现 | ✅   |

## 9. 角色包

| 来源                                                                    | 借了什么                                                                          | 没借什么                             | 核验 |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------ | ---- |
| [Agent Skills](https://agentskills.io/specification)                    | `SKILL.md` 目录、name/description 约束、渐进披露、references/assets               | `allowed-tools` 当权限（它只是声明） | ✅   |
| [GitHub Spec Kit](https://github.github.com/spec-kit/)                  | 分阶段产物、模板 + 质量清单、跨产物分析、`--integration` 适配器、升级与老项目指南 | 38 个集成的规模、重型命令面          | ✅   |
| [Claude Code Plugins](https://code.claude.com/docs/en/plugins/overview) | 「可安装的能力包」这一形态                                                        | 依赖宿主特性的打包方式               | ◻    |
| [BMAD](https://github.com/bmad-code-org/BMAD-METHOD)                    | 角色 = 方法 + 模板 + 检查表                                                       | 重型 persona                         | ◻    |
| [OpenSpec](https://github.com/fission-ai/openspec)                      | 以 change 为单位组织产物                                                          | 目录复杂度                           | ◻    |

## 10. 使用规则

1. 新增设计判断时，先在本台账登记来源，再写进对应文档。
2. 「借了什么」写具体机制，「没借什么」写清边界，避免整包照搬。
3. ◻ 的条目在对外材料、客户演示、开源发布前必须补验。
4. 找不到成熟来源的判断，标注「经验判断」，不伪装成引用。
