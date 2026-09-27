import type { Express } from 'express';
import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PluginHost } from './plugins.js';
import type { Workspaces, Workspace } from './workspaces.js';
import { WorkspaceFs } from './fs.js';

const MAX_DATABASE_BYTES = 128 * 1024 * 1024;
const MAX_QUERY_LENGTH = 64 * 1024;
const MAX_ROWS = 500;
const MAX_COLUMNS = 100;
const MAX_CELL_CHARS = 4096;
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
let sqlitePromise: Promise<SqlJsStatic> | undefined;
const require = createRequire(import.meta.url);
const sqlJsEntry = pathToFileURL(require.resolve('sql.js'));

export const sqlExplorerManifest = {
  id: 'yotram.sql-explorer', name: 'SQL Explorer', version: '0.1.0', apiVersion: 1 as const,
  description: 'Browse local SQLite tables and run read-only SQL queries.',
  setupHelp: 'Supports .db, .sqlite, and .sqlite3 files. Databases up to 128 MB; query results up to 500 rows.',
  permissions: ['workspace.files.read'], editors: [], commands: [], settings: {},
};

function initSqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: file => fileURLToPath(new URL(file, sqlJsEntry)) });
  return sqlitePromise;
}

function validateDbPath(value: unknown): string {
  if (typeof value !== 'string' || !/\.(?:db|sqlite|sqlite3)$/i.test(value)) throw new Error('Choose a .db, .sqlite, or .sqlite3 file');
  return value;
}

async function openDatabase(workspace: Workspace, relPath: string): Promise<{ SQL: SqlJsStatic; db: Database }> {
  const bytes = await new WorkspaceFs(workspace.path).readBinary(relPath, MAX_DATABASE_BYTES);
  const SQL = await initSqlite();
  const db = new SQL.Database(bytes);
  try {
    db.run('PRAGMA query_only = ON');
    return { SQL, db };
  } catch (error) { db.close(); throw error; }
}

function safeValue(value: SqlValue): string | number | null {
  if (value instanceof Uint8Array) {
    const hex = [...value.subarray(0, 128)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `0x${hex}${value.length > 128 ? '…' : ''}`;
  }
  if (typeof value === 'string') return value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}…` : value;
  return value;
}

function assertSingleReadQuery(db: Database, sql: unknown): string {
  if (typeof sql !== 'string' || !sql.trim() || sql.length > MAX_QUERY_LENGTH) throw new Error('Enter a SQL statement under 64 KB');
  if (!/^\s*(?:SELECT|WITH|EXPLAIN)\b/i.test(sql)) throw new Error('Only SELECT, WITH, and EXPLAIN queries are allowed');
  const statements = db.iterateStatements(sql);
  const first = statements.next();
  if (first.done) throw new Error('Enter one SQL statement');
  const statement = first.value;
  try {
    const second = statements.next();
    if (!second.done) { second.value.free(); throw new Error('Run one SQL statement at a time'); }
  } finally { statement.free(); }
  return sql;
}

function executeQuery(db: Database, sql: string) {
  const statement = db.prepare(sql);
  try {
    const columns = statement.getColumnNames().slice(0, MAX_COLUMNS);
    const rows: Record<string, string | number | null>[] = [];
    let chars = 0;
    let truncated = false;
    while (statement.step()) {
      if (rows.length >= MAX_ROWS || chars >= MAX_RESPONSE_CHARS) { truncated = true; break; }
      const object = statement.getAsObject();
      const row: Record<string, string | number | null> = {};
      for (const column of columns) row[column] = safeValue(object[column] as SqlValue);
      chars += JSON.stringify(row).length;
      rows.push(row);
    }
    return { columns, rows, truncated };
  } finally { statement.free(); }
}

export function sqlExplorerRoutes(app: Express, workspaces: Workspaces, plugins: PluginHost): void {
  app.get('/api/workspaces/:id/sqlite/schema', async (req, res) => {
    try {
      const workspace = workspaces.get(req.params.id);
      if (!workspace) { res.status(404).json({ error: 'Unknown workspace' }); return; }
      plugins.require(workspace, sqlExplorerManifest.id);
      const { db } = await openDatabase(workspace, validateDbPath(req.query.path));
      try {
        const result = executeQuery(db, "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 500");
        res.json({ tables: result.rows });
      } finally { db.close(); }
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  app.post('/api/workspaces/:id/sqlite/query', async (req, res) => {
    try {
      const workspace = workspaces.get(req.params.id);
      if (!workspace) { res.status(404).json({ error: 'Unknown workspace' }); return; }
      plugins.require(workspace, sqlExplorerManifest.id);
      const { db } = await openDatabase(workspace, validateDbPath(req.body?.path));
      try {
        const sql = assertSingleReadQuery(db, req.body?.sql);
        res.json(executeQuery(db, sql));
      } finally { db.close(); }
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
}
