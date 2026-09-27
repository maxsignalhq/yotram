import { Component, createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getPlugin } from './registry';
import { pluginRequest, type PluginInfo } from './types';

interface PluginContextValue { workspaceId: string; plugins: PluginInfo[]; refresh: () => Promise<void>; error: string }
const PluginContext = createContext<PluginContextValue>({ workspaceId: '', plugins: [], refresh: async () => {}, error: '' });
export const usePlugins = () => useContext(PluginContext);
export function PluginProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [error, setError] = useState('');
  async function refresh() {
    try { const result = await pluginRequest(workspaceId, 'plugins'); if (Array.isArray(result)) setPlugins(result); setError(''); }
    catch (error) { setError((error as Error).message); }
  }
  useEffect(() => { void refresh(); }, [workspaceId]);
  return <PluginContext.Provider value={{ workspaceId, plugins, refresh, error }}>{children}</PluginContext.Provider>;
}
export function usePluginEditor(path: string) {
  const { plugins } = usePlugins();
  for (const info of plugins) {
    if (!info.enabled) continue;
    const plugin = getPlugin(info.id);
    const editor = plugin?.editors.find(editor => editor.extensions.some(extension => path.toLowerCase().endsWith(extension)));
    if (editor) return editor;
  }
  return undefined;
}

export class PluginBoundary extends Component<{ children: ReactNode; onRaw: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div role="alert" className="plugin-error">The plugin editor encountered an error. Your document is still available.<button onClick={this.props.onRaw}>Open as text</button></div> : this.props.children; }
}

export function PluginsMenu({ openFile, openPanel }: { openFile: (path: string) => void; openPanel: (panel: 'git-history') => void }) {
  const [open, setOpen] = useState(false);
  const { plugins, refresh, error } = usePlugins();
  return <>
    <button aria-pressed={open} onClick={() => { setOpen(!open); if (!open) void refresh(); }}>Plugins</button>
    {open && <section className="plugins-dialog" role="dialog" aria-label="Yotram plugins">
      <div className="pane-toolbar"><strong>Yotram plugins</strong><button aria-label="Close plugins" onClick={() => setOpen(false)}>×</button></div>
      <p>Bundled tools for this workspace. Enable only what you need.</p>
      {error && <p role="alert">{error}</p>}
      {plugins.map(info => <PluginCard key={info.id} info={info} onCommandDone={() => setOpen(false)} openFile={openFile} openPanel={openPanel} />)}
      {!plugins.length && !error && <p>Loading plugins…</p>}
      <small>Settings apply to this project. Kernels run locally with your user account’s access.</small>
    </section>}
  </>;
}
function PluginCard({ info, openFile, openPanel, onCommandDone }: { info: PluginInfo; openFile: (path: string) => void; openPanel: (panel: 'git-history') => void; onCommandDone: () => void }) {
  const { workspaceId, refresh } = usePlugins();
  const [settings, setSettings] = useState(info.settings);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const savedSettings = JSON.stringify(info.settings);
  useEffect(() => setSettings(JSON.parse(savedSettings)), [savedSettings]);
  async function update(enabled: boolean) {
    setPending(true); setError('');
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/plugins/${info.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, settings }),
      });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      await refresh();
    } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  return <article className="plugin-card">
    <div className="plugin-card-heading">
      <div className="plugin-card-title"><strong>{info.name}</strong><span className={`plugin-state${info.enabled ? ' is-enabled' : ''}`}>{info.enabled ? 'Enabled' : 'Disabled'}</span></div>
      <button className="plugin-toggle" disabled={pending} onClick={() => void update(!info.enabled)}>{info.enabled ? 'Disable' : 'Enable'} {info.name}</button>
    </div>
    <p className="plugin-description">{info.description}</p>
    {info.enabled && getPlugin(info.id)?.commands.length ? <div className="plugin-actions">
      {getPlugin(info.id)?.commands.map(command => <button key={command.id} disabled={pending} onClick={async () => {
        setPending(true); setError('');
        try { await command.run({ workspaceId, openFile, openPanel }); onCommandDone(); }
        catch (error) { setError((error as Error).message); }
        finally { setPending(false); }
      }}>{command.title}</button>)}
    </div> : null}
    <details className="plugin-details">
      <summary>Settings and access</summary>
      <div className="plugin-details-content">
        {Object.entries(info.settingsSchema).map(([key, spec]) => <label key={key}>{spec.label}<input value={settings[key] ?? spec.default} onChange={event => setSettings({ ...settings, [key]: event.target.value })} placeholder={spec.default} /></label>)}
        {info.setupHelp && <p className="plugin-hint">{info.setupHelp}</p>}
        <small>Access: {info.permissions.length ? info.permissions.join(', ') : 'No additional access'}</small>
        <div className="plugin-actions"><button disabled={pending} onClick={() => void update(info.enabled)}>Save settings</button></div>
      </div>
    </details>
    {error && <p role="alert" className="plugin-error">{error}</p>}
  </article>;
}
