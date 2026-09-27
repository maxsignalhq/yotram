import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEST_PASSWORD } from './testPassword';

test('workspace controls and dashboard fit narrow phone screens without overlapping', async ({ page, context }) => {
  const root = mkdtempSync(path.join(tmpdir(), 'yotram-mobile-'));
  let workspaceId = '';
  await context.request.post('/api/login', { data: { password: TEST_PASSWORD } });
  try {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Open current directory' })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

      await page.getByLabel('Project folder path').fill(root);
      await page.getByRole('button', { name: 'Open folder', exact: true }).click();
      await expect(page.locator('.workspace-header')).toBeVisible();
      const projects = await (await context.request.get('/api/workspaces')).json();
      workspaceId = projects.find((project: { path: string }) => project.path.endsWith(path.basename(root))).id;
      const controls = page.locator('.workspace-header-center > button');
      await expect(controls).toHaveCount(4);
      await expect.poll(() => page.locator('.app-shell').evaluate(shell => shell.scrollWidth <= shell.clientWidth)).toBe(true);
      const boxes = await controls.evaluateAll(buttons => buttons.map(button => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }));
      for (let i = 0; i < boxes.length; i++) {
        expect(boxes[i].left).toBeGreaterThanOrEqual(0);
        expect(boxes[i].right).toBeLessThanOrEqual(width);
        for (let j = i + 1; j < boxes.length; j++) {
          const overlaps = boxes[i].left < boxes[j].right && boxes[i].right > boxes[j].left && boxes[i].top < boxes[j].bottom && boxes[i].bottom > boxes[j].top;
          expect(overlaps).toBe(false);
        }
      }

      await page.getByRole('button', { name: 'Plugins', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Yotram plugins' });
      await expect(dialog).toBeVisible();
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox?.x).toBeGreaterThanOrEqual(0);
      expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(width);
      await page.getByRole('button', { name: 'Close plugins' }).click();
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Projects', exact: true }).click();
    }
  } finally {
    if (workspaceId) await context.request.delete(`/api/workspaces/${workspaceId}`).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
