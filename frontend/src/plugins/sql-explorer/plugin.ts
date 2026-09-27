import type { EditorPlugin } from '../types';
import { SqlExplorer } from './SqlExplorer';

export const sqlExplorerPlugin: EditorPlugin = {
  id: 'yotram.sql-explorer',
  editors: [{ extensions: ['.db', '.sqlite', '.sqlite3'], component: SqlExplorer, readOnly: true, allowTextFallback: false }],
  commands: [],
};
