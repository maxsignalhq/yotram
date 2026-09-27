import type { EditorPlugin } from '../types';
import { pluginRequest } from '../types';
import { NotebookEditor } from './NotebookEditor';

export const notebookPlugin: EditorPlugin = {
  id: 'yotram.notebook',
  editors: [{ extensions: ['.ipynb'], component: NotebookEditor }],
  commands: [{ id: 'notebook.new', title: 'New notebook', run: async ({ workspaceId, openFile }) => {
    const name = window.prompt('Notebook path, relative to project root:', 'notebook.ipynb');
    if (!name?.trim()) return;
    const path = name.trim().endsWith('.ipynb') ? name.trim() : name.trim() + '.ipynb';
    await pluginRequest(workspaceId, 'notebooks/create', { path }); openFile(path);
  } }],
};
