import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEST_PASSWORD } from './testPassword';

let root: string;
test.beforeEach(async ({ context, page }) => {
  root = mkdtempSync(path.join(tmpdir(), 'yotram-continuity-'));
  writeFileSync(path.join(root, 'app.txt'), 'Initial code');
  writeFileSync(path.join(root, 'other.txt'), 'Other file');
  await context.request.post('/api/login', { data: { password: TEST_PASSWORD } });
  await page.goto('/');
  await page.getByLabel('Project folder path').fill(root);
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
});
test.afterEach(async ({ context }) => {
  const projects = await (await context.request.get('/api/workspaces')).json();
  for (const project of projects) if (project.path.endsWith(path.basename(root))) {
    for (const session of project.sessions ?? []) await context.request.delete(`/api/workspaces/${project.id}/sessions/${session.id}`).catch(() => {});
    await context.request.delete(`/api/workspaces/${project.id}`).catch(() => {});
  }
  rmSync(root, { recursive: true, force: true });
});

test("a second device opening the same workspace resumes the first device's open file, sidebar tab, and preview state", async ({ page, browser, baseURL }) => {
  await page.getByRole('button', { name: 'other.txt', exact: true }).click();
  await page.getByRole('tab', { name: 'Git' }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByLabel('Port', { exact: true }).fill('43179');
  // The port is only reported upward when a load is requested; the load itself may fail.
  await page.getByRole('button', { name: 'Load preview', exact: true }).click();

  // Give the debounced view:update sends time to reach the server.
  await page.waitForTimeout(1500);

  const other = await browser.newContext({ baseURL });
  try {
    await other.request.post('/api/login', { data: { password: TEST_PASSWORD } });
    const second = await other.newPage();
    await second.goto('/');
    await second.getByRole('button', { name: new RegExp('^' + path.basename(root)) }).click();
    await expect(second.getByRole('tab', { name: /^other\.txt/ })).toBeVisible();
    await expect(second.getByRole('tab', { name: 'Git' })).toHaveAttribute('aria-selected', 'true');
    await expect(second.getByLabel('Port', { exact: true })).toHaveValue('43179');
  } finally { await other.close(); }
});
