import {
  DecisionStatus,
  Priority,
  PrismaClient,
  PrdStatus,
  RequirementStatus,
  SpecStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('SEED_ADMIN_PASSWORD is required for db:seed');
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@reqflow.local').trim().toLowerCase();
  const organization = await prisma.organization.upsert({
    where: { slug: 'reqflow-demo' },
    update: {},
    create: { name: 'ReqFlow Demo', slug: 'reqflow-demo' },
  });
  const user = await prisma.user.upsert({
    where: { email },
    update: { organizationId: organization.id, isActive: true },
    create: {
      email,
      name: 'ReqFlow Admin',
      passwordHash: await bcrypt.hash(password, 12),
      role: 'ADMIN',
      organizationId: organization.id,
    },
  });
  const project = await prisma.project.upsert({
    where: { organizationId_key: { organizationId: organization.id, key: 'DEMO' } },
    update: { createdById: user.id },
    create: {
      organizationId: organization.id,
      createdById: user.id,
      name: 'Demo Project',
      key: 'DEMO',
      description: 'Local ReqFlow demo project',
    },
  });
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: user.id } },
    update: { role: 'OWNER' },
    create: { projectId: project.id, userId: user.id, role: 'OWNER' },
  });
  const requirements = [
    {
      title: '统一登录与工作区访问',
      description: '支持邮箱登录、刷新令牌和按项目成员权限访问工作区。',
      status: RequirementStatus.DRAFT,
      priority: Priority.HIGH,
      userStories: ['作为成员，我可以安全登录并进入所属工作区。'],
      acceptanceCriteria: ['登录成功后进入工作台。', '无权限项目不会出现在项目列表。'],
    },
    {
      title: '知识库文档检索',
      description: '上传产品文档后，团队可以按关键词和语义检索相关内容。',
      status: RequirementStatus.IN_REVIEW,
      priority: Priority.HIGH,
      userStories: ['作为产品经理，我可以检索已有文档来补充需求背景。'],
      acceptanceCriteria: ['支持 Markdown 文档上传。', '检索结果按相关度排序。'],
    },
    {
      title: 'PRD 流程与审批',
      description: '从需求生成 PRD，经过评审后保留版本和审批记录。',
      status: RequirementStatus.IN_PROGRESS,
      priority: Priority.MEDIUM,
      userStories: ['作为负责人，我可以生成 PRD 并提交审批。'],
      acceptanceCriteria: ['PRD 包含背景、方案和验收标准。', '审批结果可追溯。'],
    },
    {
      title: '项目进度看板',
      description: '用状态分布和完成率展示项目当前进展。',
      status: RequirementStatus.DONE,
      priority: Priority.LOW,
      userStories: ['作为团队成员，我可以快速了解项目完成情况。'],
      acceptanceCriteria: ['看板展示需求状态分布。', '完成率与已完成需求一致。'],
    },
  ];
  const seededRequirements = [];
  for (const item of requirements) {
    const existing = await prisma.requirement.findFirst({
      where: { projectId: project.id, title: item.title },
    });
    const requirement = existing
      ? await prisma.requirement.update({ where: { id: existing.id }, data: item })
      : await prisma.requirement.create({
          data: { ...item, projectId: project.id, createdById: user.id },
        });
    seededRequirements.push(requirement);
  }

  const template =
    (await prisma.prdTemplate.findFirst({
      where: { projectId: project.id, name: 'ReqFlow 产品需求模板' },
    })) ??
    (await prisma.prdTemplate.create({
      data: {
        projectId: project.id,
        createdById: user.id,
        name: 'ReqFlow 产品需求模板',
        description: '用于演示需求到 PRD 的标准结构。',
        content: '# 背景与目标\n\n## 用户故事\n\n## 方案概述\n\n## 验收标准',
        variables: [],
        isDefault: true,
      },
    }));

  const prdContent = new Map([
    [
      '知识库文档检索',
      '# 知识库文档检索\n\n## 背景与目标\n让产品团队快速复用已有文档知识。\n\n## 方案概述\n上传文档后切分内容并生成向量，检索时结合关键词和语义相似度排序。\n\n## 验收标准\n- 支持 Markdown 上传。\n- 返回带相关度的检索结果。',
    ],
    [
      'PRD 流程与审批',
      '# PRD 流程与审批\n\n## 背景与目标\n统一需求评审产物，减少口头沟通遗漏。\n\n## 方案概述\n从需求生成 Markdown PRD，支持版本、审批和导出。\n\n## 验收标准\n- PRD 可生成并保存版本。\n- 审批状态可追踪。',
    ],
    [
      '项目进度看板',
      '# 项目进度看板\n\n## 背景与目标\n让团队在一个页面了解项目进展。\n\n## 方案概述\n按需求状态聚合数量，计算完成率并展示最近更新。\n\n## 验收标准\n- 状态分布准确。\n- 完成率可解释。',
    ],
  ]);
  const seededPrds = [];
  for (const requirement of seededRequirements) {
    const content = prdContent.get(requirement.title);
    if (!content) continue;
    const prd = await prisma.prd.upsert({
      where: { requirementId_version: { requirementId: requirement.id, version: 1 } },
      update: {
        title: requirement.title,
        content,
        status: PrdStatus.APPROVED,
        templateId: template.id,
      },
      create: {
        requirementId: requirement.id,
        version: 1,
        title: requirement.title,
        content,
        status: PrdStatus.APPROVED,
        templateId: template.id,
        createdById: user.id,
      },
    });
    seededPrds.push(prd);
  }

  const existingSpec = await prisma.technicalSpec.findFirst({
    where: { projectId: project.id, title: 'ReqFlow 演示技术规格' },
  });
  if (!existingSpec)
    await prisma.technicalSpec.create({
      data: {
        projectId: project.id,
        prdId: seededPrds[1]?.id,
        createdById: user.id,
        title: 'ReqFlow 演示技术规格',
        content:
          '# 架构\nNestJS API + Prisma + PostgreSQL。\n\n# 测试策略\n服务层单测、API 烟测和前端组件测试。',
        status: SpecStatus.APPROVED,
      },
    });

  const existingDecision = await prisma.technicalDecision.findFirst({
    where: { projectId: project.id, title: 'AI 服务采用本地降级策略' },
  });
  if (!existingDecision)
    await prisma.technicalDecision.create({
      data: {
        projectId: project.id,
        createdById: user.id,
        title: 'AI 服务采用本地降级策略',
        context: '本地开发和测试环境可能没有外部 AI 凭据。',
        decision: '无外部密钥时使用确定性的本地草稿和向量，生产环境再接入供应商。',
        consequences: '本地链路可独立验证，但真实供应商质量需要单独验收。',
        status: DecisionStatus.ACCEPTED,
      },
    });

  const knowledgeBase =
    (await prisma.knowledgeBase.findFirst({
      where: { projectId: project.id, name: 'ReqFlow 产品知识库' },
    })) ??
    (await prisma.knowledgeBase.create({
      data: {
        projectId: project.id,
        name: 'ReqFlow 产品知识库',
        description: '演示用产品背景、术语和验收约定。',
      },
    }));
  const documentContent =
    '# ReqFlow 产品概览\nReqFlow 用于管理需求、生成 PRD，并建立需求到代码和测试的追溯关系。\n\n核心模块包括项目管理、需求状态流转、知识库检索、PRD 审批和看板统计。';
  const document =
    (await prisma.knowledgeDocument.findFirst({
      where: { knowledgeBaseId: knowledgeBase.id, filename: 'product-overview.md' },
    })) ??
    (await prisma.knowledgeDocument.create({
      data: {
        knowledgeBaseId: knowledgeBase.id,
        filename: 'product-overview.md',
        mimeType: 'text/markdown',
        content: documentContent,
      },
    }));
  const chunks = documentContent.match(/.{1,1000}/gs) ?? [];
  for (const [position, content] of chunks.entries()) {
    await prisma.documentChunk.upsert({
      where: { documentId_position: { documentId: document.id, position } },
      update: { content, embedding: [1, 0, 0] },
      create: { documentId: document.id, position, content, embedding: [1, 0, 0] },
    });
  }

  if (seededRequirements.length > 1)
    await prisma.requirementDependency.upsert({
      where: {
        fromId_toId_type: {
          fromId: seededRequirements[1].id,
          toId: seededRequirements[0].id,
          type: 'depends_on',
        },
      },
      update: {},
      create: {
        fromId: seededRequirements[1].id,
        toId: seededRequirements[0].id,
        type: 'depends_on',
      },
    });
  for (const requirement of seededRequirements) {
    const prd = seededPrds.find((item) => item.requirementId === requirement.id);
    if (!prd) continue;
    for (const [kind, targetId] of [
      ['prd', prd.id],
      ['code', 'demo-' + requirement.id.slice(0, 8) + '.ts'],
      ['test', 'demo-' + requirement.id.slice(0, 8) + '.spec.ts'],
    ] as const) {
      const exists = await prisma.trace.findFirst({
        where: { requirementId: requirement.id, kind, targetId },
      });
      if (!exists)
        await prisma.trace.create({
          data: {
            requirementId: requirement.id,
            prdId: prd.id,
            kind,
            targetId,
            metadata: { source: 'seed-demo' },
          },
        });
    }
  }
  console.log(`Seeded organization, admin user ${email}, and project ${project.key}.`);
}

main().finally(() => prisma.$disconnect());
