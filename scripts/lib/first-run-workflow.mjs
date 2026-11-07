/**
 * Build a real published product baseline for a small first-run QA acceptance.
 * Every write uses the official API, including password-bound confirmation
 * tickets. IMPL remains part of the delivery scope and is deliberately left
 * unfinished: accepting QA evidence must never imply release approval.
 */
export async function prepareFirstRunWorkflow({
  call,
  project,
  password,
  title,
  workflowKey,
  roleId,
  userId,
}) {
  async function confirmation(binding) {
    const preview = await call('POST', '/auth/action-previews', binding);
    const ticket = await call('POST', '/auth/confirmation-tickets', {
      ...binding,
      actionDigest: preview.actionDigest,
      password,
    });
    return { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret };
  }

  async function approve(reviewId) {
    let review = await call('GET', '/review-requests/' + reviewId);
    while (review.status === 'OPEN') {
      const slot = review.slots.find((item) => !item.decided && item.viewerCanDecide);
      if (!slot) throw new Error('No human approval slot for baseline review ' + reviewId);
      const binding = {
        action: 'REVIEW_DECIDE',
        projectId: project.id,
        targetType: 'REVIEW_REQUEST',
        targetId: review.id,
        expectedVersion: review.version,
        roleSlot: slot.requiredRoleId
          ? { roleId: slot.requiredRoleId, approvalSlotId: slot.id }
          : null,
        payload: {
          slotId: slot.id,
          decision: 'APPROVE',
          subjectDigest: review.subjectDigest,
          comment: null,
        },
      };
      await call('POST', '/review-requests/' + review.id + '/decisions', {
        slotId: slot.id,
        decision: 'APPROVE',
        expectedVersion: review.version,
        comment: null,
        confirmation: await confirmation(binding),
      });
      review = await call('GET', '/review-requests/' + reviewId);
    }
    if (review.status !== 'APPROVED')
      throw new Error('Baseline review was not approved: ' + reviewId);
  }

  const requirement = await call('POST', '/projects/' + project.id + '/requirements', {
    title,
    description:
      'First-run QA acceptance of a real published PRD; implementation and release remain pending.',
  });
  const knowledgeBase = await call('POST', '/projects/' + project.id + '/knowledge-bases', {
    key: 'first-run-baseline',
    name: 'First-run product baseline',
    visibility: 'PROJECT',
  });
  async function publish(kind, heading, markdown, extra = {}) {
    const candidate = await call('POST', '/projects/' + project.id + '/documents', {
      knowledgeBaseId: knowledgeBase.id,
      kind,
      ...(kind === 'KNOWLEDGE' ? {} : { requirementId: requirement.id }),
      title: heading,
      mimeType: 'text/markdown; charset=utf-8',
      bodyBase64: Buffer.from(markdown, 'utf8').toString('base64'),
      ...extra,
    });
    await approve(candidate.reviewRequestId);
    const document = await call('GET', '/documents/' + candidate.document.id);
    if (!document.publishedRevision?.id)
      throw new Error('Baseline document was not published: ' + kind);
    return { documentId: document.document.id, revisionId: document.publishedRevision.id };
  }
  const understanding = await publish(
    'UNDERSTANDING',
    'First-run understanding',
    '# First-run understanding\n\nThe human reads QA evidence and records a password-confirmed decision. Implementation and release approval are separate work.\n',
  );
  const prd = await publish(
    'PRD',
    'First-run PRD',
    '# First-run PRD\n\n## Scope\n\nRetain implementation, QA evidence, and release acceptance as distinct responsibilities.\n\n## Acceptance\n\n- ac-first-run: A human reads the delivered cases, approves using password confirmation, and can reload the persisted decision.\n',
    {
      basisUnderstandingRevisionId: understanding.revisionId,
      deliveryScope: {
        participatingRoleIds: ['frontend', 'qa', 'ops'].map(roleId),
        requiredOutputKinds: ['IMPL', 'CASES', 'RELEASE'],
        excludedRoles: [],
      },
      acceptance: [
        {
          key: 'ac-first-run',
          text: 'Human QA approval persists after reload.',
          verification: 'TEST',
        },
      ],
    },
  );
  const contract = await publish(
    'KNOWLEDGE',
    'First-run interface contract',
    '# First-run interface contract\n\nUse the official task claim, context snapshot and artifact-set APIs. Deliver hosted Markdown CASES with SHA-256 and retain the task acceptance audit. Implementation must use a project repository and valid code review evidence; this first-run does not claim that implementation is complete.\n',
  );
  const prdInput = {
    inputKey: 'prd',
    source: 'EXTERNAL_INPUT',
    externalKey: 'prd:' + prd.revisionId,
    reason:
      'Published PRD document ' +
      prd.documentId +
      ', revision ' +
      prd.revisionId +
      '; also bound by the PUBLISHED_PRD task snapshot.',
  };
  const definition = {
    schemaVersion: '1.0',
    protocolVersion: '1.0',
    workflowKey,
    title: 'First-run QA acceptance with implementation retained',
    baseRevisionId: null,
    roleExclusions: [],
    stepRemovals: [],
    roleSlots: [
      { key: 'task-acceptance', roleKey: 'qa', kind: 'TASK_ACCEPTANCE' },
      { key: 'release-acceptance', roleKey: 'ops', kind: 'RELEASE_ACCEPTANCE' },
    ],
    steps: [
      {
        key: 'impl',
        displayName: '实现任务（保留待办）',
        roleKey: 'frontend',
        kind: 'DELIVERY',
        deps: [],
        outputKinds: ['IMPL'],
        baselinePolicy: 'PUBLISHED_PRD',
        inputBindings: [
          prdInput,
          {
            inputKey: 'contract',
            source: 'EXTERNAL_INPUT',
            externalKey: 'contract:' + contract.revisionId,
            reason:
              'Published interface contract ' +
              contract.documentId +
              ', revision ' +
              contract.revisionId,
          },
        ],
        gates: [{ mode: 'ALL', reviewerSlots: ['task-acceptance'] }],
      },
      {
        key: 'cases',
        displayName: '浏览器验收用例',
        roleKey: 'qa',
        kind: 'VERIFY',
        deps: [],
        outputKinds: ['CASES'],
        baselinePolicy: 'PUBLISHED_PRD',
        inputBindings: [prdInput],
        gates: [{ mode: 'ALL', reviewerSlots: ['task-acceptance'] }],
      },
      {
        key: 'release',
        displayName: '后续发布任务',
        roleKey: 'ops',
        kind: 'RELEASE',
        deps: ['impl', 'cases'],
        outputKinds: ['RELEASE'],
        baselinePolicy: 'PUBLISHED_PRD',
        inputBindings: [prdInput],
        gates: [{ mode: 'ALL', reviewerSlots: ['task-acceptance', 'release-acceptance'] }],
      },
    ],
  };
  const packages = await call('GET', '/projects/' + project.id + '/role-packages?limit=100');
  const packageLocks = ['frontend', 'ops', 'qa'].map((key) => {
    const selected = packages.items
      .filter((item) => item.roleKey === key)
      .sort((a, b) => a.version.localeCompare(b.version))
      .at(-1);
    if (!selected) throw new Error('No builtin role package for ' + key);
    return {
      roleKey: key,
      packageId: selected.packageId,
      version: selected.version,
      packageDigest: selected.manifestDigest,
    };
  });
  const validation = await call(
    'POST',
    '/projects/' + project.id + '/workflow-definitions/validate',
    { definition, packageLocks },
  );
  if (!validation.valid)
    throw new Error('First-run workflow is invalid: ' + JSON.stringify(validation.issues));
  const projects = await call('GET', '/projects');
  const currentProject = projects.find((item) => item.id === project.id);
  if (!currentProject) throw new Error('First-run project is not accessible: ' + project.id);
  const binding = {
    action: 'WORKFLOW_CONFIG_PUBLISH',
    projectId: project.id,
    targetType: 'WORKFLOW_DEFINITION',
    targetId: workflowKey,
    expectedVersion: currentProject.version,
    roleSlot: null,
    payload: { expectedCurrentRevision: 0, compiledDigest: validation.digest, packageLocks },
  };
  const published = await call(
    'POST',
    '/projects/' + project.id + '/workflow-definitions/' + workflowKey + '/publish',
    {
      expectedVersion: currentProject.version,
      expectedCurrentRevision: 0,
      definition,
      packageLocks,
      confirmation: await confirmation(binding),
    },
  );
  // This is an explicit declaration only; the reserved .invalid host cannot be
  // mistaken for a provider-verified repository or implementation evidence.
  const locator = 'https://first-run.invalid/workmesh/' + project.key.toLowerCase() + '.git';
  const repositoryBinding = {
    action: 'REPOSITORY_DECLARE',
    projectId: project.id,
    targetType: 'PROJECT',
    targetId: project.id,
    expectedVersion: published.projectVersion,
    roleSlot: null,
    payload: {
      locator,
      targetRepositoryId: null,
      displayName: 'First-run implementation placeholder',
    },
  };
  const declaration = await call('POST', '/projects/' + project.id + '/repositories/declarations', {
    expectedProjectVersion: published.projectVersion,
    locator,
    displayName: 'First-run implementation placeholder',
    confirmation: await confirmation(repositoryBinding),
  });
  if (declaration.identityMode !== 'DECLARED')
    throw new Error('First-run repository must remain declared');
  const repository = { ...declaration, id: declaration.repositoryId };
  const detail = await call('GET', '/projects/' + project.id + '/requirements/' + requirement.code);
  await call('POST', '/requirements/' + requirement.id + '/workflow-instances', {
    definitionRevisionId: published.definitionRevisionId,
    expectedRequirementVersion: detail.requirement.version,
    stepBindings: definition.steps.map((step) => ({
      stepKey: step.key,
      roleId: roleId(step.roleKey),
      responsibleUserId: userId,
      repositoryIds: step.key === 'impl' ? [repository.id] : [],
      acceptanceKeys: step.key === 'cases' ? ['ac-first-run'] : [],
    })),
    roleSlotBindings: definition.roleSlots.map((slot) => ({
      slotKey: slot.key,
      roleId: roleId(slot.roleKey),
      userId,
    })),
  });
  return { requirement, published, definition, understanding, prd, contract, repository };
}
