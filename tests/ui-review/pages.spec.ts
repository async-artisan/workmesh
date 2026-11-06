import { expect, test, type Locator, type Page } from '@playwright/test';
import { installReviewFixtures, requirement } from './fixtures';

async function reachWithTab(page: Page, target: Locator) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  await expect(target).toBeFocused();
}

for (const kind of ['prd', 'knowledge'] as const) {
  test(`${kind} 双版本、同版本阻止、仅看修改、版本切换、失败重试和项目隔离`, async ({ page }) => {
    const fixture = await installReviewFixtures(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/${kind}?projectId=p1`);
    if (kind === 'knowledge') {
      const documentRow = page.getByRole('row').filter({ hasText: '验收文档 v1' }).first();
      await documentRow.getByRole('button', { name: '版本与评审（当前）', exact: true }).click();
      await page
        .getByRole('row')
        .filter({ hasText: '验收文档 v2' })
        .getByRole('button', { name: '查看正文', exact: true })
        .click();
    } else {
      const documentRow = page.getByRole('row').filter({ hasText: '验收文档 v2' }).first();
      await documentRow.getByRole('button', { name: '查看内容', exact: true }).click();
    }
    const diff = page.getByTestId(`${kind}-diff`);
    await expect(diff).toContainText('旧版条款');
    await expect(diff).toContainText('新版条款');
    expect(fixture.requests.some((path) => path.includes('/rev-1/content'))).toBe(true);
    expect(fixture.requests.some((path) => path.includes('/rev-2/content'))).toBe(true);
    const oldSelect = page.getByRole('combobox', { name: '对比旧版本' });
    const newSelect = page.getByRole('combobox', { name: '对比新版本' });
    await reachWithTab(page, oldSelect);
    await expect(oldSelect).toBeFocused();
    await reachWithTab(page, newSelect);
    await expect(newSelect).toBeFocused();
    await reachWithTab(page, diff.getByRole('button', { name: '仅看修改', exact: true }));
    await page.keyboard.press('Enter');
    await expect(diff.getByRole('button', { name: '显示完整上下文' })).toBeVisible();
    await newSelect.selectOption('rev-1');
    await expect(page.getByRole('button', { name: '对比所选版本' })).toBeDisabled();
    await expect(page.getByText('请选择两个不同的版本再对比。')).toBeVisible();
    await expect(diff).toHaveCount(0);
    await newSelect.selectOption('rev-3');
    await expect(diff).toHaveCount(0);
    await page.getByRole('button', { name: '对比所选版本' }).click();
    await expect(diff).toContainText('第三版条款');
    await expect(diff.getByRole('button', { name: '仅看修改', exact: true })).toBeVisible();
    fixture.controls.failContent = true;
    await page.getByRole('button', { name: '对比所选版本' }).click();
    await expect(page.getByText(/正文暂时不可用/).first()).toBeVisible();
    await expect(diff).toHaveCount(0);
    fixture.controls.failContent = false;
    await page.getByRole('button', { name: '对比所选版本' }).click();
    await expect(diff).toContainText('第三版条款');
    await page.screenshot({ path: `.tmp/ui-review-captures/${kind}-1440.png`, fullPage: true });
    await page.getByRole('combobox', { name: '选择项目', exact: true }).selectOption('p2');
    await expect(page).toHaveURL(/projectId=p2/);
    await expect(diff).toHaveCount(0);
    await expect(page.getByText('第三版条款', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('combobox', { name: '选择项目', exact: true })).toHaveValue('p2');
  });
}

for (const width of [1440, 1024, 640, 390]) {
  test(`${width}px 核心页面卡片、流程摘要、操作和页面溢出`, async ({ page }) => {
    await installReviewFixtures(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      '/',
      '/requirements?projectId=p1',
      '/reviews?projectId=p1',
      '/roles?projectId=p1',
      '/knowledge?projectId=p1',
      '/profile',
      '/pipeline?projectId=p1',
      '/requirements/DEMO-001?projectId=p1',
    ]) {
      await page.goto(path);
      await expect(page.locator('.content-area')).toBeVisible();
      await expect(page.locator('.skeleton-row, .skeleton-line').first()).toHaveCount(0, {
        timeout: 15000,
      });
      await expect(page.getByText('页面暂时无法显示', { exact: false })).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1);
      if (path === '/') {
        await expect(page.getByRole('region', { name: '优先行动' })).toBeVisible();
        await expect(page.getByText('范围：全部项目')).toBeVisible();
        const disclosure = page.getByText('证据与版本', { exact: true });
        await disclosure.click();
        await expect(page.getByText('证据 2 件', { exact: false })).toBeVisible();
        await disclosure.click();
        await page.getByRole('button', { name: '打开待审批', exact: true }).focus();
        await expect(page.getByRole('button', { name: '打开待审批', exact: true })).toBeFocused();
      }
      if (path.startsWith('/requirements?')) {
        await expect(page.getByText(requirement.title, { exact: true })).toBeVisible();
        if (width <= 640) {
          const card = page.getByTestId('requirement-card').first();
          await expect(card).toContainText('DEMO-001');
          await expect(card).toContainText('负责人：服务端未提供负责人');
          await expect(card).toContainText('下一步：');
          const summary = card.locator('summary');
          await summary.focus();
          await page.keyboard.press('Enter');
          await expect(card.getByText('版本：v3', { exact: true })).toBeVisible();
          await page.keyboard.press('Space');
          await expect(card.getByText('版本：v3', { exact: true })).toBeHidden();
          expect(
            await card
              .locator('.wm-mobile-card-meta')
              .first()
              .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
          ).toBeGreaterThanOrEqual(12);
        }
      }
      if (width <= 640 && path.startsWith('/reviews?')) {
        const card = page.getByTestId('review-card').first();
        await expect(card).toContainText('下一步：打开评审');
        await card.locator('summary').click();
        await expect(card.getByText('评审对象标识：fixture')).toBeVisible();
        await card.locator('summary').click();
        await expect(card.getByRole('button', { name: '打开评审', exact: true })).toBeVisible();
      }
      if (width <= 640 && path.startsWith('/roles?')) {
        const card = page.getByTestId('roles-member-card').first();
        await expect(card).toContainText('fixture@example.test');
        await expect(card).toContainText('下一步：管理业务角色');
        await card.locator('summary').click();
        await expect(card.getByText('成员版本：v1', { exact: true })).toBeVisible();
        await card.locator('summary').click();
        await card.getByRole('button', { name: '管理角色', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      }
      if (path.startsWith('/knowledge?')) {
        const hint = page.locator('.knowledge-search-browse-copy span');
        await expect(hint).toBeVisible();
        expect(
          await hint.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
        ).toBeGreaterThanOrEqual(12);
      }
      if (width <= 640 && path === '/profile') {
        const card = page.locator('.profile-credential-card').first();
        await expect(card).toContainText('验收凭据');
        await expect(card).toContainText('下一步：');
        await card.getByText('查看凭据详情', { exact: true }).click();
        await expect(card.getByText(/凭据 ID/)).toBeVisible();
        expect(
          await card
            .locator('.profile-credential-id')
            .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
        ).toBeGreaterThanOrEqual(12);
        await card.getByText('查看凭据详情', { exact: true }).click();
      }
      if (path.includes('/requirements/')) {
        await expect(page.getByText('当前阶段', { exact: true })).toBeVisible();
        const facts = page.getByLabel('当前阶段执行信息');
        await expect(facts).toContainText('fixture@example.test');
        await expect(facts).toContainText('开发实现');
        await expect(facts).not.toContainText('暂未分配责任人');
        const fact = facts.locator('strong').last();
        await fact.evaluate((element) => {
          element.textContent = '较长的阻塞原因或下一步'.repeat(12);
        });
        const factStyle = await fact.evaluate((element) => ({
          fontSize: parseFloat(getComputedStyle(element).fontSize),
          whiteSpace: getComputedStyle(element).whiteSpace,
          clipped: element.scrollWidth > element.clientWidth + 1,
        }));
        expect(factStyle.fontSize).toBeGreaterThanOrEqual(14);
        expect(factStyle.whiteSpace).not.toBe('nowrap');
        expect(factStyle.clipped).toBe(false);
        const expand = page.getByRole('button', { name: '展开团队视图', exact: true });
        await expand.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('button', { name: '收起团队视图', exact: true })).toBeVisible();
        const rail = page.getByRole('region', { name: '阶段进度，可横向滚动', exact: true });
        await expect(rail).toBeVisible();
        await expect(rail.locator('[aria-current="step"]')).toContainText('开发');
        const taskTitle = page.locator('.pipeline-task-card strong').first();
        await expect(taskTitle).toBeVisible();
        expect(
          await taskTitle.evaluate((element) => ({
            fontSize: parseFloat(getComputedStyle(element).fontSize),
            whiteSpace: getComputedStyle(element).whiteSpace,
          })),
        ).toEqual({ fontSize: 14, whiteSpace: 'normal' });
        const stateBorders = await page
          .locator('.pipeline-task-card')
          .first()
          .evaluate((card) => {
            const originalClass = card.className;
            const probe = document.createElement('span');
            document.body.appendChild(probe);
            const states = [
              ['claimable', '--wm-color-success-border'],
              ['waiting_predecessor', '--wm-color-warning-border'],
              ['in_progress', '--wm-color-accent-border'],
              ['blocked_or_frozen', '--wm-color-danger-border'],
            ];
            const results = states.map(([state, token]) => {
              card.className = originalClass.replace(/\bis-state-[\w-]+/g, '');
              card.classList.add(`is-state-${state}`);
              probe.style.borderColor = `var(${token})`;
              const style = getComputedStyle(card);
              return {
                matches: style.borderColor === getComputedStyle(probe).borderColor,
                dashed: state !== 'waiting_predecessor' || style.borderStyle === 'dashed',
              };
            });
            card.className = originalClass;
            probe.remove();
            return results;
          });
        expect(stateBorders).toEqual(Array(4).fill({ matches: true, dashed: true }));
        await page.keyboard.press('Space');
        await expect(page.getByRole('button', { name: '展开团队视图', exact: true })).toBeVisible();
      }
      await page.screenshot({
        path: `.tmp/ui-review-captures/${width}-${path.split('?')[0].replaceAll('/', '-') || 'workbench'}.png`,
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  });
}

test('工作台 stale 行动区与筛选统计一致', async ({ page }) => {
  const { controls } = await installReviewFixtures(page);
  await page.goto('/');
  const actions = page.getByRole('region', { name: '优先行动' });
  await expect(actions.getByText('待审批 · 1', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索待办' }).fill('不存在的验收搜索');
  await expect(actions.getByText('待审批 · 0', { exact: true })).toBeVisible();
  await expect(actions.getByRole('button', { name: '打开待审批', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '搜索待办' }).fill('');
  controls.failWorkbench = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(actions.getByText('行动项可能已过期，请刷新后确认。')).toBeVisible();
  await expect(actions.getByText('待审批 · 1', { exact: true })).toBeVisible();
  controls.failWorkbench = false;
  await page.getByRole('button', { name: '重试更新工作台数据' }).click();
  await expect(actions.getByText('行动项可能已过期，请刷新后确认。')).toHaveCount(0);
});

for (const status of [403, 500, 200]) {
  test(`项目列表 ${status === 200 ? '成功为空' : status} 不与权限或加载失败混淆`, async ({
    page,
  }) => {
    const { controls } = await installReviewFixtures(page);
    controls.projectStatus = status;
    controls.emptyProjects = status === 200;
    await page.goto('/requirements');
    if (status === 200) {
      const create = page.getByRole('button', { name: '创建项目', exact: true });
      await expect(create).toBeVisible();
      await expect(page.getByText(/打开管理员发送的邀请链接/)).toBeVisible();
      await expect(page.getByRole('button', { name: '接受邀请', exact: true })).toHaveCount(0);
      await create.click();
      await expect(page).toHaveURL(/\/projects$/);
    } else {
      await expect(page.getByText('项目列表加载失败', { exact: true })).toBeVisible();
      await expect(
        page.getByText(
          status === 403
            ? '当前账号没有查看项目列表的权限，请联系项目管理员。'
            : '项目服务暂时不可用，请稍后重试。',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: '创建项目', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '接受邀请', exact: true })).toHaveCount(0);
      controls.projectStatus = 200;
      await page.getByRole('button', { name: '重试加载项目列表' }).click();
      await expect(page.getByRole('combobox', { name: '选择项目', exact: true })).toBeEnabled();
    }
  });
}

test('工作台真实行动入口打开任务，URL 项目和任务定位可刷新恢复', async ({ page }) => {
  await installReviewFixtures(page);
  await page.goto('/?projectId=p1');
  await expect(page.getByText('范围：验收示例项目')).toBeVisible();
  await page.getByRole('button', { name: '打开可开工任务', exact: true }).click();
  await expect(page).toHaveURL(/\/requirements\/DEMO-001\?/);
  await expect(page).toHaveURL(/projectId=p1/);
  await expect(page).toHaveURL(/taskId=task-1/);
  await expect(page.getByRole('tab', { name: /任务/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#requirement-task-task-1')).toBeFocused();
  await page.reload();
  await expect(page.locator('#requirement-task-task-1')).toBeFocused();
});
