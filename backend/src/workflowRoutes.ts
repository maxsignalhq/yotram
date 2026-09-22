import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ActivityStore } from './activity.js';
import { Workspaces, type Workspace } from './workspaces.js';
import { Runtime } from './runtime.js';
import { installedAgents, ownedResources } from './resources.js';
import { Experiments } from './experiments.js';
import { PreviewService } from './preview.js';

export function workflowRoutes(app: Express, store: ActivityStore, workspaces: Workspaces, runtime: (workspace: Workspace) => Runtime, experiments: Experiments, previews: PreviewService) {
  const route = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response) => { Promise.resolve().then(() => fn(req, res)).catch(error => res.status(400).json({ error: (error as Error).message })); };
  const workspace = (req: Request) => { const w = workspaces.get(String(req.params.id)); if (!w) throw new Error('Workspace no longer exists. Open its folder again.'); return w; };
  const text = (value: unknown, max = 8000) => { if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text'); return value.trim(); };
  const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  app.get('/api/workspaces', route((_req, res) => res.json(workspaces.list().map(w => ({ ...w, sessions: runtime(w).pty.list() })))));
  app.delete('/api/workspaces/:id', route((req, res) => {
    const w = workspace(req); if (workspaces.get('local')?.id === w.id) throw new Error('The startup workspace remains available as the default project.'); if (runtime(w).pty.list().some(s => s.exitCode === undefined)) throw new Error('Stop running sessions before forgetting this workspace.');
    workspaces.forget(w.id); const record = store.get(w.id); if (record) { record.forgotten = true; store.changed(); } res.json({ ok: true });
  }));
  app.get('/api/agents', route(async (_req, res) => res.json(await installedAgents())));
  app.get('/api/workspaces/:id/activity', route((req, res) => {
    const record = store.register(workspace(req)); store.prune(record);
    res.json({ ...record, output: undefined, outputAt: undefined, persistenceError: store.persistenceError });
  }));
  app.get('/api/workspaces/:id/output/:session', route((req, res) => {
    const record = store.register(workspace(req)); store.prune(record); res.json({ output: record.output[String(req.params.session)] ?? '', running: runtime(workspace(req)).pty.list().some(s => s.id === req.params.session && s.exitCode === undefined) });
  }));
  app.delete('/api/workspaces/:id/activity', route((req, res) => {
    const record = store.register(workspace(req)); record.events = []; record.output = {}; record.outputAt = {}; store.changed(); res.json({ ok: true });
  }));
  app.patch('/api/workspaces/:id/activity', route((req, res) => {
    const days = req.body?.retentionDays; if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Retention must be 1–365 days.');
    const record = store.register(workspace(req)); record.retentionDays = days; store.prune(record); store.changed(); res.json({ ok: true });
  }));
  app.post('/api/workspaces/:id/handoffs', route(async (req, res) => {
    const w = workspace(req); const record = store.register(w);
    const note = text(req.body?.note); const next = text(req.body?.next ?? ''); if (!note && !next) throw new Error('Add a note or next step.');
    const port = req.body?.port; if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Invalid preview port');
    let branch: string | undefined; try { branch = (await experiments.git(w.path, ['branch', '--show-current'])).trim(); } catch { /* non-Git workspace */ }
    const handoff = { id: randomUUID(), at: Date.now(), note, next, file: text(req.body?.file ?? '', 1000), sessionId: text(req.body?.sessionId ?? '', 100), checkpointId: text(req.body?.checkpointId ?? '', 100), port, branch };
    record.handoffs.unshift(handoff); record.handoffs = record.handoffs.slice(0, 100); store.changed(); store.event(w.id, 'handoff', 'Handoff saved'); res.json(handoff);
  }));
  app.delete('/api/workspaces/:id/handoffs/:handoff', route((req, res) => {
    const record = store.register(workspace(req)); record.handoffs = record.handoffs.filter(h => h.id !== req.params.handoff); store.changed(); res.json({ ok: true });
  }));
  app.get('/api/workspaces/:id/resources', route(async (req, res) => {
    const sessions = runtime(workspace(req)).pty.list();
    const live = sessions.filter(s => s.exitCode === undefined); const groups = await ownedResources(live.map(s => s.pid));
    res.json(sessions.map(s => ({ ...s, processes: s.exitCode === undefined ? groups[live.findIndex(p => p.id === s.id)] : [] })));
  }));
  app.post('/api/workspaces/:id/sessions/:session/stop', route(async (req, res) => {
    const r = runtime(workspace(req)); await r.pty.stop(String(req.params.session), req.body?.force === true); r.list(); res.json({ ok: true });
  }));
  app.delete('/api/workspaces/:id/sessions/:session', route(async (req, res) => {
    const r = runtime(workspace(req)); await r.pty.stop(String(req.params.session), true); r.pty.kill(String(req.params.session)); r.list(); res.json({ ok: true });
  }));
  app.post('/api/workspaces/:id/stop', route(async (req, res) => {
    const r = runtime(workspace(req)); for (const session of r.pty.list()) await r.pty.stop(session.id, req.body?.force === true); r.list(); res.json({ ok: true });
  }));
  app.post('/api/workspaces/:id/preview', route(async (req, res) => {
    workspace(req); const result = await previews.open(Number(req.body?.port), `http://${req.headers.host}`, req.body?.inspect === true); res.json(result);
  }));
  app.post('/api/workspaces/:id/checkpoints', route(async (req, res) => {
    const w = workspace(req); store.register(w); const label = text(req.body?.label, 200); if (!label) throw new Error('Name the checkpoint.');
    res.json(await experiments.locked(w.id, () => experiments.checkpoint(w.id, label)));
  }));
  app.post('/api/workspaces/:id/experiments', route(async (req, res) => {
    const w = workspace(req); store.register(w); const name = text(req.body?.name, 200); if (!name) throw new Error('Name the experiment.');
    const result = await experiments.locked(w.id, () => experiments.create(w.id, name, req.body?.checkpointId ? text(req.body.checkpointId, 100) : undefined));
    const opened = await workspaces.open(result.path); store.register(opened); res.json({ ...result, workspace: opened });
  }));
  app.get('/api/workspaces/:id/experiments/:experiment/diff', route(async (req, res) => {
    const w = workspace(req); res.json({ diff: await experiments.locked(w.id, () => experiments.compare(w.id, String(req.params.experiment))) });
  }));
  app.post('/api/workspaces/:id/experiments/:experiment/merge', route(async (req, res) => {
    const w = workspace(req); await experiments.locked(w.id, () => experiments.merge(w.id, String(req.params.experiment))); res.json({ ok: true });
  }));
  app.delete('/api/workspaces/:id/experiments/:experiment', route(async (req, res) => {
    const w = workspace(req); const record = store.register(w); const experiment = record.experiments.find(e => e.id === req.params.experiment);
    if (!experiment) throw new Error('Unknown experiment');
    const ew = workspaces.list().find(item => item.path === experiment.path);
    if (ew && runtime(ew).pty.list().some(s => s.exitCode === undefined)) throw new Error('Stop the experiment’s running sessions in Resources before discarding.');
    await experiments.locked(w.id, () => experiments.discard(w.id, experiment.id, req.body?.confirm === true));
    if (ew) { workspaces.forget(ew.id); const record = store.get(ew.id); if (record) { record.forgotten = true; store.changed(); } } res.json({ ok: true });
  }));
  app.post('/api/workspaces/:id/races', route(async (req, res) => {
    const w = workspace(req); const record = store.register(w);
    let prompt = text(req.body?.prompt, 4000); if (!prompt) throw new Error('Describe the task.');
    prompt = prompt.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ');
    const agents = req.body?.agents;
    if (!Array.isArray(agents) || agents.length < 1 || agents.length > 4) throw new Error('Pick 1–4 agents.');
    if (new Set(agents).size !== agents.length) throw new Error('Pick each agent once.');
    for (const agent of agents) if (agent !== 'claude' && agent !== 'codex') throw new Error(`Unknown agent: ${agent}`);
    const available = await installedAgents();
    for (const agent of agents as ('claude' | 'codex')[]) if (!available[agent]) throw new Error(`${agent} is not installed on the server.`);
    const checkpointId = req.body?.checkpointId ? text(req.body.checkpointId, 100) : undefined;
    const raceId = randomUUID();
    await experiments.locked(w.id, async () => {
      const resolvedCheckpointId = checkpointId ?? (await experiments.checkpoint(w.id, `Race: ${prompt.slice(0, 60)}`)).id;
      for (const agent of agents as ('claude' | 'codex')[]) {
        const result = await experiments.create(w.id, `${agent} — ${prompt.slice(0, 40)}`, resolvedCheckpointId);
        const entry = record.experiments.find(e => e.id === result.id)!;
        entry.raceId = raceId; entry.agent = agent; store.changed();
        const opened = await workspaces.open(result.path); store.register(opened);
        const sessionId = randomUUID();
        runtime(opened).create(sessionId, 80, 24, `${agent} ${shellQuote(prompt)}`);
        entry.sessionId = sessionId; store.changed();
      }
    });
    res.json({ ok: true, raceId });
  }));
}
