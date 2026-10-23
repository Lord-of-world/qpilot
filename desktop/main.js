"use strict";

// qpilot as a desktop app for macOS and Windows. The Next.js standalone server
// (the same one the CLI in bin/qa-agent.js starts) runs in an Electron utility
// process, and a window shows its UI. Provider settings live in the web UI (/settings), which the
// server saves to ~/.qpilot/config.json — the same file the CLI uses.

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  nativeTheme,
  shell,
  utilityProcess,
} = require("electron");
const { createServer } = require("net");
const { join } = require("path");
const fs = require("fs");

const FIRST_PORT = 3847;
const IS_MAC = process.platform === "darwin";

const SERVER_PATH = app.isPackaged
  ? join(process.resourcesPath, "server", "server.js")
  : join(__dirname, "..", ".next", "standalone", "server.js");

let server = null; // utilityProcess running server.js
let serverUrl = null;
let mainWindow = null;
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
    file: "File",
    exit: "Exit",
    help: "Help",
    close: "Close",
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
    file: "Файл",
    exit: "Выход",
    help: "Справка",
    close: "Закрыть",
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
  },
};

// set in whenReady — the system language is only known once the app is ready
let L = STRINGS.en;

function systemStrings() {
  const lang = (app.getPreferredSystemLanguages()[0] || app.getLocale() || "").toLowerCase();
  return lang.startsWith("ru") ? STRINGS.ru : STRINGS.en;
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

async function startServer() {
  if (!fs.existsSync(SERVER_PATH)) {
    throw new Error(L.noBuild(SERVER_PATH));
  }
  const port = await findFreePort(FIRST_PORT);
  const log = logStream();
  log.write(`\n── ${new Date().toISOString()} starting on port ${port}\n`);

  // macOS GUI apps get a minimal PATH; keep the system dirs the server spawns
  // from (caffeinate for the wake lock lives in /usr/bin) plus Homebrew, where
  // git for connected test case repos often comes from. Windows apps inherit
  // the user's full PATH (Git for Windows adds itself there).
  const PATH = IS_MAC
    ? [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        .filter(Boolean)
        .join(":")
    : process.env.PATH;

  const child = utilityProcess.fork(SERVER_PATH, [], {
    cwd: join(SERVER_PATH, ".."),
    env: {
      ...process.env,
      PATH,
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

function openMainWindow(path = "/") {
  if (mainWindow) {
    if (path !== "/") mainWindow.loadURL(serverUrl + path);
    mainWindow.show();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    title: "qpilot",
    // matches the page background of the system theme, so there's no flash
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1b1b21" : "#fafafb",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  keepNavigationLocal(mainWindow);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(serverUrl + path);
}

function buildMenu() {
  const openSettings = () => serverUrl && openMainWindow("/settings");
  const showLog = () => shell.openPath(join(app.getPath("logs"), "server.log"));
  // Windows: the usual File / Edit / View / Window / Help menu bar
  const appMenu = IS_MAC ? null : {
    label: L.file,
    submenu: [
      { label: L.settings, accelerator: "Ctrl+,", click: openSettings },
      { label: L.showLog, click: showLog },
      { type: "separator" },
      { role: "quit", label: L.exit },
    ],
  };
  const template = [
    appMenu ?? {
      label: app.name,
      submenu: [
        { role: "about", label: L.about },
        { type: "separator" },
        { label: L.settings, accelerator: "CmdOrCtrl+,", click: openSettings },
        { label: L.showLog, click: showLog },
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
        ...(IS_MAC ? [{ role: "pasteAndMatchStyle", label: L.pasteAndMatchStyle }] : []),
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
    IS_MAC
      ? {
          // role "window" lets macOS add the open-windows list and tiling items
          label: L.window,
          role: "window",
          submenu: [
            { role: "minimize", label: L.minimize },
            { role: "zoom", label: L.zoom },
            { type: "separator" },
            { role: "front", label: L.front },
          ],
        }
      : {
          label: L.window,
          submenu: [
            { role: "minimize", label: L.minimize },
            { role: "close", label: L.close },
          ],
        },
    ...(IS_MAC ? [] : [{ label: L.help, submenu: [{ role: "about", label: L.about }] }]),
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
    }
  });

  app.whenReady().then(async () => {
    L = systemStrings();
    buildMenu();
    try {
      // no provider yet? the home page sends the user to Settings itself
      await startServer();
      openMainWindow();
    } catch (err) {
      dialog.showErrorBox(L.startFailedTitle, err.message);
      app.quit();
    }
  });

  // macOS: closing the window keeps the app (and any running test) alive;
  // clicking the Dock icon brings the window back. Windows has no such
  // convention (nothing in the taskbar to click), so closing the window quits.
  app.on("window-all-closed", () => {
    if (!IS_MAC) app.quit();
  });
  app.on("activate", () => {
    if (serverUrl) openMainWindow();
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
