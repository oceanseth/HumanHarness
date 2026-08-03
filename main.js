const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const config = require("./src/config");
const { Pipeline } = require("./src/pipeline");

let win;
let pipeline;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: "HumanHarness",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

app.whenReady().then(() => {
  createWindow();

  pipeline = new Pipeline(config);
  pipeline.on("frame", (b64) => send("hh:frame", b64));
  pipeline.on("labels", (labels) => send("hh:labels", labels));
  pipeline.on("transcript", (text) => send("hh:transcript", text));
  pipeline.on("commentary", (c) => send("hh:commentary", c));
  pipeline.on("status", (msg) => send("hh:status", msg));

  ipcMain.handle("hh:start", () => pipeline.start());
  ipcMain.handle("hh:stop", () => pipeline.stop());
  ipcMain.handle("hh:goal", (_e, goal) => pipeline.setGoal(goal));
  ipcMain.handle("hh:say", (_e, text) => pipeline.userSays(text));
  ipcMain.handle("hh:config", () => ({
    twitchChannel: config.twitchChannel,
    mockIngest: config.mockIngest,
    sttProvider: config.stt.provider,
    maskyVoices: Boolean(config.maskyApiKey),
  }));
});

app.on("window-all-closed", () => {
  if (pipeline) pipeline.stop();
  app.quit();
});
