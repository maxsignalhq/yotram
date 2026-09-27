import type { ComponentType } from 'react';
import type { Theme } from '../theme';

export interface PluginInfo {
  id: string; name: string; version: string; description: string; enabled: boolean;
  setupHelp?: string;
  permissions: string[]; settings: Record<string, string>;
  settingsSchema: Record<string, { label: string; default: string }>;
}
export interface PluginEditorProps {
  workspaceId: string; path: string; content: string; theme: Theme;
  onChange: (content: string) => void;
}
export interface PluginCommandContext { workspaceId: string; openFile: (path: string) => void; openPanel: (panel: 'git-history') => void }
export interface EditorPlugin {
  id: string;
  editors: { extensions: string[]; component: ComponentType<PluginEditorProps>; readOnly?: boolean; allowTextFallback?: boolean }[];
  commands: { id: string; title: string; run: (context: PluginCommandContext) => Promise<void> }[];
}
export async function pluginRequest(workspaceId: string, route: string, body?: unknown): Promise<any> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/${route}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Plugin request failed');
  return result;
}
