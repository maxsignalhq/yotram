# Yotram

A local browser IDE with Monaco editing, a nested file explorer, and real shell terminals.

## Run

```sh
npm ci
npm run build
node backend/dist/index.js /absolute/path/to/project --port 4287
```

Open http://127.0.0.1:4287 and choose **Open current directory**. The directory is selected by the server command; terminals start there too.

## Current capabilities

- Expand folders and open files in tabs. Unsaved buffers survive tab switches.
- Save with Cmd/Ctrl+S or the Save button. Tabs stay dirty until the server acknowledges the write.
- Create files/folders and rename or delete selected entries. Paths are relative to the project root. Existing destinations are not overwritten; only empty folders can be deleted.
- Open multiple terminals, resize them with the panel, and close their shell processes.
- Refresh directory listings after changes and reload clean open files when they change externally. Dirty files show a conflict prompt.
- Reconnect the browser connection, refresh open files, and start replacement shells after a disconnect. Running shells are not preserved across disconnects.

File contents persist on disk. Unsaved buffers do not survive a browser reload. This is a single-user localhost application: shells run with the server user's permissions. The filesystem API's path checks do not sandbox shell commands.

## Verify

```sh
npm test
npm run build
npm run test:e2e
```

## Local workspace dashboard

The home screen opens existing folders or creates a new starter project in a new folder. Recent project paths are stored in this browser. **Forget** removes a recent entry; it does not delete files. Returning to Projects closes that browser workspace's terminals, and warns about unsaved edits. Saved files remain on disk and can be reopened after restarting the server.

For a starter project, run `node server.cjs` in its terminal, click **Preview**, and load port 3000. Set `PORT=3001 node server.cjs` if another app uses that port. Previews connect directly to a loopback port and support opening in a separate tab if the app prevents embedding. They are not public share links. Detached/background processes may need to be stopped manually.

All projects use the tools installed on your Mac. There is no Docker requirement, remote execution, or project-level operating-system sandbox. The IDE remains bound to localhost; requests from other browser origins are rejected. GitHub import and multi-user hosting are not implemented.
