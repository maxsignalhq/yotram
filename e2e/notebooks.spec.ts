import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEST_PASSWORD } from './testPassword';

test('Notebook plugin edits, executes, saves, reopens and disables in the IDE', async ({ page, context }) => {
  test.skip(!process.env.YOTRAM_TEST_PYTHON, 'Set YOTRAM_TEST_PYTHON to an environment with jupyter_server, ipykernel and matplotlib.');
  test.setTimeout(90000);
  const root = mkdtempSync(path.join(tmpdir(), 'yotram-notebook-browser-'));
  let workspaceId = '';
  const notebook = {
    nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' }, custom: 'preserved' },
    cells: [
      { id: 'intro', cell_type: 'markdown', metadata: {}, source: '# Notebook walkthrough' },
      { id: 'calculation', cell_type: 'code', metadata: { tags: ['keep'] }, source: 'answer = 6 * 7\nprint("Notebook result:", answer)', outputs: [], execution_count: null },
      { id: 'plot', cell_type: 'code', metadata: {}, source: '%matplotlib inline\nimport matplotlib.pyplot as plt\nfrom IPython.display import display, HTML\ndisplay(HTML("<table><tr><td>Verified table</td></tr></table>"))\nplt.plot([1, 2, 3], [1, 4, 9])\nplt.show()', outputs: [], execution_count: null },
    ],
  };
  writeFileSync(path.join(root, 'analysis.ipynb'), JSON.stringify(notebook));
  writeFileSync(path.join(root, 'notes.txt'), 'Notebook workspace');
  try {
    await context.request.post('/api/login', { data: { password: TEST_PASSWORD } });
    await page.goto('/');
    await page.getByLabel('Project folder path').fill(root);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    const projects = await (await context.request.get('/api/workspaces')).json();
    workspaceId = projects.find((project: { path: string }) => project.path.endsWith(path.basename(root))).id;
    await page.getByRole('button', { name: 'Plugins', exact: true }).click();
    const plugins = page.getByRole('dialog', { name: 'Yotram plugins' });
    await plugins.getByLabel('Python executable').fill(process.env.YOTRAM_TEST_PYTHON!);
    await plugins.getByRole('button', { name: 'Enable Notebook' }).click();
    await expect(plugins.getByRole('button', { name: 'Disable Notebook' })).toBeEnabled();
    const installed = await (await context.request.get(`/api/workspaces/${workspaceId}/plugins`)).json();
    expect(installed[0].settings.python).toBe(process.env.YOTRAM_TEST_PYTHON);
    page.once('dialog', dialog => dialog.accept('created.ipynb'));
    await plugins.getByRole('button', { name: 'New notebook', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Notebook created.ipynb' })).toBeVisible();
    expect(JSON.parse(readFileSync(path.join(root, 'created.ipynb'), 'utf8')).cells).toHaveLength(1);
    await page.getByRole('button', { name: 'analysis.ipynb', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Notebook walkthrough' })).toBeVisible();
    const code = page.getByRole('article', { name: 'Cell 2', exact: true }).locator('.monaco-editor');
    await code.click(); await code.press('ControlOrMeta+A');
    await code.pressSequentially('answer = 7 * 7', { delay: 20 });
    await code.press('Enter');
    await code.pressSequentially('print("Notebook result:", answer)', { delay: 20 });
    await page.getByRole('region', { name: 'Notebook analysis.ipynb' }).getByRole('button', { name: 'Run all', exact: true }).click();
    await expect(page.getByText('Notebook result: 49', { exact: true })).toBeVisible({ timeout: 45000 });
    await expect(page.getByRole('img', { name: 'Notebook output' })).toBeVisible({ timeout: 30000 });
    await expect(page.frameLocator('iframe[title="Notebook HTML output"]').getByText('Verified table')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => JSON.parse(readFileSync(path.join(root, 'analysis.ipynb'), 'utf8')).cells[2].outputs.some((output: any) => output.data?.['image/png'])).toBe(true);
    const saved = JSON.parse(readFileSync(path.join(root, 'analysis.ipynb'), 'utf8'));
    expect(saved.metadata.custom).toBe('preserved'); expect(saved.cells[1].metadata.tags).toEqual(['keep']);
    await page.getByRole('button', { name: 'notes.txt', exact: true }).click();
    await page.getByRole('tab', { name: 'analysis.ipynb', exact: true }).click();
    await expect(page.getByText('Notebook result: 49', { exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/yotram-notebook-plugin.png', fullPage: true });
    await page.getByRole('button', { name: 'Close analysis.ipynb', exact: true }).click();
    await page.getByRole('button', { name: 'analysis.ipynb', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Notebook output' })).toBeVisible();
    await page.getByRole('region', { name: 'Notebook analysis.ipynb' }).getByRole('button', { name: 'Shut down', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Notebook analysis.ipynb' }).getByText('Python · stopped')).toBeVisible();
    await page.getByRole('button', { name: 'Plugins', exact: true }).click();
    await plugins.getByRole('button', { name: 'Disable Notebook' }).click();
    await expect(plugins.getByRole('button', { name: 'Enable Notebook' })).toBeEnabled();
    await plugins.getByRole('button', { name: 'Close plugins' }).click();
    await expect(page.getByRole('region', { name: 'Notebook analysis.ipynb' })).toHaveCount(0);
    await expect(page.locator('.document-editor:not([hidden]) .monaco-editor')).toContainText('nbformat');
  } finally {
    if (workspaceId) {
      await context.request.put(`/api/workspaces/${workspaceId}/plugins/yotram.notebook`, { data: { enabled: false } });
      await context.request.delete(`/api/workspaces/${workspaceId}`);
    }
    rmSync(root, { recursive: true, force: true });
  }
});
