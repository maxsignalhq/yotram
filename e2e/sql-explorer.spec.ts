import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { TEST_PASSWORD } from './testPassword';

test('SQL Explorer browses a local SQLite file, queries it read-only, and charts results', async ({ page, context }) => {
  test.setTimeout(60000);
  const root = mkdtempSync(path.join(tmpdir(), 'yotram-sql-explorer-'));
  let workspaceId = '';
  const SQL = await initSqlJs({ locateFile: file => path.resolve('node_modules/sql.js/dist', file) });
  const db = new SQL.Database();
  db.run("CREATE TABLE items (id INTEGER PRIMARY KEY, category TEXT, score REAL); INSERT INTO items VALUES (1, 'a', 2), (2, 'b', 4), (3, 'a', 6);");
  const original = Buffer.from(db.export()); db.close();
  writeFileSync(path.join(root, 'sample.sqlite'), original);
  try {
    await context.request.post('/api/login', { data: { password: TEST_PASSWORD } });
    await page.goto('/');
    await page.getByLabel('Project folder path').fill(root);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    const projects = await (await context.request.get('/api/workspaces')).json();
    workspaceId = projects.find((project: { path: string }) => project.path.endsWith(path.basename(root))).id;
    await page.getByRole('button', { name: 'Plugins', exact: true }).click();
    const plugins = page.getByRole('dialog', { name: 'Yotram plugins' });
    await plugins.getByRole('button', { name: 'Enable SQL Explorer' }).click();
    await plugins.getByRole('button', { name: 'Close plugins' }).click();
    await page.getByRole('button', { name: 'sample.sqlite', exact: true }).click();
    const explorer = page.getByRole('region', { name: 'SQL Explorer sample.sqlite' });
    await expect(explorer.getByRole('button', { name: /items/ })).toBeVisible();
    await explorer.getByRole('button', { name: /items/ }).click();
    await expect(explorer.getByRole('cell', { name: 'a', exact: true }).first()).toBeVisible();
    const editor = explorer.getByRole('textbox', { name: 'SQL query' });
    await editor.fill('SELECT category, AVG(score) AS average FROM items GROUP BY category ORDER BY category;');
    await explorer.getByRole('button', { name: 'Run query' }).click();
    await expect(explorer.getByRole('cell', { name: '4', exact: true })).toBeVisible();
    await explorer.getByRole('button', { name: 'Quick chart' }).click();
    await expect(explorer.getByRole('img', { name: 'Average average by category' })).toBeVisible();
    await editor.fill('DELETE FROM items;');
    await explorer.getByRole('button', { name: 'Run query' }).click();
    await expect(explorer.getByRole('alert')).toContainText('Only SELECT');
    expect(readFileSync(path.join(root, 'sample.sqlite'))).toEqual(original);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  } finally {
    if (workspaceId) {
      await context.request.put(`/api/workspaces/${workspaceId}/plugins/yotram.sql-explorer`, { data: { enabled: false }, timeout: 3000 }).catch(() => {});
      await context.request.delete(`/api/workspaces/${workspaceId}`, { timeout: 3000 }).catch(() => {});
    }
    rmSync(root, { recursive: true, force: true });
  }
});
