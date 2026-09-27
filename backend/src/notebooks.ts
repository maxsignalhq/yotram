import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { Express, Response } from 'express';
import type { Workspace, Workspaces } from './workspaces.js';
import { WorkspaceFs } from './fs.js';
import { PluginHost, type BundledPlugin } from './plugins.js';
import { JupyterRuntime, NotebookKernel as Kernel } from './notebookKernel.js';

export const notebookManifest = {
  id: 'yotram.notebook', name: 'Notebook', version: '0.1.0', apiVersion: 1 as const,
  description: 'Edit Jupyter notebooks and run Python cells locally.',
  setupHelp: 'Choose a Python executable such as .venv/bin/python with jupyter_server and ipykernel installed. Changing the environment or disabling this plugin stops its kernels.',
  permissions: ['workspace.files', 'local.processes'], editors: ['.ipynb'],
  commands: [{ id: 'notebook.new', title: 'New notebook' }],
  settings: { python: { label: 'Python executable', default: 'python3' } },
};
export class NotebookPlugin implements BundledPlugin {
  manifest = notebookManifest;
  private kernels = new Map<string, { workspace: string; kernel: Kernel }>();
  private runtimes = new Map<string, JupyterRuntime>();
  deactivate(workspace: Workspace): void {
    for (const [key, entry] of this.kernels) if (entry.workspace === workspace.id) { entry.kernel.dispose(); this.kernels.delete(key); }
    this.runtimes.get(workspace.id)?.dispose(); this.runtimes.delete(workspace.id);
  }
  dispose(): void { for (const entry of this.kernels.values()) entry.kernel.dispose(); this.kernels.clear(); for (const runtime of this.runtimes.values()) runtime.dispose(); this.runtimes.clear(); }
  routes(app: Express, workspaces: Workspaces, host: PluginHost): void {
    const base = '/api/workspaces/:id/notebooks';
    app.post(base + '/create', async (req, res) => {
      try {
        const workspace = workspaces.get(req.params.id);
        if (!workspace) throw new Error('Unknown workspace');
        host.require(workspace, this.manifest.id);
        const file = notebookPath(req.body?.path);
        await new WorkspaceFs(workspace.path).create(file, false, JSON.stringify({
          cells: [{ id: randomUUID(), cell_type: 'code', metadata: {}, source: '', outputs: [], execution_count: null }],
          metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' }, language_info: { name: 'python' } }, nbformat: 4, nbformat_minor: 5,
        }, null, 2) + '\n');
        res.json({ path: file });
      } catch (error) { res.status(400).json({ error: (error as Error).message }); }
    });
    app.post(base + '/:action', async (req, res) => {
      let kernel: Kernel | undefined;
      let disconnect: (() => void) | undefined;
      try {
        const workspace = workspaces.get(req.params.id);
        if (!workspace) throw new Error('Unknown workspace');
        host.require(workspace, this.manifest.id);
        const file = notebookPath(req.body?.path);
        const action = req.params.action;
        if (!['status', 'start', 'execute', 'interrupt', 'restart', 'stop'].includes(action)) throw new Error('Unknown notebook action');
        // Canonical notebook identity avoids aliases creating multiple kernels for one file.
        await new WorkspaceFs(workspace.path).read(file);
        const absolute = await realpath(path.resolve(workspace.path, file));
        const state = host.require(workspace, this.manifest.id);
        const key = `${workspace.id}:${absolute}`;
        kernel = this.kernels.get(key)?.kernel;
        if (action === 'stop') { await kernel?.shutdown(); res.json({ status: 'stopped' }); return; }
        if (action === 'status') { res.json({ status: kernel ? !kernel.started ? 'starting' : kernel.busy ? 'busy' : 'ready' : 'stopped' }); return; }
        if (action === 'execute' && (typeof req.body.code !== 'string' || req.body.code.length > 256 * 1024)) throw new Error('Cell code must be a string under 256 KB');
        if (!kernel && (action === 'interrupt' || action === 'restart')) throw new Error('Start the kernel first');
        if (!kernel) {
          if (this.kernels.size >= 24 || [...this.kernels.values()].filter(entry => entry.workspace === workspace.id).length >= 8) throw new Error('Kernel limit reached. Shut down an unused notebook kernel.');
          const configured = state.settings.python;
          const python = configured.includes('/') && !path.isAbsolute(configured) ? path.resolve(workspace.path, configured) : configured;
          let runtime = this.runtimes.get(workspace.id);
          if (!runtime) {
            const createdRuntime = new JupyterRuntime(python, workspace.path, () => {
              if (this.runtimes.get(workspace.id) === createdRuntime) {
                this.runtimes.delete(workspace.id);
                for (const entry of this.kernels.values()) if (entry.workspace === workspace.id) entry.kernel.dispose();
              }
            });
            runtime = createdRuntime; this.runtimes.set(workspace.id, runtime);
          }
          const created = new Kernel(runtime, path.relative(workspace.path, absolute), () => { if (this.kernels.get(key)?.kernel === created) this.kernels.delete(key); });
          kernel = created; this.kernels.set(key, { workspace: workspace.id, kernel });
        }
        await kernel.ready;
        if (!host.require(workspace, this.manifest.id).enabled) throw new Error('Plugin disabled');
        if (res.destroyed) return;
        if (action === 'start') { res.json({ status: 'ready' }); return; }
        if (action === 'execute') {
          if (kernel.busy) throw new Error('Kernel is busy');
          res.setHeader('Content-Type', 'application/x-ndjson');
          res.setHeader('Cache-Control', 'no-store');
          res.flushHeaders();
          disconnect = () => { if (!res.writableEnded) void kernel?.request('interrupt').catch(() => {}); };
          res.on('close', disconnect);
          await kernel.request('execute', req.body.code, message => {
            if (!res.destroyed) {
              res.write(JSON.stringify({ event: message.event, content: message.content }) + '\n');
              if (res.writableLength > 12 * 1024 * 1024) res.destroy();
            }
          });
          if (!res.destroyed) res.end(JSON.stringify({ done: true }) + '\n');
        } else { await kernel.request(action); res.json({ status: 'ready' }); }
      } catch (error) { respondError(res, (error as Error).message); }
      finally { if (disconnect) res.off('close', disconnect); }
    });
  }
}
function notebookPath(value: unknown): string {
  if (typeof value !== 'string' || !value.endsWith('.ipynb') || value.length > 4096) throw new Error('Choose a .ipynb file');
  return value;
}
function respondError(res: Response, error: string): void {
  if (res.destroyed) return;
  if (res.headersSent) res.end(JSON.stringify({ error }) + '\n');
  else res.status(400).json({ error });
}
