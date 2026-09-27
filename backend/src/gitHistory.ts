import type { Express } from 'express';
import { Git } from './git.js';
import type { PluginHost } from './plugins.js';
import type { Workspaces } from './workspaces.js';

export const gitHistoryManifest = {
  id: 'yotram.git-history', name: 'Git History', version: '0.1.0', apiVersion: 1 as const,
  description: 'Browse recent commits and inspect file changes in this repository.',
  setupHelp: 'Open Git History from the Plugins menu. The workspace must be inside a Git repository.',
  permissions: ['workspace.git.read'], editors: [],
  commands: [{ id: 'git-history.open', title: 'Open Git History' }], settings: {},
};

export function gitHistoryRoutes(app: Express, workspaces: Workspaces, plugins: PluginHost): void {
  app.get('/api/workspaces/:id/git-history', async (req, res) => {
    try {
      const workspace = workspaces.get(req.params.id);
      if (!workspace) { res.status(404).json({ error: 'Unknown workspace' }); return; }
      plugins.require(workspace, gitHistoryManifest.id);
      const parsedLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) throw new Error('Commit limit must be between 1 and 100');
      res.json({ commits: await new Git(workspace.path).history(parsedLimit) });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  app.get('/api/workspaces/:id/git-history/:hash/files', async (req, res) => {
    try {
      const workspace = workspaces.get(req.params.id);
      if (!workspace) { res.status(404).json({ error: 'Unknown workspace' }); return; }
      plugins.require(workspace, gitHistoryManifest.id);
      res.json({ files: await new Git(workspace.path).commitFiles(req.params.hash) });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  app.post('/api/workspaces/:id/git-history/diff', async (req, res) => {
    try {
      const workspace = workspaces.get(req.params.id);
      if (!workspace) { res.status(404).json({ error: 'Unknown workspace' }); return; }
      plugins.require(workspace, gitHistoryManifest.id);
      if (typeof req.body?.hash !== 'string' || typeof req.body?.path !== 'string' ||
        (req.body.previousPath !== undefined && typeof req.body.previousPath !== 'string')) throw new Error('Commit and file path are required');
      res.json(await new Git(workspace.path).commitFileDiff(req.body.hash, req.body.path, req.body.previousPath));
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
}
