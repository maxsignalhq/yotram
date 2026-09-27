import type { Express } from 'express';
import type { PluginHost } from './plugins.js';
import type { Workspaces } from './workspaces.js';
import { WorkspaceFs } from './fs.js';

export const dataViewerManifest = {
  id: 'yotram.data-viewer', name: 'Data Viewer', version: '0.1.0', apiVersion: 1 as const,
  description: 'Browse CSV, JSON, JSON Lines, and Parquet files with filters, sorting, and quick charts.',
  setupHelp: 'Data stays in this workspace and is read locally by Yotram. Parquet previews are limited to 64 MB; table previews display up to 100,000 rows.',
  permissions: ['workspace.files.read'], editors: ['.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.parquet'],
  commands: [], settings: {},
};

export function dataViewerRoutes(app: Express, workspaces: Workspaces, plugins: PluginHost): void {
  app.get('/api/workspaces/:id/data/binary', async (req, res) => {
    try {
      const workspace = workspaces.get(req.params.id);
      if (!workspace) { res.status(404).json({ error: 'Unknown workspace' }); return; }
      plugins.require(workspace, dataViewerManifest.id);
      if (typeof req.query.path !== 'string' || !req.query.path.toLowerCase().endsWith('.parquet')) {
        res.status(400).json({ error: 'Choose a .parquet file' }); return;
      }
      const content = await new WorkspaceFs(workspace.path).readBinary(req.query.path, 64 * 1024 * 1024);
      res.setHeader('Cache-Control', 'no-store');
      res.type('application/octet-stream').send(content);
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
}
