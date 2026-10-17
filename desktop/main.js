"use strict";

// qpilot as a macOS app. The Next.js standalone server (the same one the CLI in
// bin/qa-agent.js starts) runs in an Electron utility process, and a window
// shows its UI. The provider config is shared with the CLI: ~/.qpilot/config.json.

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
  utilityProcess,
} = require("electron");
const { createServer } = require("net");
const { join } = require("path");
const { homedir } = require("os");
const fs = require("fs");

const CONFIG_DIR = join(homedir(), ".qpilot");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"; // keep in sync with lib/provider.ts
const FIRST_PORT = 3847;

const SERVER_PATH = app.isPackaged
  ? join(process.resourcesPath, "server", "server.js")
  : join(__dirname, "..", ".next", "standalone", "server.js");

let server = null; // utilityProcess running server.js
let serverUrl = null;
let mainWindow = null;
let settingsWindow = null;
let quitting = false;

// ── config (same format as bin/qa-agent.js) ─────────────────────────────────

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/** Validates the settings form; returns a clean config or throws with a message. */
function normalizeConfig(input) {
  const s = (v) => (typeof v === "string" ? v.trim() : "");
  const isUrl = (v) => /^https?:\/\//.test(v);
  const provider = input?.provider === "custom" ? "custom" : "anthropic";
  const apiKey = s(input?.apiKey);
  const model = s(input?.model);
  const baseURL = s(input?.baseURL);

  if (!apiKey) throw new Error(provider === "custom" ? "API token is required" : "Anthropic API key is required");
  if (provider === "custom") {
    if (!baseURL) throw new Error("Base URL is required");
    if (!isUrl(baseURL)) throw new Error("Base URL must start with http:// or https://");
    if (!model) throw new Error("Model id is required");
    return { provider, baseURL, apiKey, model };
  }
  if (baseURL && !isUrl(baseURL)) throw new Error("Base URL must start with http:// or https://");
  return {
    provider,
    apiKey,
    model: model || DEFAULT_ANTHROPIC_MODEL,
    ...(baseURL ? { baseURL } : {}),
  };
}

/** config → env vars the server understands (lib/provider.ts). Mirrors configToEnv in the CLI. */
function configToEnv(cfg) {
  if (cfg.provider === "custom") {
    return {
      QPILOT_PROVIDER: "custom",
      QPILOT_BASE_URL: cfg.baseURL,
      QPILOT_API_KEY: cfg.apiKey,
      QPILOT_MODEL: cfg.model,
    };
  }
  return {
    QPILOT_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: cfg.apiKey,
    ...(cfg.model ? { QPILOT_MODEL: cfg.model } : {}),
    ...(cfg.baseURL ? { QPILOT_BASE_URL: cfg.baseURL } : {}),
  };
}

// ── server ──────────────────────────────────────────────────────────────────

function findFreePort(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", () => resolve(findFreePort(port + 1)));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(port)));
  });
}

function logStream() {
  const dir = app.getPath("logs");
  fs.mkdirSync(dir, { recursive: true });
  return fs.createWriteStream(join(dir, "server.log"), { flags: "a" });
}

