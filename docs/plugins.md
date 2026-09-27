# Yotram bundled plugins

Yotram's initial plugin API is deliberately small and TypeScript-based. It supports
custom file editors, commands, per-workspace settings, enable/disable controls, and
managed backend services. Notebook is the first bundled plugin. There is no
third-party package loader or marketplace in this version.

## Notebook

1. Open **Plugins** in a workspace.
2. Set **Python executable** to the interpreter you want to use. Absolute paths,
   workspace-relative paths such as `.venv/bin/python`, and executables on the
   server's PATH are supported. A shell command with arguments is not supported.
3. Enable **Notebook**, then use **New notebook** or open an existing `.ipynb` file.
4. Run a cell with its Run button or Shift+Enter; Run all executes code cells in
   order and stops on the first error. Save or Cmd/Ctrl+S saves cells and outputs.

Yotram itself does not require Python. Opening and editing notebooks does not
launch Python. Executing Python cells requires Jupyter Server 2.x and ipykernel in
the selected environment. For example, in your project:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install 'jupyter-server>=2,<3' ipykernel matplotlib
```

Select `.venv/bin/python` in Plugins. Install any project-specific Python packages
in that same environment. Matplotlib is needed only for plotting. Use
`%matplotlib inline` when you want inline Matplotlib figures.

Supported in the first version:

- Code, Markdown and raw cells; add, delete, reorder and change cell types.
- Text, errors, PNG/JPEG plots, sandboxed HTML tables, Markdown and JSON output.
- Start, interrupt, restart and shut down Python kernels, with one kernel per
  notebook and a shared Jupyter server per workspace.
- Standard nbformat 4 files, including preserved notebook/cell metadata,
  attachments, and output types that the editor cannot render.
- Existing editor dirty indicators, tab switching, save acknowledgments and
  external-change handling. **Open as text** is available for unsupported files
  or manual repairs.

Kernels start only on Start kernel or Run. They use the notebook's containing
directory as their working directory. Closing a tab interrupts its active
execution, but keeps its kernel available; **Shut down** releases that kernel.
Disabling the plugin, changing its Python executable, or stopping Yotram shuts
down its managed Jupyter service and kernels. Kernel memory does not survive a
Yotram restart. Unsaved outputs remain browser-owned until you save the notebook.

Limits: Python execution only; no interactive widgets, debugger, completion from
the kernel, or `input()` prompts. Display updates are applied within the current
cell execution. Cell code is limited to 256 KB, output to 10 MB per execution,
execution to one hour, and concurrent kernels to eight per workspace (24 total).
The service refuses simultaneous execution requests for the same kernel.

## Data Viewer

Enable **Data Viewer** in Plugins, then open a `.csv`, `.tsv`, `.json`, `.jsonl`,
`.ndjson`, or `.parquet` file from the project tree. The read-only view supports
searching all columns, sorting by a column, paging through rows, and a quick bar
or line chart of average numeric values grouped by a selected column. Text files
are limited to 10 MB and 100,000 preview rows; Parquet files are limited to 64 MB
and 100,000 preview rows. Parquet is decoded in the browser, while the backend
serves bounded binary reads from the selected workspace.

## SQL Explorer

Enable **SQL Explorer**, then open a `.db`, `.sqlite`, or `.sqlite3` file from
the project tree. Choose a table or view to browse it, or enter a query and use
**Run query** (Cmd/Ctrl+Enter also runs it). Result columns can be filtered,
sorted, and charted by the average of a numeric column grouped by another result
column. Queries run against an in-memory copy and accept one `SELECT`, `WITH`,
or `EXPLAIN` statement; the original database is never written. Files are limited
to 128 MB and responses to 500 rows, 100 columns, or 2 MB.

## Git History

Enable **Git History**, then choose **Open Git History** in the Plugins menu.
The panel shows the latest 100 commits on the first-parent history, changed
files, and read-only file diffs. It does not stage files, switch branches, or
create commits.

## Adding a bundled plugin

The frontend contract is `frontend/src/plugins/types.ts`. Implement an
`EditorPlugin` and register it in `frontend/src/plugins/registry.ts`:

```ts
const plugin: EditorPlugin = {
  id: 'yotram.example',
  editors: [{ extensions: ['.example'], component: ExampleEditor }],
  commands: [{ id: 'example.new', title: 'New example', run: async context => {
    // Use an authenticated, workspace-scoped backend route to create the file.
    context.openFile('document.example');
  } }],
};
```

Editors receive `workspaceId`, `path`, the current document `content`, `theme`,
and `onChange(content)`. The host owns document saving. Editors must clean up
subscriptions and cancel in-flight operations when unmounted. Hidden notebook
tabs remain mounted so tab switching does not abandon running output streams.
A React error boundary contains render failures and offers a text-editor fallback.

The backend contract is `backend/src/plugins.ts`: provide a manifest with
`apiVersion: 1`, identity/version, settings schema, command/editor declarations
and required capabilities; implement `deactivate(workspace)` and `dispose()`;
register the plugin during server construction. Place its API routes after
Yotram authentication, validate inputs and workspace paths, and call
`PluginHost.require()` before accessing its services. The Notebook implementation
in `backend/src/notebooks.ts` and `notebookKernel.ts` is the reference.

Plugin state is stored in `plugins.json` alongside Yotram's workspace state,
outside project files. Disabling leaves files and unsaved editor contents intact.
Capability declarations are descriptive, not an OS permission sandbox. Bundled
plugins are trusted application code; kernels execute with the local user's
access, just like commands in Yotram's terminal.

The TypeScript notebook service launches a loopback-only Jupyter server, manages
its lifecycle, and communicates using Jupyter REST and WebSocket APIs. Private
tokens stay in restricted temporary runtime files and backend requests; they are
never sent to the browser. Notebook HTML is rendered in an iframe without script
or same-origin privileges and with a restrictive content security policy.

Protocol references: [Jupyter REST API](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html),
[kernel messaging](https://jupyter-client.readthedocs.io/en/stable/messaging.html),
and [notebook format](https://nbformat.readthedocs.io/en/latest/format_description.html).

## Validation

`npm test` covers the plugin API and notebook editor without requiring Python.
For real execution tests, install the optional dependencies above and run:

```sh
YOTRAM_TEST_PYTHON=/absolute/path/to/.venv/bin/python npm test --workspace backend -- --run test/notebooks.test.ts
npm run build
YOTRAM_TEST_PYTHON=/absolute/path/to/.venv/bin/python npm run test:e2e -- notebooks.spec.ts
```

The browser test creates an isolated temporary project, enables the plugin,
creates a notebook, edits and executes cells, verifies a table and plot, saves,
reopens, shuts down and disables the plugin.
