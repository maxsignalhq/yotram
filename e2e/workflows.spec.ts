import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { TEST_PASSWORD } from './testPassword';

let root: string;
test.beforeEach(async ({ context, page }) => {
  root = mkdtempSync(path.join(tmpdir(), 'yotram-browser-'));
  writeFileSync(path.join(root, 'app.txt'), 'Initial code');
  await context.request.post('/api/login', { data: { password: TEST_PASSWORD } });
  await page.goto('/');
  await page.getByLabel('Project folder path').fill(root);
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
});
test.afterEach(async ({ context }) => {
  const projects = await (await context.request.get('/api/workspaces')).json();
  for (const project of projects) if (project.path.endsWith(path.basename(root))) {
    for (const session of project.sessions) await context.request.delete(`/api/workspaces/${project.id}/sessions/${session.id}`);
    await context.request.delete(`/api/workspaces/${project.id}`);
  }
  rmSync(root, { recursive: true, force: true });
});

test('retains a terminal after reload and restores a handoff on a second browser', async ({ page, browser, baseURL }) => {
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Workspace tools' });
  await panel.getByRole('button', { name: 'Resources', exact: true }).click();
  await panel.getByLabel('Run a tracked command').fill('echo CONTINUITY_CHECK');
  await panel.getByRole('button', { name: 'Run command', exact: true }).click();
  await expect(page.locator('.terminal-container')).toContainText('CONTINUITY_CHECK');
  await page.getByRole('button', { name: 'Close workspace tools' }).click();
  await page.reload();
  await page.getByRole('button', { name: new RegExp('^' + path.basename(root)) }).click();
  await expect(page.locator('.terminal-container')).toContainText('CONTINUITY_CHECK');
  await page.getByRole('button', { name: 'app.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await panel.getByRole('button', { name: 'Handoffs', exact: true }).click();
  await panel.getByLabel('Notes', { exact: true }).fill('Continue the layout investigation');
  await panel.getByLabel('Next step', { exact: true }).fill('Check the narrow viewport');
  await panel.getByRole('button', { name: 'Save handoff' }).click();
  await expect(panel.getByText('Continue the layout investigation', { exact: true })).toBeVisible();
  const other = await browser.newContext({ baseURL });
  try {
    await other.request.post('/api/login', { data: { password: TEST_PASSWORD } });
    const second = await other.newPage(); await second.goto('/');
    await second.getByRole('button', { name: new RegExp('^' + path.basename(root)) }).click();
    await expect(second.locator('.terminal-container')).toContainText('CONTINUITY_CHECK');
    await second.getByRole('button', { name: 'Workspace tools', exact: true }).click();
    const tools = second.getByRole('complementary', { name: 'Workspace tools' });
    await tools.getByRole('button', { name: 'Handoffs', exact: true }).click();
    await expect(tools.getByText('Check the narrow viewport', { exact: false })).toBeVisible();
    await tools.getByRole('button', { name: 'Restore context' }).click();
    await expect(second.locator('.monaco-editor')).toContainText('Initial code');
    await tools.getByRole('button', { name: /^Recap/ }).click();
    await expect(tools.getByText('Command finished (exit 0)', { exact: true })).toBeVisible();
    await second.screenshot({ path: '/tmp/yotram-workspace-tools.png' });
    await tools.getByRole('button', { name: 'Mark as read' }).click();
    await expect(tools.getByText('No matching activity.', { exact: false })).toBeVisible();
  } finally { await other.close(); }
});

test('creates a dirty checkpoint and an isolated alternative, then compares and discards it', async ({ page, context }) => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com'); git('add', '.'); git('commit', '-qm', 'Initial');
  writeFileSync(path.join(root, 'app.txt'), 'Uncommitted checkpoint content');
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Workspace tools' });
  await panel.getByRole('button', { name: 'Experiments', exact: true }).click();
  await panel.getByLabel('Checkpoint name', { exact: true }).fill('Before alternate layout');
  await panel.getByRole('button', { name: 'Create checkpoint' }).click();
  await expect(panel.getByLabel('Evidence and context')).toContainText('Uncommitted checkpoint content');
  await panel.getByLabel('Experiment name', { exact: true }).fill('Alternate layout');
  await panel.getByRole('button', { name: 'Try an alternative' }).click();
  await expect(panel.getByText('Alternate layout', { exact: true })).toBeVisible();
  const workspaces = await (await context.request.get('/api/workspaces')).json();
  const parent = workspaces.find((w: any) => w.path.endsWith(path.basename(root)));
  const history = await (await context.request.get(`/api/workspaces/${parent.id}/activity`)).json();
  writeFileSync(path.join(history.experiments[0].path, 'alternative.txt'), 'Alternative only');
  await panel.getByRole('button', { name: 'Compare changes' }).click();
  await expect(panel.getByLabel('Evidence and context')).toContainText('Alternative only');
  page.once('dialog', dialog => dialog.accept());
  await panel.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(panel.getByText('Alternate layout', { exact: true })).toHaveCount(0);
});

test('shows the race form but disables it when no agents are installed', async ({ page }) => {
  await page.route('**/api/agents', route => route.fulfill({ json: { claude: false, codex: false } }));
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Workspace tools' });
  await panel.getByRole('button', { name: 'Experiments', exact: true }).click();
  await expect(panel.getByLabel('Race task')).toBeVisible();
  await expect(panel.getByText('No agents detected on the server PATH.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Start race' })).toBeDisabled();
});

