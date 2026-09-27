import type { EditorPlugin } from '../types';
import { DataViewer } from './DataViewer';

export const dataViewerPlugin: EditorPlugin = {
  id: 'yotram.data-viewer',
  editors: [{ extensions: ['.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.parquet'], component: DataViewer, readOnly: true, allowTextFallback: false }],
  commands: [],
};
