import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/diffParser';

const MODIFIED = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 export { x };
`;

const ADDED = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const value = 1;
+export const other = 2;
`;

const DELETED = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const gone = 1;
-export const alsoGone = 2;
`;

const RENAMED = `diff --git a/src/before.ts b/src/after.ts
similarity index 100%
rename from src/before.ts
rename to src/after.ts
`;

const BINARY = `diff --git a/logo.png b/logo.png
index 5555555..6666666 100644
Binary files a/logo.png and b/logo.png differ
`;

describe('parseUnifiedDiff', () => {
  it('returns an empty list for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  it('parses a modified file with additions and removals', () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(file.path).toBe('src/app.ts');
    expect(file.status).toBe('modified');
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(1);
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0].header).toBe('@@ -1,3 +1,4 @@');
    expect(file.hunks[0].lines).toEqual([
      { type: 'context', text: 'const x = 1;' },
      { type: 'remove', text: 'const y = 2;' },
      { type: 'add', text: 'const y = 3;' },
      { type: 'add', text: 'const z = 4;' },
      { type: 'context', text: 'export { x };' },
    ]);
  });

  it('parses an added file (--- /dev/null) as status added', () => {
    const [file] = parseUnifiedDiff(ADDED);
    expect(file.path).toBe('src/new.ts');
    expect(file.status).toBe('added');
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(0);
  });

  it('parses a deleted file (+++ /dev/null) as status deleted', () => {
    const [file] = parseUnifiedDiff(DELETED);
    expect(file.path).toBe('src/old.ts');
    expect(file.status).toBe('deleted');
    expect(file.additions).toBe(0);
    expect(file.deletions).toBe(2);
  });

  it('parses a pure rename (no content change) as status renamed', () => {
    const [file] = parseUnifiedDiff(RENAMED);
    expect(file.path).toBe('src/after.ts');
    expect(file.status).toBe('renamed');
    expect(file.additions).toBe(0);
    expect(file.deletions).toBe(0);
    expect(file.hunks).toEqual([]);
  });

  it('parses a binary file diff with no hunks', () => {
    const [file] = parseUnifiedDiff(BINARY);
    expect(file.path).toBe('logo.png');
    expect(file.status).toBe('modified');
    expect(file.additions).toBe(0);
    expect(file.deletions).toBe(0);
    expect(file.hunks).toEqual([]);
  });

  it('parses multiple files from one diff', () => {
    const files = parseUnifiedDiff(MODIFIED + ADDED);
    expect(files).toHaveLength(2);
    expect(files.map(f => f.path)).toEqual(['src/app.ts', 'src/new.ts']);
  });
});
