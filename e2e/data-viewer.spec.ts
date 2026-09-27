import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { TEST_PASSWORD } from './testPassword';

test('Data Viewer opens, filters, sorts and preserves local CSV and Parquet files', async ({ page, context }) => {
  test.setTimeout(90000);
  const root = mkdtempSync(path.join(tmpdir(), 'yotram-data-viewer-'));
  let workspaceId = '';
  const csv = 'city,score\nOslo,3\nRome,5\nLima,4\n';
  const parquet = Buffer.from(parquetWriteBuffer({ columnData: [
    { name: 'city', data: ['Oslo', 'Rome'], type: 'STRING' },
    { name: 'score', data: [3, 5], type: 'INT32' },
 ] }));
  writeFileSync(path.join(root, 'sample.csv'), csv);
  writeFileSync(path.join(root, 'sample.json'), JSON.stringify([{ city: 'Berlin', score: 7 }]));
  writeFileSync(path.join(root, 'sample.parquet'), parquet);
  try {
    await context.request.post('/api/login', { data: { password: TEST_PASSWORD } });
    await page.goto('/');
    await page.getByLabel('Project folder path').fill(root);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    const projects = await (await context.request.get('/api/workspaces')).json();
    workspaceId = projects.find((project: { path: string }) => project.path.endsWith(path.basename(root))).id;
    await page.getByRole('button', { name: 'Plugins', exact: true }).click();
    const plugins = page.getByRole('dialog', { name: 'Yotram plugins' });
    await plugins.getByRole('button', { name: 'Enable Data Viewer' }).click();
    await plugins.getByRole('button', { name: 'Close plugins' }).click();
    await page.getByRole('button', { name: 'sample.csv', exact: true }).click();
    const viewer = page.getByRole('region', { name: 'Data viewer sample.csv' });
    await expect(viewer.getByRole('cell', { name: 'Oslo' })).toBeVisible();
    await viewer.getByRole('searchbox', { name: 'Filter rows' }).fill('rome');
    await expect(viewer.getByRole('row')).toHaveCount(2);
    await viewer.getByRole('searchbox', { name: 'Filter rows' }).fill('');
    await viewer.getByRole('button', { name: 'Sort by score' }).click();
    await expect(viewer.locator('tbody tr').first()).toContainText('Oslo');
    await viewer.getByRole('button', { name: 'Quick chart' }).click();
    await expect(viewer.getByRole('img', { name: /Bar chart of average score by city/ })).toBeVisible();
    await page.getByRole('button', { name: 'sample.json', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Data viewer sample.json' }).getByRole('cell', { name: 'Berlin' })).toBeVisible();
    await page.getByRole('button', { name: 'sample.parquet', exact: true }).click();
    const parquetViewer = page.getByRole('region', { name: 'Data viewer sample.parquet' });
    await expect(parquetViewer.getByRole('cell', { name: 'Rome' })).toBeVisible();
    expect(readFileSync(path.join(root, 'sample.csv'), 'utf8')).toBe(csv);
    expect(readFileSync(path.join(root, 'sample.json'), 'utf8')).toContain('Berlin');
    expect(readFileSync(path.join(root, 'sample.parquet'))).toEqual(parquet);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  } finally {
    if (workspaceId) {
      await context.request.put(`/api/workspaces/${workspaceId}/plugins/yotram.data-viewer`, { data: { enabled: false }, timeout: 3000 }).catch(() => {});
      await context.request.delete(`/api/workspaces/${workspaceId}`, { timeout: 3000 }).catch(() => {});
    }
    rmSync(root, { recursive: true, force: true });
  }
});
