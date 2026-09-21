import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TEST_PASSWORD } from './testPassword';

const fixtureDir = path.resolve(__dirname, 'fixture-workspace');

test.beforeAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(path.join(fixtureDir, 'sample.txt'), 'before');
  mkdirSync(path.join(fixtureDir, 'src'));
  writeFileSync(path.join(fixtureDir, 'src', 'nested.ts'), 'export const value = 42;');
});

test.afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

test.beforeEach(async ({ context, baseURL }) => {
  await context.request.post(`${baseURL}/api/login`, {
    data: { password: TEST_PASSWORD },
  });
});

test('edit a file and run a shell command end-to-end', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open current directory' }).click();
  await page.getByRole('button', { name: 'sample.txt' }).click();

  // Assert the fs:read round trip actually loaded the fixture's original
  // content into Monaco before editing. This both exercises the read half of
  // the loop (not just the write half) and guards against a race where
  // select-all below would silently select nothing if Monaco were still empty.
  await expect(page.locator('.monaco-editor')).toContainText('before');

  // Monaco (Task 10) renders its input as a zero-size `.native-edit-context`
  // element that Playwright's actionability checks treat as not visible/clickable.
  // Clicking the visible `.monaco-editor` surface focuses that hidden input the
  // same way a real user click does, and keyboard events are then routed to it.
  const editorSurface = page.locator('.monaco-editor');
  await editorSurface.click();
  // Monaco's own keybinding service is platform-aware (it detects the "mac"
  // class in this sandbox) and only binds select-all to Cmd+A there, not
  // Ctrl+A, so `ControlOrMeta` is used to stay correct on both platforms.
  await editorSurface.press('ControlOrMeta+A');
  // A small per-keystroke delay avoids a race with Monaco's async model update
  // that otherwise drops the final character when typed at full speed.
  await editorSurface.pressSequentially('after', { delay: 30 });
  // Save is handled by Editor.tsx's own window-level keydown listener (checks
  // `e.metaKey || e.ctrlKey`), not a Monaco keybinding, so plain Control+s
  // works here regardless of platform.
  await editorSurface.press('Control+s');

  await expect.poll(() => readFileSync(path.join(fixtureDir, 'sample.txt'), 'utf-8')).toBe('after');

  await expect(page.locator('.xterm-screen')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open terminal', exact: true }).click();
  const terminal = page.locator('.xterm-screen').first();
  await terminal.click();
  await page.keyboard.type('echo hello-e2e');
  await page.keyboard.press('Enter');
  // The shell echoes the typed command line itself as well as the command's
  // output, so two elements contain "hello-e2e" (the echoed input line and
  // the printed output line). `.last()` targets the output line and avoids
  // Playwright's strict-mode violation on an ambiguous text match.
  await expect(page.getByText('hello-e2e').last()).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Hide terminal', exact: true }).click();
  await expect(terminal).toBeHidden();
  await page.getByRole('button', { name: 'Open terminal', exact: true }).click();
  await expect(page.getByText('hello-e2e').last()).toBeVisible();
});


test('nested navigation, unsaved tabs, and file operations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open current directory' }).click();
  await page.getByRole('button', { name: 'sample.txt', exact: true }).click();
  const editor = page.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press('ControlOrMeta+A');
  await editor.pressSequentially('unsaved tab content', { delay: 30 });
  await page.getByRole('button', { name: '▸ src', exact: true }).click();
  await page.getByRole('button', { name: 'nested.ts', exact: true }).click();
  await expect(editor).toContainText('42');
  await page.getByRole('tab', { name: 'sample.txt •', exact: true }).click();
  await expect(editor).toContainText('unsaved tab content');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'sample.txt', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept('src/new.ts'));
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await page.getByRole('button', { name: 'new.ts', exact: true }).click();
  page.once('dialog', dialog => dialog.accept('src/renamed.ts'));
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('button', { name: 'renamed.ts', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'renamed.ts', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open terminal', exact: true }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shell 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'sample.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Close sample.txt', exact: true }).click();
  await page.getByRole('button', { name: 'sample.txt', exact: true }).click();
  await expect(editor).toContainText('unsaved tab content');
  await page.locator('.terminal-container:not([hidden]) .xterm-screen').click();
  await page.keyboard.type('pwd');
  await page.keyboard.press('Enter');
  await expect(page.locator('.terminal-container:not([hidden])')).toContainText(fixtureDir);

});

test('creates and reopens a local starter project with preview controls', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Project folder path').fill(path.join(fixtureDir, 'starter'));
  await page.getByRole('button', { name: 'Create starter project', exact: true }).click();
  await page.getByRole('button', { name: 'index.html', exact: true }).click();
  await expect(page.locator('.monaco-editor')).toContainText('Hello from Yotram');
  await page.getByRole('button', { name: 'Open terminal', exact: true }).click();
  await page.locator('.xterm-screen').click();
  await page.keyboard.type('PORT=43179 node server.cjs');
  await page.keyboard.press('Enter');
  await expect(page.locator('.terminal-container')).toContainText('App running at http://127.0.0.1:43179');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByLabel('Port', { exact: true }).fill('43179');
  await page.getByRole('button', { name: 'Load preview' }).click();
  await expect(page.frameLocator('iframe[title="Local app preview"]').getByRole('heading')).toHaveText('Hello from Yotram');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recent projects' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^starter/ }).click();
  await page.getByRole('button', { name: 'index.html', exact: true }).click();
  await expect(page.locator('.monaco-editor')).toContainText('Hello from Yotram');
});

test('dashboard buttons open a folder chooser without a typed path', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  let chooser = page.getByRole('dialog');
  await expect(chooser).toBeVisible();
  await expect(chooser.getByLabel('Folder location')).toHaveValue(fixtureDir);
  await chooser.getByRole('button', { name: '▸ src', exact: true }).click();
  await chooser.getByRole('button', { name: 'Open selected folder' }).click();
  await expect(page.getByRole('button', { name: 'nested.ts', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Create starter project', exact: true }).click();
  chooser = page.getByRole('dialog');
  await expect(chooser.getByLabel('Folder location')).toHaveValue(fixtureDir);
  await chooser.getByLabel('Project name').fill('picker-app');
  await chooser.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'index.html', exact: true }).click();
  await expect(page.locator('.monaco-editor')).toContainText('Hello from Yotram');
});
