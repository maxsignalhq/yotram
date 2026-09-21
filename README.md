# Yotram

A local browser IDE with Monaco editing, a nested file explorer, and real shell terminals.

## Run

Set a password before starting the server — either an environment variable or a config file:

```sh
export YOTRAM_PASSWORD=choose-a-strong-password
# or: create ~/.yotram/config.json with {"password": "choose-a-strong-password"}
```

The server refuses to start with a clear error if neither is set.

```sh
npm ci
npm run build
node backend/dist/index.js /absolute/path/to/project --port 4287
```

By default the server binds to `0.0.0.0`, so it is reachable from other devices on the same network, not just this machine. On startup it prints both a `Local:` URL and a `Network:` URL for each LAN address it finds. Pass `--host 127.0.0.1` to restrict it back to localhost-only:

```sh
node backend/dist/index.js /absolute/path/to/project --port 4287 --host 127.0.0.1
```

Open the printed URL and sign in with the configured password, then choose **Open current directory**. The directory is selected by the server command; terminals start there too.

Traffic is plain HTTP, not HTTPS — fine for a trusted home network, but this server should not be exposed directly to the public internet.

The shared password is the primary control on who can reach the IDE. Anyone who reaches the server and signs in gets an interactive shell (via terminals) as the server's user, and can open any path Workspaces resolves to, including absolute paths. Treat the password with the same care as a shell login, not as a lightweight access code.

## Current capabilities

- Expand folders and open files in tabs. Unsaved buffers survive tab switches.
- Save with Cmd/Ctrl+S or the Save button. Tabs stay dirty until the server acknowledges the write.
- Create files/folders and rename or delete selected entries. Paths are relative to the project root. Existing destinations are not overwritten; only empty folders can be deleted.
- Open multiple terminals, resize them with the panel, and close their shell processes.
- Refresh directory listings after changes and reload clean open files when they change externally. Dirty files show a conflict prompt.
- Reconnect the browser connection, refresh open files, and start replacement shells after a disconnect. Running shells are not preserved across disconnects.
- View git status (staged/unstaged/untracked), view diffs, stage/unstage, commit, and switch branches from the Files/Git sidebar tab, for folders that are git repositories. This is local-only: push, pull, and fetch are not exposed here and stay a terminal operation.
- Get a browser notification when a terminal's process exits while the tab isn't visible. Opt-in via the bell toggle in the header; it never prompts automatically. Notifications only work while the tab stays open somewhere — there's no push notification support, so closing the tab means no more notifications.

File contents persist on disk. Unsaved buffers do not survive a browser reload. Shells run with the server user's permissions. The filesystem API's path checks do not sandbox shell commands.

## Verify

```sh
npm test
npm run build
npm run test:e2e
```

## Local workspace dashboard

The home screen opens existing folders or creates a new starter project in a new folder. Recent project paths are stored in this browser. **Forget** removes a recent entry; it does not delete files. Returning to Projects closes that browser workspace's terminals, and warns about unsaved edits. Saved files remain on disk and can be reopened after restarting the server.

For a starter project, run `node server.cjs` in its terminal, click **Preview**, and load port 3000. Set `PORT=3001 node server.cjs` if another app uses that port. Previews connect directly to a loopback port and support opening in a separate tab if the app prevents embedding. They are not public share links. Detached/background processes may need to be stopped manually.

All projects use the tools installed on your Mac. There is no Docker requirement, remote execution, or project-level operating-system sandbox. Requests from other browser origins are rejected. GitHub import and multi-user hosting are not implemented.

### Known limitations

The Preview panel resolves `http://127.0.0.1:<port>` from the *viewing browser's* machine. This only works correctly when viewing the IDE from the same machine the server runs on. From a phone or another device on the LAN, Preview will either show nothing, or — if that device happens to have something else running on the same port — show the wrong app entirely. This is a known limitation, not yet fixed.
