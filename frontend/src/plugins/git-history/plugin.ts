import type { EditorPlugin } from '../types';

export const gitHistoryPlugin: EditorPlugin = {
  id: 'yotram.git-history', editors: [],
  commands: [{ id: 'git-history.open', title: 'Open Git History', run: async ({ openPanel }) => openPanel('git-history') }],
};
