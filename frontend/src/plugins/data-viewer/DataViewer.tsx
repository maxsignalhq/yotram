import { useEffect, useMemo, useState } from 'react';
import { compressors } from 'hyparquet-compressors';
import { parquetMetadataAsync, parquetReadObjects, parquetSchema } from 'hyparquet';
import type { PluginEditorProps } from '../types';
import { chartColumns, chartData, compareValues, displayValue, MAX_TEXT_BYTES, parseTextData, type DataRow, type ParsedData } from './data';

const PAGE_SIZE = 100;
const parquetLimit = 64 * 1024 * 1024;
function extensionOf(path: string) { return path.slice(path.lastIndexOf('.')).toLowerCase(); }
export function DataViewer({ workspaceId, path, content }: PluginEditorProps) {
  const extension = extensionOf(path);
  const [parquet, setParquet] = useState<ParsedData | null>(null);
  const [parquetError, setParquetError] = useState('');
  const [parquetBusy, setParquetBusy] = useState(extension === '.parquet');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ column: string; direction: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [showChart, setShowChart] = useState(false);
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');
  const [xColumn, setXColumn] = useState('');
  const [yColumn, setYColumn] = useState('');
  useEffect(() => {
    if (extension !== '.parquet') return;
    let cancelled = false;
    const filePath = new URLSearchParams({ path }).toString();
    void fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/data/binary?${filePath}`).then(async response => {
      if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error ?? 'Unable to read this Parquet file.'); }
      if (Number(response.headers.get('Content-Length')) > parquetLimit) throw new Error('Parquet previews are limited to 64 MB.');
      return response.arrayBuffer();
    }).then(async buffer => {
      const metadata = await parquetMetadataAsync(buffer);
      const totalRows = Number(metadata.num_rows);
      const rows = await parquetReadObjects({ file: buffer, rowStart: 0, rowEnd: Math.min(totalRows, 100_000), compressors }) as DataRow[];
      const columns = parquetSchema(metadata).children.map(column => column.element.name);
      if (!cancelled) setParquet({ columns, rows, totalRows, truncated: totalRows > rows.length });
    }).catch(error => { if (!cancelled) setParquetError((error as Error).message); })
      .finally(() => { if (!cancelled) setParquetBusy(false); });
    return () => { cancelled = true; };
  }, [extension, path, workspaceId]);
  const parsed = useMemo(() => {
    if (extension === '.parquet') return parquet;
    try { return parseTextData(content, extension); }
    catch (error) { return { error: (error as Error).message }; }
  }, [content, extension, parquet]);
  const rows = parsed && 'rows' in parsed ? parsed.rows : EMPTY_ROWS;
  const columns = parsed && 'columns' in parsed ? parsed.columns : EMPTY_COLUMNS;
  const numericColumns = useMemo(() => chartColumns(rows, columns).y, [rows, columns]);
  const effectiveX = columns.includes(xColumn) ? xColumn : columns[0] ?? '';
  const effectiveY = numericColumns.includes(yColumn) ? yColumn : numericColumns[0] ?? '';
  const filtered = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    let result = query ? rows.filter(row => columns.some(column => displayValue(row[column]).toLocaleLowerCase().includes(query))) : rows;
    if (sort) result = [...result].sort((a, b) => compareValues(a[sort.column], b[sort.column]) * sort.direction);
    return result;
  }, [columns, filter, rows, sort]);
  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const visible = filtered.slice(Math.min(page, maxPage) * PAGE_SIZE, (Math.min(page, maxPage) + 1) * PAGE_SIZE);
  const chart = useMemo(() => chartData(filtered, effectiveX, effectiveY), [filtered, effectiveX, effectiveY]);
  const parseError = parsed && 'error' in parsed ? parsed.error : '';
  const data = parsed && 'rows' in parsed ? parsed : null;
  const toggleSort = (column: string) => { setSort(current => current?.column === column ? { column, direction: current.direction === 1 ? -1 : 1 } : { column, direction: 1 }); setPage(0); };
  return <section className="data-viewer" aria-label={`Data viewer ${path}`}>
    <div className="data-toolbar">
      <label className="data-filter">Filter rows<input type="search" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }} placeholder="Search every column…" /></label>
      <span className="data-count" role="status">{parquetBusy ? 'Reading Parquet…' : `${filtered.length.toLocaleString()} shown · ${(data?.totalRows ?? 0).toLocaleString()} rows`}</span>
      <button disabled={!numericColumns.length || !effectiveX} aria-pressed={showChart} onClick={() => setShowChart(value => !value)}>{showChart ? 'Hide chart' : 'Quick chart'}</button>
    </div>
    {parquetBusy && <div className="data-message" role="status">Reading Parquet data locally…</div>}
    {(parquetError || parseError) && <div className="data-message data-error" role="alert">{parquetError || parseError}</div>}
    {data?.warning && <div className="data-message">{data.warning}</div>}
    {!!data?.truncated && <div className="data-message">Showing the first {data.rows.length.toLocaleString()} rows. The file contains {data.totalRows.toLocaleString()} rows.</div>}
    {content.length > MAX_TEXT_BYTES && extension !== '.parquet' && <div className="data-message data-error">Text data previews are limited to 10 MB.</div>}
    {showChart && !!numericColumns.length && <Chart type={chartType} onTypeChange={setChartType} x={effectiveX} y={effectiveY} xColumns={columns} yColumns={numericColumns} onXChange={setXColumn} onYChange={setYColumn} values={chart} />}
    {data && !parseError && <div className="data-table-wrap"><table className="data-table"><thead><tr>{columns.map(column => <th key={column} scope="col"><button onClick={() => toggleSort(column)} aria-label={`Sort by ${column}`}>{column}{sort?.column === column ? sort.direction === 1 ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead>
      <tbody>{visible.map((row, index) => <tr key={Math.min(page, maxPage) * PAGE_SIZE + index}>{columns.map(column => <td key={column} title={displayValue(row[column])}>{displayValue(row[column])}</td>)}</tr>)}
        {!visible.length && <tr><td colSpan={Math.max(columns.length, 1)} className="data-empty">{rows.length ? 'No rows match this filter.' : columns.length ? 'This file has no data rows.' : 'No columns found.'}</td></tr>}
      </tbody></table></div>}
    {data && !!filtered.length && <div className="data-pagination"><span>Page {Math.min(page, maxPage) + 1} of {maxPage + 1}</span><button disabled={page <= 0} onClick={() => setPage(value => Math.max(0, value - 1))}>Previous</button><button disabled={page >= maxPage} onClick={() => setPage(value => Math.min(maxPage, value + 1))}>Next</button></div>}
    <p className="data-footnote">Read only · {extension.replace('.', '').toUpperCase()} · {columns.length} columns{extension === '.parquet' ? ' · parsed locally in your browser' : ''}</p>
  </section>;
}

const EMPTY_ROWS: DataRow[] = [];
const EMPTY_COLUMNS: string[] = [];

function Chart({ type, onTypeChange, x, y, xColumns, yColumns, onXChange, onYChange, values }: {
  type: 'bar' | 'line'; onTypeChange: (value: 'bar' | 'line') => void; x: string; y: string;
  xColumns: string[]; yColumns: string[]; onXChange: (value: string) => void; onYChange: (value: string) => void;
  values: { label: string; value: number }[];
}) {
  const width = 760, height = 240, pad = { top: 18, right: 18, bottom: 58, left: 58 };
  const max = Math.max(1, ...values.map(item => item.value)); const min = Math.min(0, ...values.map(item => item.value)); const range = Math.max(1, max - min);
  const innerWidth = width - pad.left - pad.right, innerHeight = height - pad.top - pad.bottom;
  const xPos = (index: number) => pad.left + innerWidth * (index + .5) / Math.max(values.length, 1);
  const yPos = (value: number) => pad.top + innerHeight - ((value - min) / range) * innerHeight;
  const baseline = yPos(0), points = values.map((item, index) => `${xPos(index)},${yPos(item.value)}`).join(' ');
  return <section className="data-chart" aria-label="Quick chart">
    <div className="data-chart-toolbar"><label>Chart<select value={type} onChange={event => onTypeChange(event.target.value as 'bar' | 'line')}><option value="bar">Bar</option><option value="line">Line</option></select></label>
      <label>X axis<select aria-label="X axis" value={x} onChange={event => onXChange(event.target.value)}>{xColumns.map(column => <option key={column}>{column}</option>)}</select></label>
      <label>Y axis<select aria-label="Y axis" value={y} onChange={event => onYChange(event.target.value)}>{yColumns.map(column => <option key={column}>{column}</option>)}</select></label>
      <span>Average {y} by {x} · first 30 groups</span>
    </div>
    {!values.length ? <p className="data-empty">No numeric values match this filter.</p> : <svg role="img" aria-label={`${type === 'bar' ? 'Bar' : 'Line'} chart of average ${y} by ${x}`} viewBox={`0 0 ${width} ${height}`} className="data-chart-svg">
      <line x1={pad.left} x2={width - pad.right} y1={baseline} y2={baseline} className="chart-axis" />
      <line x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} className="chart-axis" />
      {type === 'bar' ? values.map((item, index) => { const barWidth = innerWidth / values.length * .68; return <g key={`${item.label}-${index}`}><rect x={xPos(index) - barWidth / 2} y={Math.min(yPos(item.value), baseline)} width={barWidth} height={Math.max(1, Math.abs(yPos(item.value) - baseline))} rx="2" className="chart-bar"><title>{item.label}: {item.value}</title></rect><text x={xPos(index)} y={height - pad.bottom + 18} textAnchor="middle" className="chart-label">{item.label.length > 12 ? item.label.slice(0, 11) + '…' : item.label}</text></g>; }) : <><polyline points={points} fill="none" className="chart-line" />{values.map((item, index) => <circle key={`${item.label}-${index}`} cx={xPos(index)} cy={yPos(item.value)} r="3.5" className="chart-point"><title>{item.label}: {item.value}</title></circle>)}{values.map((item, index) => <text key={item.label + index} x={xPos(index)} y={height - pad.bottom + 18} textAnchor="middle" className="chart-label">{item.label.length > 12 ? item.label.slice(0, 11) + '…' : item.label}</text>)}</>}
      <text x={pad.left - 8} y={pad.top + 4} textAnchor="end" className="chart-label">{max.toLocaleString()}</text><text x={pad.left - 8} y={height - pad.bottom} textAnchor="end" className="chart-label">{min.toLocaleString()}</text>
    </svg>}
  </section>;
}
