# Yotram

A browser IDE for projects on your own machine: Monaco editing, real shell terminals,
Git review, local coding agents, previews, and a shared workspace history.

## Run

```sh
export YOTRAM_PASSWORD='choose-a-strong-password'
npm ci
npm run build
node backend/dist/index.js /absolute/path/to/project --port 4287
```

Alternatively configure `~/.yotram/config.json` with `{ "password": "..." }`.
There is no default password. The server refuses to start without one.

The default bind address is `0.0.0.0`; startup prints local and LAN addresses.
Open the LAN address from another device on your home network. Use
`--host 127.0.0.1` to restrict access to this machine.

This is a single-user tool with a shared password. Signed-in users can open local
folders and run shells as the server's user. Traffic is HTTP; use a trusted network.
Do not expose it directly to the internet. Filesystem path checks are not a shell sandbox.

## Workspace continuity

- Terminals belong to the server-side workspace, not the browser tab. Refreshing,
  closing a browser, changing devices, or returning to Projects leaves them running.
- Reopening a workspace attaches to its existing terminals. Up to 128 KB of recent
  raw terminal output is replayed per session. Multiple browsers share input and
  terminal size, like two clients attached to the same terminal.
- Closing a terminal with its × button explicitly stops/removes it. Resources also
  provides graceful Stop, Force stop, and Stop workspace actions.
- Server shutdown/restart ends running shells. Process resurrection is not supported.
  Workspace metadata, handoffs, checkpoints, and recorded activity survive a restart.
- Open/dirty editor buffers remain browser memory; save before refreshing or switching.

Projects are registered on the server and visible across devices. The dashboard shows
running-session and attention counts. Forget removes a project from that registry;
files and saved history remain. Stop its sessions before forgetting. The startup
workspace remains available as the default project.

## Editing, Git, and agents

### Notebook plugin

Open **Plugins** to enable the bundled Notebook plugin for a workspace. Choose a
local Python executable, then create or open `.ipynb` files to edit cells, run
Python, view plots/tables, and save outputs. Yotram's integration is TypeScript;
Python with `jupyter_server` and `ipykernel` is optional and required only for
execution. See [Notebook setup and the plugin API](docs/plugins.md).

The editor supports nested folders, tabs, save acknowledgements, file/folder creation,
rename/delete, and external-change handling. Dirty buffers prompt before external changes
replace them. Only empty directories can be deleted through the file explorer.

The Git sidebar provides status, diffs, stage/unstage, commits, and branch switching.
Push/pull/fetch stay terminal operations. The Sessions sidebar reads saved Claude Code
and Codex histories and resumes a selected conversation in a new terminal. These formats
are undocumented; supported metadata variants are parsed defensively.

Start Claude / Start Codex buttons appear when those executables are available on the
server's PATH. A launcher or **Resources → Run a tracked command** starts a terminal
and its command atomically. The command's exit status is recorded when it returns to
the shell. Ordinary interactive terminal input is not interpreted as structured tasks.

The bell opts into browser notifications for shell exits and tracked-command completion
while the page is hidden. Browser support and permission vary; notifications require an
open browser tab. They are not push notifications. Session attention is also shown in
Resources and the dashboard. Explicit integrations can request attention by writing:

```sh
printf '\033]777;yotram;attention;Please review the changes\007'
```

These are process-reported signals, not verified claims that an agent is blocked or
that tests passed. No provider-specific approval interception is implemented.

## Previews and element-to-task capture

Start a web server in a terminal, open Preview, and enter its port. Yotram proxies the
server's loopback port through a separately authenticated browser origin, so a phone
can view the app running on your Mac. HTTP and WebSocket traffic are supported, including
root-relative assets. Each target gets a separate ephemeral LAN port; the host firewall
must allow it. IDE credentials and upstream cookies are not forwarded between apps.

Preview access starts with a one-use, one-minute ticket and an eight-hour preview cookie.
Opening the preview in a separate tab works after loading it inside Yotram. Restarting
Yotram invalidates preview sessions. At most 20 target ports are proxied per server run.
Previews target HTTP loopback services; upstream app cookies, HTTPS backends, and apps
that hard-code their own origin may require adaptation. Yotram preserves app CSP, so
apps can still prohibit embedding or helper scripts.

For **Preview-to-task**:

1. Enable **element capture** and load the preview.
2. Choose **Select element**, then click the target in the app.
3. Review the screenshot, element HTML, selected styles, URL, and viewport.
4. Add the task request, edit the HTML context or remove the screenshot, then copy the
   task text or download the JSON bundle with its screenshot.