async function waitForServer(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exited) throw new Error("the server exited during startup");
    try {
      const res = await fetch(`${url}/api/runs`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("the server did not start within 30 seconds");
}

async function startServer(cfg) {
  if (!fs.existsSync(SERVER_PATH)) {
    throw new Error(`Server build not found at ${SERVER_PATH}. Run: npm run build`);
  }
  const port = await findFreePort(FIRST_PORT);
  const log = logStream();
  log.write(`\n── ${new Date().toISOString()} starting on port ${port}\n`);

  // GUI apps get a minimal PATH; keep the system dirs the server spawns from
  // (caffeinate for the wake lock lives in /usr/bin).
  const PATH = [process.env.PATH, "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    .filter(Boolean)
    .join(":");

  const child = utilityProcess.fork(SERVER_PATH, [], {
    cwd: join(SERVER_PATH, ".."),
    env: {
      ...process.env,
      PATH,
      ...configToEnv(cfg),
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    stdio: "pipe",
    serviceName: "qpilot server",
  });
  child.stdout?.on("data", (d) => log.write(d));
  child.stderr?.on("data", (d) => log.write(d));
  child.on("exit", (code) => {
    child.exited = true;
    log.write(`── server exited with code ${code}\n`);
    log.end();
    if (server === child && !quitting) {
      server = null;
      dialog.showErrorBox(
        "qpilot server stopped",
        `The built-in server exited unexpectedly (code ${code}). See the log:\n${join(app.getPath("logs"), "server.log")}`,
      );
    }
  });

  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url, child);
  server = child;
  serverUrl = url;
}

function stopServer() {
  const child = server;
  server = null;
  serverUrl = null;
  if (!child || child.exited) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 3000); // don't hang the app if it ignores the signal
  });
}

async function restartServer(cfg) {
  await stopServer();
  await startServer(cfg);
}

// ── windows ─────────────────────────────────────────────────────────────────

/** Links outside the local server (GitHub, docs) open in the default browser. */
function keepNavigationLocal(win) {
  const isLocal = (url) => serverUrl && url.startsWith(serverUrl);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocal(url)) return { action: "allow" };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isLocal(url)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
}

function openMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    title: "qpilot",
    backgroundColor: "#0b0b0f",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  keepNavigationLocal(mainWindow);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(serverUrl);
}

function openSettings() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 600,
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    title: "qpilot settings",
    backgroundColor: "#0b0b0f",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  settingsWindow.once("ready-to-show", () => settingsWindow?.show());
  settingsWindow.on("closed", () => {
    settingsWindow = null;
    // closed on first launch without saving — nothing to show, so quit
    if (!serverUrl && !quitting) app.quit();
  });
  settingsWindow.loadFile(join(__dirname, "settings.html"));
}

ipcMain.handle("settings:get", () => ({
  config: loadConfig(),
  configPath: CONFIG_PATH,
  defaultModel: DEFAULT_ANTHROPIC_MODEL,
}));

ipcMain.handle("settings:save", async (_e, input) => {
  let cfg;
  try {
    cfg = normalizeConfig(input);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  saveConfig(cfg);
  try {
    await restartServer(cfg);
  } catch (err) {
    return { ok: false, error: `Saved, but the server failed to start: ${err.message}` };
  }
  if (mainWindow) mainWindow.loadURL(serverUrl);
  else openMainWindow();
  settingsWindow?.close();
  return { ok: true };
});

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: openSettings },
        { label: "Show server log", click: () => shell.openPath(join(app.getPath("logs"), "server.log")) },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" }, // Cmd+C / Cmd+V in the test case box need this on macOS
    {
      label: "View",
      submenu: [
        { label: "Home", accelerator: "CmdOrCtrl+Shift+H", click: () => serverUrl && mainWindow?.loadURL(serverUrl) },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── lifecycle ───────────────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else if (serverUrl) {
      openMainWindow();
    } else {
      openSettings();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    const cfg = loadConfig();
    if (!cfg) {
      openSettings();
      return;
    }
    try {
      await startServer(cfg);
      openMainWindow();
    } catch (err) {
      dialog.showErrorBox("qpilot could not start", err.message);
      openSettings();
    }
  });

  // macOS: closing the window keeps the app (and any running test) alive;
  // clicking the Dock icon brings the window back.
  app.on("window-all-closed", () => {});
  app.on("activate", () => {
    if (serverUrl) openMainWindow();
    else if (!settingsWindow) openSettings();
  });

  app.on("before-quit", (e) => {
    if (quitting) return;
    quitting = true;
    if (!server) return;
    // let the server close Chrome before the app exits
    e.preventDefault();
    stopServer().finally(() => app.quit());
  });
}
