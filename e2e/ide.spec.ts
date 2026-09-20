import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';

const fixtureDir = path.resolve(__dirname, 'fixture-workspace');

test.beforeAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(path.join(fixtureDir, 'sample.txt'), 'before');
});

test.afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
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

  const terminal = page.locator('.xterm-screen').first();
  await terminal.click();
  await page.keyboard.type('echo hello-e2e');
  await page.keyboard.press('Enter');
  // The shell echoes the typed command line itself as well as the command's
  // output, so two elements contain "hello-e2e" (the echoed input line and
  // the printed output line). `.last()` targets the output line and avoids
  // Playwright's strict-mode violation on an ambiguous text match.
  await expect(page.getByText('hello-e2e').last()).toBeVisible({ timeout: 5000 });
});
