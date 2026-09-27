export type Multiline = string | string[];
export type Output = { output_type: string; text?: Multiline; name?: string; data?: Record<string, unknown>; metadata?: Record<string, unknown>; execution_count?: number | null; ename?: string; evalue?: string; traceback?: string[]; [key: string]: unknown };
export interface Cell { id: string; cell_type: 'code' | 'markdown' | 'raw'; source: Multiline; metadata: Record<string, unknown>; outputs?: Output[]; execution_count?: number | null; [key: string]: unknown }
export interface Notebook { cells: Cell[]; metadata: Record<string, unknown>; nbformat: number; nbformat_minor: number; [key: string]: unknown }
export function text(value: unknown): string { return typeof value === 'string' ? value : Array.isArray(value) ? value.filter(v => typeof v === 'string').join('') : ''; }
export function cellId(): string { return Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join(''); }
export function newCell(kind: Cell['cell_type'] = 'code'): Cell {
  return { id: cellId(), cell_type: kind, source: '', metadata: {}, ...(kind === 'code' ? { outputs: [], execution_count: null } : {}) };
}
export function parseNotebook(content: string): Notebook {
  const notebook = JSON.parse(content);
  if (!notebook || notebook.nbformat !== 4 || !Array.isArray(notebook.cells) || !notebook.metadata || typeof notebook.metadata !== 'object' || !Number.isInteger(notebook.nbformat_minor)) throw new Error('Only Jupyter notebook format 4 is supported. Open as text to inspect this file.');
  const ids = new Set<string>();
  for (const cell of notebook.cells) {
    if (!cell || !['code', 'markdown', 'raw'].includes(cell.cell_type) || !(typeof cell.source === 'string' || (Array.isArray(cell.source) && cell.source.every((s: unknown) => typeof s === 'string'))) || !cell.metadata || typeof cell.metadata !== 'object' || (cell.cell_type === 'code' && (!Array.isArray(cell.outputs) || cell.outputs.some((o: unknown) => !o || typeof o !== 'object')))) throw new Error('This notebook contains an invalid cell. Open as text to repair it.');
    if (typeof cell.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(cell.id) || ids.has(cell.id)) cell.id = cellId();
    ids.add(cell.id);
  }
  return notebook;
}
export function serializeNotebook(notebook: Notebook): string { return JSON.stringify(notebook, null, 2) + '\n'; }

export interface ExecutionEvent { event?: string; content?: Record<string, any>; done?: boolean; error?: string }
export class OutputReducer {
  outputs: Output[] = [];
  count: number | null = null;
  failed = false;
  private clearNext = false;
  private displays = new Map<string, number[]>();
  apply(message: ExecutionEvent): void {
    const c = message.content ?? {};
    if (message.event === 'execute_input') { this.count = c.execution_count; return; }
    if (message.event === 'clear_output') { if (c.wait) this.clearNext = true; else this.clear(); return; }
    if (!['stream', 'error', 'display_data', 'execute_result', 'update_display_data'].includes(message.event ?? '')) return;
    if (this.clearNext) this.clear();
    if (message.event === 'update_display_data') {
      for (const index of this.displays.get(c.transient?.display_id) ?? []) this.outputs[index] = { ...this.outputs[index], data: c.data, metadata: c.metadata ?? {} };
      return;
    }
    if (message.event === 'stream') {
      const previous = this.outputs.at(-1);
      if (previous?.output_type === 'stream' && previous.name === c.name) previous.text = text(previous.text) + text(c.text);
      else this.outputs.push({ output_type: 'stream', name: c.name, text: c.text });
    } else if (message.event === 'error') {
      this.failed = true; this.outputs.push({ output_type: 'error', ename: c.ename, evalue: c.evalue, traceback: c.traceback });
    } else {
      const id = c.transient?.display_id;
      if (id) this.displays.set(id, [...(this.displays.get(id) ?? []), this.outputs.length]);
      this.outputs.push({ output_type: message.event!, data: c.data, metadata: c.metadata ?? {}, ...(message.event === 'execute_result' ? { execution_count: c.execution_count } : {}) });
    }
  }
  private clear() { this.outputs = []; this.displays.clear(); this.clearNext = false; }
}
