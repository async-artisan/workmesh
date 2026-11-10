---
name: assess-idea
description: 用正反证据、成本和备选方案评估一个想法是否值得继续，形成继续、澄清或停止的建议；当方向尚未确定或需要比较产品投入时使用。
license: MIT
metadata:
  roleKey: product
---

# 评估想法

1. 记录原始诉求、受影响用户、痛点、现有替代方式和不做的成本；先确定问题，不直接选技术。
2. 查找支持与反对证据，标注来源、时效、可信程度。没有来源的保持假设，重要未知项设计最小验证。
3. 比较少量可行方向及维持现状，记录收益、成本、风险、约束、成功信号和可承担投入。
4. 形成 GO / NEEDS_CLARIFICATION / STOP 建议及理由；停止可以是有效结果，不为填流程强行推进。
5. 使用 `idea-assessment.md` 留下决策与交接摘要。探索复用现有 BRAINSTORM 本地状态；选定方案后才进入 REQUIREMENT 收敛。

## 边界

评估不创建正式 Requirement，不启动实现，也不代表 HUMAN 已批准。只在需求方决定继续时交给 `clarify-intent`；可用现有 DECISION 知识候选保存需要正式共享的结论。