The helper runs only when opted in. A source hint is included when the element has a
`data-source` attribute; arbitrary source-code mapping is not promised. Screenshots are
DOM-rendered using html2canvas, so cross-origin media, canvas content, or app CSP may limit
fidelity. Captures stay in browser memory unless downloaded or explicitly shared.

## Workspace tools

### What did I miss? / Timeline

Reopening a project shows an unread-activity banner. Recap lists changes since this
browser last marked the project as read, with file, session-output, and evidence links.
Timeline shows retained activity, filters by text/file/kind and session, and exposes
retention controls. Events cover watched file changes, managed commands, terminal
lifecycle, explicit attention, handoffs, checkpoints, and experiments. Managed-command
completion also records a bounded tracked-file diff when available (first 100 changed
files, up to 16 KB of event evidence); explicit checkpoints retain the full Git snapshot.

This is a factual recorder: coincident events do not establish which agent changed a
file. Test output is available as evidence; there is no heuristic pass/fail parser or AI
summary. Use tracked commands when completion status matters.

### Handoffs

Save notes and a next step with the selected file, terminal, preview port, branch, and
optional checkpoint. Cards are available on other devices. **Restore context** reopens
available UI context and identifies a missing terminal/checkpoint. It does not reset
files, change branches, restart dead processes, or guarantee an old preview is running.
**Prepare agent handoff** produces copyable text.

### Resources

Resources lists live Yotram-owned shell process trees, PID, CPU percentage, memory,
elapsed time, and detected TCP listening ports. Open a preview directly from a port.
Controls target owned sessions rather than arbitrary machine PIDs. Descendant discovery
uses `ps`; port discovery uses `lsof`. Detached/reparented processes may no longer be
attributable and are not automatically stopped. macOS is the primary supported host.

### Checkpoints / Safe experiments

Open a Git repository root with an initial commit. **Create checkpoint** snapshots
tracked and non-ignored untracked files using a temporary Git index, preserving your
working tree and real staging area. Common secret filenames (`.env*`, key/certificate
files, credentials/secrets files) are excluded from new snapshot changes. Previously
committed private files remain at HEAD. Review the resulting diff before using it.
Checkpoints are retained under `refs/yotram/checkpoints/` without changing your branch.

**Try an alternative** creates a new branch and separate worktree from the selected
checkpoint or a clean HEAD. Dirty work requires an explicit checkpoint or commit; it
is never silently dropped. Each experiment has a suggested available preview port
(not a reservation), and can be opened as a normal workspace with its own agents.

**Compare changes** includes tracked and non-private untracked experiment edits.
**Merge** requires both workspaces to be clean and committed. Normal Git merges are
supported; if conflicts arise, resolve and commit in the original workspace or use
`git merge --abort`. **Keep branch** leaves the branch/worktree available. **Discard**
requires confirmation and no running experiment sessions before removing its branch
and worktree files. Worktrees share the OS, credentials, databases, and external services.

## Local storage and limits

Default state: `~/.yotram/state/workspaces.json`; override with `YOTRAM_STATE_DIR`.
Experiments live under that directory's `experiments/`. State is atomically replaced
with owner-only file permissions. Use one Yotram server per state directory.

- Default event retention: 30 days; configurable from 1–365 days.
- Maximum 2,000 events per workspace, 100 handoffs, 50 terminal sessions.
- Durable output: up to 64 KB per session for the latest 50 recorded sessions.
- Checkpoint diff previews are capped at 250 KB; Git retains the underlying snapshot.
- Clear history deletes recorded events/output, not handoffs, checkpoints, working
  files, or a running terminal's in-memory replay buffer.

Common credential patterns are redacted from durable terminal output and managed-command
history, but redaction is best effort. Raw terminal replay is in memory. Avoid entering
secrets in recorded commands. Common private filenames and Yotram/agent state directories
are excluded from file activity recording. Handoff text is stored as entered.

## Verify

```sh
npm test
npm run build
npm run test:e2e
```

Tests cover existing editing/Git/auth behavior plus shell reattachment, durable handoffs,
preview authentication and credential isolation, checkpoints/index preservation, experiment
comparison/merge/discard, and browser element capture. Browser tests use temporary projects
and a separate temporary state directory.

Optional later extensions: AI-written recaps, first-class provider approval integrations,
framework-specific source mapping, multi-element capture, continuous screenshots,
side-by-side previews, automatic idle cleanup, and process survival across server restarts.
