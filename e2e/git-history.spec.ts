import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEST_PASSWORD } from './testPassword';

test('Git History opens from Plugins and browses read-only commit diffs', async ({ page, context }) => {
  test.setTimeout(60000);
  const root = mkdtempSync(path.join(tmpdir(), 'yotram-git-history-browser-'));
  let workspaceId = '';
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'history@example.com']); git(['config', 'user.name', 'History Tester']);
  writeFileSync(path.join(root, 'notes.md'), 'first version\n'); git(['add', '.']); git(['commit', '-q', '-m', 'Add notes']);
  writeFileSync(path.join(root, 'notes.md'), 'second version\n'); git(['add', '.']); git(['commit', '-q', '-m', 'Update notes']);
  try {
    await context.request.post('/api/login', { data: { password: TEST_PASSWORD } });
    await page.goto('/');
    await page.getByLabel('Project folder path').fill(root);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await expect(page.locator('.workspace-header')).toBeVisible();
    const projects = await (await context.request.get('/api/workspaces')).json();
    workspaceId = projects.find((project: { path: string }) => project.path.endsWith(path.basename(root))).id;
    await page.getByRole('button', { name: 'Plugins', exact: true }).click();
    const plugins = page.getByRole('dialog', { name: 'Yotram plugins' });
    await plugins.getByRole('button', { name: 'Enable Git History' }).click();
    await plugins.getByRole('button', { name: 'Open Git History' }).click();
    const history = page.getByRole('dialog', { name: 'Git History' });
    await expect(history.getByRole('button', { name: /Update notes/ })).toBeVisible();
    await expect(history.getByRole('button', { name: /Add notes/ })).toBeVisible();
    await expect(history.locator('.git-history-diff-title')).toContainText('notes.md');
    await history.getByRole('button', { name: /Add notes/ }).click();
    await expect(history.locator('.git-history-diff-title')).toContainText('notes.md');
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toBe('');
    await history.getByRole('button', { name: 'Close Git History' }).click();
    await expect(history).toHaveCount(0);
  } finally {
    if (workspaceId) {
      await context.request.put(`/api/workspaces/${workspaceId}/plugins/yotram.git-history`, { data: { enabled: false }, timeout: 3000 }).catch(() => {});
      await context.request.delete(`/api/workspaces/${workspaceId}`, { timeout: 3000 }).catch(() => {});
    }
    rmSync(root, { recursive: true, force: true });
  }
});
