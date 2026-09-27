import type { EditorPlugin } from './types';
import { notebookPlugin } from './notebook/plugin';
import { dataViewerPlugin } from './data-viewer/plugin';
import { sqlExplorerPlugin } from './sql-explorer/plugin';
import { gitHistoryPlugin } from './git-history/plugin';

// Explicitly reviewed, bundled contributions. No arbitrary plugin code is loaded.
const registry = new Map<string, EditorPlugin>();
export function registerPlugin(plugin: EditorPlugin): void {
  if (registry.has(plugin.id)) throw new Error(`Duplicate plugin: ${plugin.id}`);
  registry.set(plugin.id, plugin);
}
registerPlugin(notebookPlugin);
registerPlugin(dataViewerPlugin);
registerPlugin(sqlExplorerPlugin);
registerPlugin(gitHistoryPlugin);
export function getPlugin(id: string): EditorPlugin | undefined { return registry.get(id); }
