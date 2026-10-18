# qpilot for macOS

A standalone macOS app around qpilot. You install it from a `.dmg`, launch it from Launchpad or the Dock, and need no Node.js, npm or terminal. Google Chrome still has to be installed, because the agent drives it.

## Build

From the repo root, with Node 20.12+:

```bash
npm install
npm --prefix desktop install
npm --prefix desktop run dist
```

The output is `desktop/dist/qpilot-<version>-arm64.dmg`, with the unpacked app in `desktop/dist/mac-arm64/qpilot.app`. `dist` builds the web app first (`npm run build` in the root), then packages it.

To try the shell without packaging, run `npm --prefix desktop start`. It uses `../.next/standalone` directly.

## How it works

- `main.js` starts `.next/standalone/server.js` (the same server the `qpilot` CLI runs) in an Electron utility process. It runs on 127.0.0.1 on the first free port from 3847 and opens a window on it. Quitting the app stops the server, which closes any Chrome it launched. Closing the window keeps the app and a running test alive, and clicking the Dock icon brings the window back.
- The provider config is shared with the CLI in `~/.qpilot/config.json`. On first launch, or via **qpilot → Settings… (⌘,)**, `settings.html` asks for it, and saving restarts the server with the new config. The app never reads `ANTHROPIC_API_KEY` or `.env.local`, because GUI apps don't get a shell environment.
- Links outside the local server open in the default browser.
- The server log is at `~/Library/Logs/qpilot/server.log` (**qpilot → Show server log**).
- `scripts/after-pack.js` copies the standalone server into `Contents/Resources/server`, because electron-builder's `extraResources` drops `node_modules`. It then ad-hoc signs the bundle.

## Signing

The app is ad-hoc signed, not notarized. A copy you built yourself opens normally. A `.dmg` downloaded from elsewhere gets blocked by Gatekeeper the first time. Try to open it once, then go to **System Settings → Privacy & Security → Open Anyway** (macOS 15+ removed the right-click → Open bypass). Or run `xattr -dr com.apple.quarantine /Applications/qpilot.app`. Distributing it properly needs an Apple Developer ID: set `mac.identity` in `package.json` and drop the ad-hoc `codesign` call in `after-pack.js`.

The build targets the host architecture (arm64 here). For Intel, run `npx electron-builder --mac --x64` from `desktop/` on an Intel Mac, because the bundled `sharp` binaries are per-architecture.