test('compares race results side by side and persists a winner pick', async ({ page }) => {
  const claudeDiff = `diff --git a/app.txt b/app.txt\nindex 1111111..2222222 100644\n--- a/app.txt\n+++ b/app.txt\n@@ -1,1 +1,2 @@\n Initial code\n+claude change\n`;
  const codexDiff = `diff --git a/app.txt b/app.txt\nindex 1111111..3333333 100644\n--- a/app.txt\n+++ b/app.txt\n@@ -1,1 +1,3 @@\n Initial code\n+codex change one\n+codex change two\n`;
  const raceId = 'e2e-race-1';
  const members = [
    { id: 'e2e-claude', name: 'claude — task', path: root, branch: 'yotram/experiment-e2e-1', base: 'abc', at: Date.now(), port: 4101, raceId, agent: 'claude' },
    { id: 'e2e-codex', name: 'codex — task', path: root, branch: 'yotram/experiment-e2e-2', base: 'abc', at: Date.now(), port: 4102, raceId, agent: 'codex' },
  ];
  await page.route('**/api/workspaces/*/activity', route => {
    if (route.request().method() !== 'GET') return route.continue();
    route.fulfill({ json: { events: [], handoffs: [], checkpoints: [], experiments: members, retentionDays: 30 } });
  });
  await page.route('**/experiments/e2e-claude/diff', route => route.fulfill({ json: { diff: claudeDiff } }));
  await page.route('**/experiments/e2e-codex/diff', route => route.fulfill({ json: { diff: codexDiff } }));
  await page.route('**/experiments/e2e-claude/winner', route => {
    members[0].winner = true; members[1].winner = false;
    route.fulfill({ json: { ok: true } });
  });

  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Workspace tools' });
  await panel.getByRole('button', { name: 'Experiments', exact: true }).click();
  await panel.getByRole('button', { name: 'Compare race' }).click();
  await expect(panel.getByText('1 file · +1/-0')).toBeVisible();
  await expect(panel.getByText('1 file · +2/-0')).toBeVisible();

  await panel.getByRole('button', { name: '★ Mark winner' }).first().click();
  await expect(panel.getByText('★ Winner')).toBeVisible();
});

test('captures an element and screenshot from the isolated preview into a reviewable task', async ({ page }) => {
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html><body style="background:white;color:black;font-family:sans-serif"><h1>Preview capture</h1><button data-source="src/Button.tsx">Change this button</button></body></html>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByLabel('Port', { exact: true }).fill(String(address.port));
    await page.getByRole('checkbox', { name: /Enable element capture/ }).check();
    await page.getByRole('button', { name: 'Load preview' }).click();
    await expect(page.frameLocator('iframe[title="Local app preview"]').getByRole('heading')).toHaveText('Preview capture');
    await expect(page.getByRole('button', { name: 'Select element', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Select element', exact: true }).click();
    await page.frameLocator('iframe[title="Local app preview"]').getByRole('button').click();
    await expect(page.getByRole('heading', { name: 'Review captured context' })).toBeVisible();
    await page.getByLabel('Task request').fill('Increase the padding');
    await expect(page.getByLabel('Prepared task')).toContainText('src/Button.tsx');
    await expect(page.getByRole('img', { name: 'Captured app viewport' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove screenshot' }).click();
    await expect(page.getByRole('img', { name: 'Captured app viewport' })).toHaveCount(0);
  } finally { server.closeAllConnections(); server.close(); }
});
