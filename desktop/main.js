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

// ── strings ─────────────────────────────────────────────────────────────────
// Electron's built-in role labels are English-only, so the menu sets its own
// labels in the macOS system language. Same ru/en split as lib/i18n.ts.

const STRINGS = {
  en: {
    about: "About qpilot",
    settings: "Settings…",
    showLog: "Show Server Log",
    services: "Services",
    hide: "Hide qpilot",
    hideOthers: "Hide Others",
    unhide: "Show All",
    quit: "Quit qpilot",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    pasteAndMatchStyle: "Paste and Match Style",
    delete: "Delete",
    selectAll: "Select All",
    view: "View",
    home: "Home",
    reload: "Reload",
    devTools: "Developer Tools",
    resetZoom: "Actual Size",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
    fullScreen: "Toggle Full Screen",
    window: "Window",
    minimize: "Minimize",
    zoom: "Zoom",
    front: "Bring All to Front",
    serverStoppedTitle: "qpilot server stopped",
    serverStopped: (code, log) => `The built-in server exited unexpectedly (code ${code}). See the log:\n${log}`,
    startFailedTitle: "qpilot could not start",
    noBuild: (path) => `Server build not found at ${path}. Run: npm run build`,
    exitedDuringStartup: "the server exited during startup",
    startTimeout: "the server did not start within 30 seconds",
    savedButFailed: (msg) => `Saved, but the server failed to start: ${msg}`,
    tokenRequired: "API token is required",
    keyRequired: "Anthropic API key is required",
    baseUrlRequired: "Base URL is required",
    baseUrlInvalid: "Base URL must start with http:// or https://",
    modelRequired: "Model id is required",
  },
  ru: {
    about: "О программе qpilot",
    settings: "Настройки…",
    showLog: "Показать журнал сервера",
    services: "Службы",
    hide: "Скрыть qpilot",
    hideOthers: "Скрыть остальные",
    unhide: "Показать все",
    quit: "Завершить qpilot",
    edit: "Правка",
    undo: "Отменить",
    redo: "Повторить",
    cut: "Вырезать",
    copy: "Скопировать",
    paste: "Вставить",
    pasteAndMatchStyle: "Вставить и согласовать стиль",
    delete: "Удалить",
    selectAll: "Выбрать все",
    view: "Вид",
    home: "На главную",
    reload: "Перезагрузить",
    devTools: "Инструменты разработчика",
    resetZoom: "Фактический размер",
    zoomIn: "Увеличить",
    zoomOut: "Уменьшить",
    fullScreen: "Полноэкранный режим",
    window: "Окно",
    minimize: "Свернуть",
    zoom: "Изменить масштаб",
    front: "Все окна — на передний план",
    serverStoppedTitle: "Сервер qpilot остановился",
    serverStopped: (code, log) => `Встроенный сервер неожиданно завершился (код ${code}). Подробности в журнале:\n${log}`,
    startFailedTitle: "Не удалось запустить qpilot",
    noBuild: (path) => `Сборка сервера не найдена: ${path}. Выполните: npm run build`,
    exitedDuringStartup: "сервер завершился во время запуска",
    startTimeout: "сервер не запустился за 30 секунд",
    savedButFailed: (msg) => `Настройки сохранены, но сервер не запустился: ${msg}`,
    tokenRequired: "Укажите API-токен",
    keyRequired: "Укажите API-ключ Anthropic",
    baseUrlRequired: "Укажите Base URL",
    baseUrlInvalid: "Base URL должен начинаться с http:// или https://",
    modelRequired: "Укажите ID модели",
  },
};

// set in whenReady — the system language is only known once the app is ready
let L = STRINGS.en;

function systemStrings() {
  const lang = (app.getPreferredSystemLanguages()[0] || app.getLocale() || "").toLowerCase();
  return lang.startsWith("ru") ? STRINGS.ru : STRINGS.en;
}

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

  if (!apiKey) throw new Error(provider === "custom" ? L.tokenRequired : L.keyRequired);
  if (provider === "custom") {
    if (!baseURL) throw new Error(L.baseUrlRequired);
    if (!isUrl(baseURL)) throw new Error(L.baseUrlInvalid);
    if (!model) throw new Error(L.modelRequired);
    return { provider, baseURL, apiKey, model };
  }
  if (baseURL && !isUrl(baseURL)) throw new Error(L.baseUrlInvalid);
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
    if (child.exited) throw new Error(L.exitedDuringStartup);
    try {
      const res = await fetch(`${url}/api/runs`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(L.startTimeout);
}

async function startServer(cfg) {
  if (!fs.existsSync(SERVER_PATH)) {
    throw new Error(L.noBuild(SERVER_PATH));
  }
  const port = await findFreePort(FIRST_PORT);
  const log = logStream();
  log.write(`\n── ${new Date().toISOString()} starting on port ${port}\n`);

  // GUI apps get a minimal PATH; keep the system dirs the server spawns from
  // (caffeinate for the wake lock lives in /usr/bin) plus Homebrew's.
  const PATH = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
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
        L.serverStoppedTitle,
        L.serverStopped(code, join(app.getPath("logs"), "server.log")),
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
    return { ok: false, error: L.savedButFailed(err.message) };
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
        { role: "about", label: L.about },
        { type: "separator" },
        { label: L.settings, accelerator: "CmdOrCtrl+,", click: openSettings },
        { label: L.showLog, click: () => shell.openPath(join(app.getPath("logs"), "server.log")) },
        { type: "separator" },
        { role: "services", label: L.services },
        { type: "separator" },
        { role: "hide", label: L.hide },
        { role: "hideOthers", label: L.hideOthers },
        { role: "unhide", label: L.unhide },
        { type: "separator" },
        { role: "quit", label: L.quit },
      ],
    },
    {
      // Cmd+C / Cmd+V in the test case box need this menu on macOS
      label: L.edit,
      submenu: [
        { role: "undo", label: L.undo },
        { role: "redo", label: L.redo },
        { type: "separator" },
        { role: "cut", label: L.cut },
        { role: "copy", label: L.copy },
        { role: "paste", label: L.paste },
        { role: "pasteAndMatchStyle", label: L.pasteAndMatchStyle },
        { role: "delete", label: L.delete },
        { role: "selectAll", label: L.selectAll },
      ],
    },
    {
      label: L.view,
      submenu: [
        { label: L.home, accelerator: "CmdOrCtrl+Shift+H", click: () => serverUrl && mainWindow?.loadURL(serverUrl) },
        { role: "reload", label: L.reload },
        { role: "toggleDevTools", label: L.devTools },
        { type: "separator" },
        { role: "resetZoom", label: L.resetZoom },
        { role: "zoomIn", label: L.zoomIn },
        { role: "zoomOut", label: L.zoomOut },
        { type: "separator" },
        { role: "togglefullscreen", label: L.fullScreen },
      ],
    },
    {
      // role "window" lets macOS add the open-windows list and tiling items
      label: L.window,
      role: "window",
      submenu: [
        { role: "minimize", label: L.minimize },
        { role: "zoom", label: L.zoom },
        { type: "separator" },
        { role: "front", label: L.front },
      ],
    },
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
    L = systemStrings();
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
      dialog.showErrorBox(L.startFailedTitle, err.message);
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
