import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import type { Workspace, Workspaces } from './workspaces.js';

export interface PluginManifest {
  id: string; name: string; version: string; apiVersion: 1; description: string;
  setupHelp?: string;
  permissions: string[]; editors: string[]; commands: { id: string; title: string }[];
  settings: Record<string, { label: string; default: string }>;
}
export interface PluginState { enabled: boolean; settings: Record<string, string> }
export interface BundledPlugin {
  manifest: PluginManifest;
  deactivate(workspace: Workspace): void;
  dispose(): void;
}

/** Trusted, bundled plugins only. Manifests describe capabilities, not an OS sandbox. */
export class PluginHost {
  private plugins = new Map<string, BundledPlugin>();
  private states: Record<string, Record<string, PluginState>> = {};
  constructor(private directory: string) {
    try { this.states = JSON.parse(readFileSync(path.join(directory, 'plugins.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Unable to read plugin settings; using defaults'); }
    if (!this.states || typeof this.states !== 'object' || Array.isArray(this.states)) this.states = {};
  }
  register(plugin: BundledPlugin): void {
    if (this.plugins.has(plugin.manifest.id) || plugin.manifest.apiVersion !== 1) throw new Error('Invalid plugin registration');
    this.plugins.set(plugin.manifest.id, plugin);
  }
  state(workspace: Workspace, id: string): PluginState {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error('Unknown plugin');
    const saved = this.states[workspace.id]?.[id];
    const settings = Object.fromEntries(Object.entries(plugin.manifest.settings).map(([key, spec]) => [key, typeof saved?.settings?.[key] === 'string' ? saved.settings[key] : spec.default]));
    return { enabled: saved?.enabled === true, settings };
  }
  require(workspace: Workspace, id: string): PluginState {
    const state = this.state(workspace, id);
    if (!state.enabled) throw new Error(`Enable the ${this.plugins.get(id)!.manifest.name} plugin in Plugins first`);
    return state;
  }
  update(workspace: Workspace, id: string, input: unknown): PluginState {
    const plugin = this.plugins.get(id);
    if (!plugin || !input || typeof input !== 'object') throw new Error('Invalid plugin settings');
    const value = input as Partial<PluginState>;
    if (typeof value.enabled !== 'boolean') throw new Error('enabled must be a boolean');
    const previous = this.state(workspace, id);
    const settings = { ...previous.settings };
    if (value.settings !== undefined) {
      if (!value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)) throw new Error('Invalid settings');
      for (const [key, setting] of Object.entries(value.settings)) {
        if (!Object.hasOwn(plugin.manifest.settings, key) || typeof setting !== 'string' || !setting.trim() || setting.length > 4096 || setting.includes('\0')) throw new Error('Invalid plugin setting');
        settings[key] = setting.trim();
      }
    }
    const next = { enabled: value.enabled, settings };
    const states = { ...this.states, [workspace.id]: { ...this.states[workspace.id], [id]: next } };
    mkdirSync(this.directory, { recursive: true });
    const file = path.join(this.directory, 'plugins.json');
    writeFileSync(file + '.tmp', JSON.stringify(states, null, 2), { mode: 0o600 });
    renameSync(file + '.tmp', file);
    this.states = states;
    if (!next.enabled || JSON.stringify(previous.settings) !== JSON.stringify(settings)) plugin.deactivate(workspace);
    return next;
  }
  routes(app: Express, workspaces: Workspaces): void {
    app.get('/api/workspaces/:id/plugins', (req, res) => {
      const workspace = workspaces.get(req.params.id);
      if (!workspace) { res.status(404).json({ error: 'Unknown workspace' }); return; }
      res.json([...this.plugins.values()].map(plugin => ({ ...plugin.manifest, settingsSchema: plugin.manifest.settings, ...this.state(workspace, plugin.manifest.id) })));
    });
    app.put('/api/workspaces/:id/plugins/:plugin', (req, res) => {
      try {
        const workspace = workspaces.get(req.params.id);
        if (!workspace) { res.status(404).json({ error: 'Unknown workspace' }); return; }
        res.json(this.update(workspace, req.params.plugin, req.body));
      } catch (error) { res.status(400).json({ error: (error as Error).message }); }
    });
  }
  dispose(): void { for (const plugin of this.plugins.values()) plugin.dispose(); }
}
