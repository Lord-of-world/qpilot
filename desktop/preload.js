"use strict";

// Bridge for settings.html only — the main window (the Next.js UI) gets no preload.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qpilot", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (cfg) => ipcRenderer.invoke("settings:save", cfg),
});
