import { randomInt, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('real registration, cookie session, lazy pages, reload and logout', async ({
  page,
  context,
}) => {
  const email = `browser-${randomUUID()}@acceptance.test`;
  const password = `Browser-${randomUUID()}!`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/register');
  await page.getByLabel('姓名', { exact: true }).fill('Browser acceptance');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page.getByRole('button', { name: `账号菜单：${email}` })).toBeVisible();
  const session = (await context.cookies()).find((cookie) => cookie.name === 'wm_session');
  expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((key) => /token|secret/i.test(key))),
  ).toEqual([]);

  await page.goto('/projects');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const projectName = `Browser project ${randomUUID()}`;
  const projectKey = Array.from({ length: 6 }, () => String.fromCharCode(65 + randomInt(26))).join(
    '',
  );
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('项目名称', { exact: true }).fill(projectName);
  await dialog.getByLabel('项目 Key', { exact: true }).fill(projectKey);
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: projectName })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: `账号菜单：${email}` })).toBeVisible();
  await page.getByRole('button', { name: `账号菜单：${email}` }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: `账号菜单：${email}` })).toBeVisible();
  expect(errors).toEqual([]);
});

test('anonymous write without CSRF is rejected by the real API', async ({ page }) => {
  await page.goto('/login');
  const result = await page.evaluate(async () => {
    await fetch('/api/v1/auth/session');
    const response = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rejected@acceptance.test', password: 'Rejected-Password1!' }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(result.status).toBe(403);
  expect(JSON.stringify(result.body)).toMatch(/CSRF/);
});
