import Papa from 'papaparse';

export const MAX_DATA_ROWS = 100_000;
export const MAX_TEXT_BYTES = 10 * 1024 * 1024;
export interface DataRow { [column: string]: unknown }
export interface ParsedData { columns: string[]; rows: DataRow[]; totalRows: number; truncated: boolean; warning?: string }
function records(columns: string[], rows: DataRow[], totalRows = rows.length, warning?: string): ParsedData {
  return { columns, rows: rows.slice(0, MAX_DATA_ROWS), totalRows, truncated: totalRows > MAX_DATA_ROWS, warning };
}
function fromRecords(rows: unknown[]): ParsedData {
  const values = rows.length && rows.every(row => row && typeof row === 'object' && !Array.isArray(row))
    ? rows as DataRow[]
    : rows.map(value => ({ value }));
  const columns: string[] = [];
  for (const row of values.slice(0, MAX_DATA_ROWS)) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  return records(columns, values.slice(0, MAX_DATA_ROWS), values.length);
}
export function parseTextData(content: string, extension: string): ParsedData {
  if (new TextEncoder().encode(content).byteLength > MAX_TEXT_BYTES) throw new Error('Text data previews are limited to 10 MB.');
  if (extension === '.json') {
    const value: unknown = JSON.parse(content);
    if (Array.isArray(value)) return fromRecords(value);
    if (value && typeof value === 'object') {
      const candidates = Object.values(value).filter(Array.isArray) as unknown[][];
      const recordsArray = candidates.find(array => array.every(row => row && typeof row === 'object' && !Array.isArray(row)));
      return recordsArray ? fromRecords(recordsArray) : fromRecords([value]);
    }
    return fromRecords([value]);
  }
  if (extension === '.jsonl' || extension === '.ndjson') {
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    const rows = lines.slice(0, MAX_DATA_ROWS).map((line, index) => {
      try { return JSON.parse(line); }
      catch { throw new Error(`Invalid JSON on line ${index + 1}.`); }
    });
    return fromRecords(rows).totalRows === lines.length
      ? fromRecords(rows)
      : { ...fromRecords(rows), totalRows: lines.length, truncated: true };
  }
  const delimiter = extension === '.tsv' ? '\t' : undefined;
  const parsed = Papa.parse<DataRow>(content, { header: true, delimiter, dynamicTyping: true, skipEmptyLines: 'greedy', preview: MAX_DATA_ROWS + 1, transformHeader: (header, index) => header.trim() || `Column ${index + 1}` });
  if (!parsed.meta.fields?.length) throw new Error('This file has no header row. CSV and TSV previews need column names in the first row.');
  const warning = parsed.errors.length ? `${parsed.errors.length} malformed row${parsed.errors.length === 1 ? '' : 's'} skipped or padded while parsing.` : undefined;
  const rows = parsed.data.slice(0, MAX_DATA_ROWS);
  return records(parsed.meta.fields, rows, Math.max(rows.length, parsed.data.length, parsed.meta.cursor < content.length ? MAX_DATA_ROWS + 1 : rows.length), warning);
}
export function displayValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  try { return JSON.stringify(value); } catch { return String(value); }
}
export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : 1;
  return displayValue(a).localeCompare(displayValue(b), undefined, { numeric: true, sensitivity: 'base' });
}
export function chartColumns(rows: DataRow[], columns: string[]): { x: string; y: string[] } {
  const numeric = columns.filter(column => rows.some(row => typeof row[column] === 'number' && Number.isFinite(row[column] as number)));
  return { x: columns[0] ?? '', y: numeric };
}
export function chartData(rows: DataRow[], x: string, y: string): { label: string; value: number }[] {
  const values = new Map<string, { sum: number; count: number; order: number }>();
  rows.forEach((row, order) => {
    const value = row[y]; if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const label = displayValue(row[x]);
    const current = values.get(label) ?? { sum: 0, count: 0, order };
    current.sum += value; current.count++; values.set(label, current);
  });
  return [...values.entries()].map(([label, value]) => ({ label, value: value.sum / value.count, order: value.order }))
    .sort((a, b) => a.order - b.order).slice(0, 30).map(({ label, value }) => ({ label, value }));
}
