# qpilot desktop app (macOS, Windows)

qpilot as a regular desktop app. Install it from a `.dmg` or `.exe` and launch it like any other app: no Node.js, npm or terminal needed. Google Chrome still has to be installed, because the agent drives it. Connecting test cases from Git also needs `git`.

## Download

Ready-made installers are on the [Releases page](https://github.com/Lord-of-world/qpilot/releases/latest):

| System | File |
|---|---|
| macOS, Apple Silicon (M1 and newer) | [qpilot-mac-arm64.dmg](https://github.com/Lord-of-world/qpilot/releases/latest/download/qpilot-mac-arm64.dmg) |
| macOS, Intel | [qpilot-mac-x64.dmg](https://github.com/Lord-of-world/qpilot/releases/latest/download/qpilot-mac-x64.dmg) |
| Windows 10/11, x64 | [qpilot-win-x64.exe](https://github.com/Lord-of-world/qpilot/releases/latest/download/qpilot-win-x64.exe) |

The installers are not signed with an Apple or Microsoft certificate, so the system warns the first time:

- **macOS:** open the app once and let macOS refuse it. Then go to **System Settings → Privacy & Security → Open Anyway**. macOS 15 and newer removed the right-click → Open shortcut. Or run `xattr -dr com.apple.quarantine /Applications/qpilot.app` in Terminal.
- **Windows:** SmartScreen shows "Windows protected your PC". Click **More info → Run anyway**.

## Build

From the repo root, with Node 20.12+:

```bash
npm install
npm --prefix desktop install
npm --prefix desktop run dist        # macOS (arm64 + x64) and Windows (x64)
npm --prefix desktop run dist:mac    # or one platform
npm --prefix desktop run dist:win
```

- **Output.** Installers land in `desktop/dist/` as `qpilot-<version>-<os>-<arch>.dmg|exe`. `dist` builds the web app first (`npm run build` in the root), then packages it.
- **Cross-building.** All three are built on a Mac. The Windows installer is cross-built without Wine.
- **Trying the shell.** To run it without packaging, use `npm --prefix desktop start`, which uses `../.next/standalone` directly.

## How it works

- **Server.** `main.js` starts `.next/standalone/server.js` (the same server the `qpilot` CLI runs) in an Electron utility process. It runs on 127.0.0.1 on the first free port from 3847, and the app opens a window on it.
- **Quitting.** Quitting stops the server, which closes any Chrome it launched.
  - On macOS, closing the window keeps the app and a running test alive, and the Dock icon brings it back.
  - On Windows, closing the window quits the app.
- **Settings.** Provider settings are the web UI's **Settings** page; the menu opens it (⌘, on macOS, Ctrl+, on Windows). The server saves them to `~/.qpilot/config.json`, shared with the CLI, and reads that file on every run.
  - On first launch, with no provider yet, the app opens Settings by itself.
  - The app never reads `ANTHROPIC_API_KEY` or `.env.local`.
- **Language.** The menu and dialogs follow the system language (Russian or English).
- **Links.** Links outside the local server open in the default browser.
- **Server log.** The log is at `~/Library/Logs/qpilot/server.log` on macOS and `%APPDATA%\qpilot\logs\server.log` on Windows. The menu item **Show Server Log** opens it.
- **Packaging.** `scripts/after-pack.js` copies the standalone server into each app's `resources/server`, because electron-builder's `extraResources` drops `node_modules`.
  - It drops the modules that are specific to the build machine: `sharp`, which qpilot doesn't use (no `next/image`), and `fsevents`. The rest is plain JS, so one server build serves every platform.
  - On macOS it then ad-hoc signs the bundle.

## Signing

The macOS apps are ad-hoc signed, not notarized, and the Windows installer is unsigned. Distributing them without the first-launch warnings needs:

- **macOS:** an Apple Developer ID. Set `mac.identity` in `package.json`, drop the ad-hoc `codesign` call in `after-pack.js`, and add notarization.
- **Windows:** a code-signing certificate. See electron-builder's `win.signtoolOptions`.
