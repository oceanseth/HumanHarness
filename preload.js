const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hh", {
  start: () => ipcRenderer.invoke("hh:start"),
  stop: () => ipcRenderer.invoke("hh:stop"),
  setGoal: (goal) => ipcRenderer.invoke("hh:goal", goal),
  say: (text) => ipcRenderer.invoke("hh:say", text),
  getConfig: () => ipcRenderer.invoke("hh:config"),
  onFrame: (cb) => ipcRenderer.on("hh:frame", (_e, b64) => cb(b64)),
  onLabels: (cb) => ipcRenderer.on("hh:labels", (_e, labels) => cb(labels)),
  onTranscript: (cb) => ipcRenderer.on("hh:transcript", (_e, text) => cb(text)),
  onCommentary: (cb) => ipcRenderer.on("hh:commentary", (_e, c) => cb(c)),
  onStatus: (cb) => ipcRenderer.on("hh:status", (_e, msg) => cb(msg)),
});
