export type DiffLineType = 'add' | 'remove' | 'context';
export interface DiffLine { type: DiffLineType; text: string }
export interface DiffHunk { header: string; lines: DiffLine[] }
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';
export interface ParsedFile { path: string; status: FileStatus; additions: number; deletions: number; hunks: DiffHunk[] }

const FILE_HEADER = /^diff --git (?:"a\/(.*)"|a\/(.*)) (?:"b\/(.*)"|b\/(.*))$/;

export function parseUnifiedDiff(diffText: string): ParsedFile[] {
  if (!diffText.trim()) return [];
  const lines = diffText.split('\n');
  const files: ParsedFile[] = [];
  let current: ParsedFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let aPath = '';
  let bPath = '';
  let sawDevNullMinus = false;
  let sawDevNullPlus = false;

  function finishFile() {
    if (!current) return;
    if (current.status === 'modified' && aPath && bPath && aPath !== bPath) current.status = 'renamed';
    files.push(current);
    current = null; currentHunk = null; sawDevNullMinus = false; sawDevNullPlus = false;
  }

  for (const line of lines) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      finishFile();
      aPath = header[1] ?? header[2]; bPath = header[3] ?? header[4];
      current = { path: bPath, status: 'modified', additions: 0, deletions: 0, hunks: [] };
      continue;
    }
    if (!current) continue;
    if (!currentHunk && line.startsWith('--- ')) { sawDevNullMinus = line === '--- /dev/null'; continue; }
    if (!currentHunk && line.startsWith('+++ ')) {
      sawDevNullPlus = line === '+++ /dev/null';
      if (sawDevNullMinus) current.status = 'added';
      else if (sawDevNullPlus) { current.status = 'deleted'; current.path = aPath; }
      continue;
    }
    if (line.startsWith('index ') || line.startsWith('new file mode') || line.startsWith('deleted file mode') || line.startsWith('similarity index') || line.startsWith('rename from') || line.startsWith('rename to')) continue;
    if (line.startsWith('Binary files ')) continue;
    if (line.startsWith('@@ ')) {
      const end = line.indexOf('@@', 3);
      currentHunk = { header: end === -1 ? line : line.slice(0, end + 2), lines: [] };
      current.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith('+')) { currentHunk.lines.push({ type: 'add', text: line.slice(1) }); current.additions++; }
    else if (line.startsWith('-')) { currentHunk.lines.push({ type: 'remove', text: line.slice(1) }); current.deletions++; }
    else if (line.startsWith(' ')) currentHunk.lines.push({ type: 'context', text: line.slice(1) });
  }
  finishFile();
  return files;
}
