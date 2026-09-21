// e2e/git.spec.ts
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { TEST_PASSWORD } from './testPassword';

const fixtureDir = path.resolve(__dirname, 'fixture-git-workspace');

test.beforeAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: fixtureDir });
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: fixtureDir });
  execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: fixtureDir });
  writeFileSync(path.join(fixtureDir, 'tracked.txt'), 'original\n');
  execFileSync('git', ['add', '.'], { cwd: fixtureDir });
  execFileSync('git', ['commit', '-q', '-m', 'initial commit'], { cwd: fixtureDir });
});

test.afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

test.beforeEach(async ({ context, baseURL }) => {
  await context.request.post(`${baseURL}/api/login`, { data: { password: TEST_PASSWORD } });
});

test('stages and commits a change from the git panel', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Project folder path').fill(fixtureDir);
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await page.getByRole('button', { name: 'tracked.txt', exact: true }).click();

  const editor = page.locator('.monaco-editor');
  await editor.click();
  await editor.press('ControlOrMeta+A');
  await editor.pressSequentially('changed content', { delay: 30 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await page.getByRole('tab', { name: 'Git' }).click();
  const gitPanel = page.locator('.git-panel');
  await expect(gitPanel.getByText('tracked.txt')).toBeVisible();
  await page.getByLabel('Stage tracked.txt').click();
  await expect(page.getByText('Staged (1)')).toBeVisible();
  await page.getByLabel('Commit message').fill('update tracked file');
  await page.getByRole('button', { name: 'Commit', exact: true }).click();
  await expect(page.getByText('Staged (0)')).toBeVisible();
});
