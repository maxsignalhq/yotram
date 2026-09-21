# Yotram browser extension

Loads unpacked in Chrome:

1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select this `extension/` folder.
4. Click the Yotram toolbar icon once — since no URL is configured yet,
   this opens Settings. Set your Yotram server's LAN URL (e.g.
   `http://192.168.1.42:4287`, printed by the server on startup) and
   save.

## Manual test checklist

Run these against a real Yotram server on your home network after any
change to `background.js`, `options.js`, or `manifest.json`.

- [ ] **No URL configured**: on a fresh install, click the icon — the
      Settings page opens instead of attempting a connection.
- [ ] **Reachable case**: with the server running and a URL configured,
      click the icon — a new tab opens to the configured URL.
- [ ] **Already-open-tab case**: with a Yotram tab already open, click
      the icon — that tab is focused instead of opening a new one.
- [ ] **Unreachable case**: stop the server, click the icon — a new tab
      opens showing "Yotram isn't running".
