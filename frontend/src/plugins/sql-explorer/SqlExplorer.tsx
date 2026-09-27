import { useEffect, useMemo, useState } from 'react';
import type { PluginEditorProps } from '../types';

type SqlValue = string | number | null;
interface QueryResult { columns: string[]; rows: Record<string, SqlValue>[]; truncated: boolean }
interface TableInfo { name: string; type: string }
const PAGE_SIZE = 100;
const INITIAL_QUERY = "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name;";

async function request<T>(workspaceId: string, endpoint: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sqlite/${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'SQLite request failed');
  return result as T;
}
function quotedIdentifier(name: string): string { return `"${name.replaceAll('"', '""')}"`; }
function formatValue(value: SqlValue): string { return value === null ? 'NULL' : String(value); }

export function SqlExplorer({ workspaceId, path }: PluginEditorProps) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [sql, setSql] = useState(INITIAL_QUERY);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ column: string; direction: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [chartVisible, setChartVisible] = useState(false);
  const [chartX, setChartX] = useState('');
  const [chartY, setChartY] = useState('');
  const query = async (statement: string) => {
    setBusy(true); setError(''); setPage(0); setSort(null);
    try {
      const data = await request<QueryResult>(workspaceId, 'query', { path, sql: statement });
      setResult(data);
      const numeric = data.columns.find(column => data.rows.some(row => typeof row[column] === 'number')) ?? '';
      setChartX(data.columns.find(column => data.rows.some(row => typeof row[column] !== 'number')) ?? data.columns[0] ?? '');
      setChartY(numeric);
    } catch (reason) { setError((reason as Error).message); setResult(null); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError('');
    void request<{ tables: TableInfo[] }>(workspaceId, `schema?path=${encodeURIComponent(path)}`).then(data => {
      if (cancelled) return;
      setTables(data.tables);
      setSql(INITIAL_QUERY);
      void query(INITIAL_QUERY);
    }).catch(reason => { if (!cancelled) { setError((reason as Error).message); setBusy(false); } });
    return () => { cancelled = true; };
  }, [workspaceId, path]);
  const numericColumns = useMemo(() => result?.columns.filter(column => result.rows.some(row => typeof row[column] === 'number')) ?? [], [result]);
  const filtered = useMemo(() => {
    if (!result) return [];
    const term = filter.trim().toLocaleLowerCase();
    let rows = term ? result.rows.filter(row => result.columns.some(column => formatValue(row[column]).toLocaleLowerCase().includes(term))) : result.rows;
    if (sort) rows = [...rows].sort((a, b) => {
      const left = a[sort.column], right = b[sort.column];
      const order = left === right ? 0 : left === null ? 1 : right === null ? -1 : typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
      return order * sort.direction;
    });
    return rows;
  }, [filter, result, sort]);
  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const visibleRows = filtered.slice(Math.min(page, maxPage) * PAGE_SIZE, (Math.min(page, maxPage) + 1) * PAGE_SIZE);
  const chart = useMemo(() => {
    if (!result || !chartX || !chartY) return [];
    const groups = new Map<string, { sum: number; count: number }>();
    for (const row of filtered) {
      const value = row[chartY]; if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const label = formatValue(row[chartX]); const group = groups.get(label) ?? { sum: 0, count: 0 };
      group.sum += value; group.count++; groups.set(label, group);
    }
    return [...groups.entries()].slice(0, 30).map(([label, group]) => ({ label, value: group.sum / group.count }));
  }, [chartX, chartY, filtered, result]);
  function browse(table: string) {
    const statement = `SELECT * FROM ${quotedIdentifier(table)} LIMIT 500;`;
    setSql(statement); void query(statement);
  }
  function run() { void query(sql); }
  return <section className="sql-explorer" aria-label={`SQL Explorer ${path}`}>
    <div className="sql-layout">
      <aside className="sql-tables" aria-label="Database tables">
        <strong>Tables · {tables.length}</strong>
        {tables.map(table => <button key={`${table.type}:${table.name}`} onClick={() => browse(table.name)} title={`Browse ${table.type} ${table.name}`}><span>{table.name}</span><small>{table.type}</small></button>)}
        {!tables.length && !busy && <p>No tables or views found.</p>}
      </aside>
      <div className="sql-workspace">
        <div className="sql-query-toolbar"><span>{path}</span><span className="sql-result-count" role="status">{busy ? 'Running query…' : result ? `${result.rows.length}${result.truncated ? '+' : ''} rows · ${result.columns.length} columns` : 'Read-only SQL'}</span>
          <button disabled={busy || !sql.trim()} onClick={run}>Run query</button>
        </div>
        <label className="sql-query-label">SQL query<textarea aria-label="SQL query" spellCheck={false} value={sql} onChange={event => setSql(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') run(); }} /></label>
        <div className="sql-result-toolbar"><label>Filter results<input type="search" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }} placeholder="Search result rows…" /></label>
          <button disabled={!numericColumns.length} aria-pressed={chartVisible} onClick={() => setChartVisible(value => !value)}>{chartVisible ? 'Hide chart' : 'Quick chart'}</button></div>
        {error && <div className="data-message data-error" role="alert">{error}</div>}
        {result?.truncated && <div className="data-message">Results are capped at 500 rows or 2 MB. Add a LIMIT clause or narrow the selected columns to see more detail.</div>}
        {chartVisible && numericColumns.length > 0 && <section className="data-chart" aria-label="SQL quick chart">
          <div className="data-chart-toolbar"><label>X axis<select aria-label="Chart X axis" value={chartX} onChange={event => setChartX(event.target.value)}>{result?.columns.map(column => <option key={column}>{column}</option>)}</select></label>
            <label>Y axis<select aria-label="Chart Y axis" value={chartY} onChange={event => setChartY(event.target.value)}>{numericColumns.map(column => <option key={column}>{column}</option>)}</select></label><span>Average by category · first 30 groups</span></div>
          <SqlChart values={chart} x={chartX} y={chartY} />
        </section>}
        <div className="sql-results-wrap"><table className="data-table"><thead><tr>{result?.columns.map(column => <th key={column}><button onClick={() => setSort(current => current?.column === column ? { column, direction: current.direction === 1 ? -1 : 1 } : { column, direction: 1 })} aria-label={`Sort by ${column}`}>{column}{sort?.column === column ? sort.direction === 1 ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead>
          <tbody>{visibleRows.map((row, index) => <tr key={`${page}:${index}`}>{result?.columns.map(column => <td key={column} title={formatValue(row[column])}>{formatValue(row[column])}</td>)}</tr>)}
            {result && !visibleRows.length && <tr><td className="data-empty" colSpan={Math.max(result.columns.length, 1)}>{filtered.length ? 'No results.' : 'The query returned no rows.'}</td></tr>}</tbody></table></div>
        {result && filtered.length > PAGE_SIZE && <div className="data-pagination"><span>Page {Math.min(page, maxPage) + 1} of {maxPage + 1}</span><button disabled={page <= 0} onClick={() => setPage(value => Math.max(0, value - 1))}>Previous</button><button disabled={page >= maxPage} onClick={() => setPage(value => Math.min(maxPage, value + 1))}>Next</button></div>}
        <p className="data-footnote">Read only · SQLite · queries run against a temporary in-memory copy; original database files are never written.</p>
      </div>
    </div>
  </section>;
}

function SqlChart({ values, x, y }: { values: { label: string; value: number }[]; x: string; y: string }) {
  if (!values.length) return <p className="data-empty">No numeric values to chart for these results.</p>;
  const width = 720, height = 200, left = 52, right = 12, top = 14, bottom = 44;
  const max = Math.max(0, ...values.map(point => point.value)), min = Math.min(0, ...values.map(point => point.value));
  const range = Math.max(max - min, 1), innerWidth = width - left - right, innerHeight = height - top - bottom;
  const xPos = (index: number) => left + innerWidth * (index + .5) / values.length;
  const yPos = (value: number) => top + innerHeight - (value - min) / range * innerHeight;
  const base = yPos(0);
  return <svg className="data-chart-svg" role="img" aria-label={`Average ${y} by ${x}`} viewBox={`0 0 ${width} ${height}`}>
    <line x1={left} x2={width - right} y1={base} y2={base} className="chart-axis" />
    {values.map((point, index) => { const barWidth = innerWidth / values.length * .68; return <g key={`${point.label}:${index}`}><rect className="chart-bar" x={xPos(index) - barWidth / 2} y={Math.min(base, yPos(point.value))} width={barWidth} height={Math.max(1, Math.abs(base - yPos(point.value)))} rx="2"><title>{point.label}: {point.value}</title></rect><text className="chart-label" x={xPos(index)} y={height - 12} textAnchor="middle">{point.label.length > 12 ? `${point.label.slice(0, 11)}…` : point.label}</text></g>; })}
    <text className="chart-label" x={left - 5} y={top + 4} textAnchor="end">{max.toLocaleString()}</text>
  </svg>;
}
