import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { NotebookEditor } from '../src/plugins/notebook/NotebookEditor';
import { newCell, OutputReducer, parseNotebook, serializeNotebook, type Notebook } from '../src/plugins/notebook/model';

vi.mock('@monaco-editor/react', () => ({ default: ({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { readOnly?: boolean } }) => <textarea aria-label="Cell source" value={value} readOnly={options.readOnly} onChange={event => onChange(event.target.value)} /> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const original: Notebook = { nbformat: 4, nbformat_minor: 5, metadata: { custom: { retained: true }, language_info: { name: 'python' } }, cells: [{ ...newCell(), source: ['value = 1\n', 'value'], metadata: { tags: ['example'] } }] };
function Harness({ notebook = original }: { notebook?: Notebook }) {
  const [content, setContent] = useState(serializeNotebook(notebook));
  return <><NotebookEditor workspaceId="local" path="test.ipynb" content={content} onChange={setContent} theme="dark" /><output data-testid="document">{content}</output></>;
}
function mockApi() { vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'stopped' }), { status: 200 }))); }

describe('notebook documents', () => {
  it('preserves metadata, attachments, unknown fields and multiline sources across edits', () => {
    const raw = { ...original, vendor: 42, cells: [...original.cells, { ...newCell('markdown'), attachments: { 'image.png': { 'image/png': 'abc' } }, source: '# Notes' }] };
    const parsed = parseNotebook(JSON.stringify(raw)); parsed.cells[0].source = 'value = 2';
    const saved = JSON.parse(serializeNotebook(parsed));
    expect(saved.vendor).toBe(42); expect(saved.metadata.custom).toEqual({ retained: true });
    expect(saved.cells[0].metadata.tags).toEqual(['example']); expect(saved.cells[1].attachments).toEqual(raw.cells[1].attachments);
  });
  it('rejects unsupported or malformed files and gives old notebooks unique cell IDs', () => {
    expect(() => parseNotebook('{')).toThrow();
    expect(() => parseNotebook(JSON.stringify({ ...original, nbformat: 3 }))).toThrow();
    expect(() => parseNotebook(JSON.stringify({ ...original, cells: [null] }))).toThrow();
    const parsed = parseNotebook(JSON.stringify({ ...original, cells: [{ ...original.cells[0], id: undefined }, { ...original.cells[0], id: undefined }] }));
    expect(parsed.cells[0].id).not.toEqual(parsed.cells[1].id);
  });
  it('handles streaming, deferred clear, display updates and Python errors in notebook format', () => {
    const reducer = new OutputReducer();
    reducer.apply({ event: 'execute_input', content: { execution_count: 2 } });
    reducer.apply({ event: 'stream', content: { name: 'stdout', text: 'one' } });
    reducer.apply({ event: 'stream', content: { name: 'stdout', text: ' two' } });
    expect(reducer.outputs[0].text).toBe('one two');
    reducer.apply({ event: 'clear_output', content: { wait: true } }); expect(reducer.outputs).toHaveLength(1);
    reducer.apply({ event: 'display_data', content: { data: { 'text/plain': 'old' }, transient: { display_id: 'display' } } });
    reducer.apply({ event: 'update_display_data', content: { data: { 'text/plain': 'new' }, transient: { display_id: 'display' } } });
    expect(reducer.outputs).toEqual([{ output_type: 'display_data', data: { 'text/plain': 'new' }, metadata: {} }]);
    reducer.apply({ event: 'error', content: { ename: 'ValueError', evalue: 'bad', traceback: ['bad'] } });
    expect(reducer.failed).toBe(true); expect(reducer.count).toBe(2);
  });
});
describe('notebook editor', () => {
  it('edits code and Markdown, reorders and deletes cells without losing metadata', async () => {
    mockApi(); render(<Harness />);
    fireEvent.change(screen.getByLabelText('Cell source'), { target: { value: 'value = 42' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Markdown' }));
    const markdown = screen.getByRole('article', { name: 'Cell 2' });
    fireEvent.change(within(markdown).getByLabelText('Cell source'), { target: { value: '# Notebook heading' } });
    fireEvent.click(within(markdown).getByText('Preview Markdown'));
    expect(screen.getByRole('heading', { name: 'Notebook heading' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Move cell 2 up'));
    expect(JSON.parse(screen.getByTestId('document').textContent!).cells[0].cell_type).toBe('markdown');
    fireEvent.click(screen.getByLabelText('Delete cell 1'));
    const saved = JSON.parse(screen.getByTestId('document').textContent!);
    expect(saved.cells).toHaveLength(1); expect(saved.cells[0].source).toBe('value = 42'); expect(saved.metadata.custom.retained).toBe(true);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
  it('streams outputs into the document and stops Run all after a cell error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/execute') ? new Response([
      { event: 'execute_input', content: { execution_count: 1 } },
      { event: 'stream', content: { name: 'stdout', text: 'streamed output' } },
      { event: 'error', content: { ename: 'ValueError', evalue: 'stop', traceback: ['ValueError: stop'] } }, { done: true },
    ].map(event => JSON.stringify(event) + '\n').join('')) : new Response(JSON.stringify({ status: 'ready' }))));
    render(<Harness notebook={{ ...original, cells: [...original.cells, { ...newCell(), source: 'print("should not run")' }] }} />);
    fireEvent.click(screen.getByText('Run all'));
    await waitFor(() => expect(screen.getByText('streamed output')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Python · ready')).toBeTruthy());
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/execute'))).toHaveLength(1);
    const saved = JSON.parse(screen.getByTestId('document').textContent!); expect(saved.cells[0].outputs).toHaveLength(2); expect(saved.cells[0].execution_count).toBe(1);
  });
  it('renders HTML outputs inside an untrusted sandbox and preserves unsupported output', async () => {
    mockApi(); render(<Harness notebook={{ ...original, cells: [{ ...original.cells[0], outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/html': '<script>parent.hacked=true</script><table><tr><td>42</td></tr></table>' } }, { output_type: 'display_data', metadata: {}, data: { 'application/custom': { value: 1 } } }] }] }} />);
    const frame = screen.getByTitle('Notebook HTML output'); expect(frame.getAttribute('sandbox')).toBe(''); expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
    expect(screen.getByText(/preserved but cannot be displayed/)).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
});
