const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const config = require("./src/config");
const { Pipeline } = require("./src/pipeline");
const { ViewerServer } = require("./src/viewer-server");

let win;
let pipeline;
let viewerServer;
let shutdownStarted = false;
let shutdownComplete = false;

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
  viewerServer = new ViewerServer();
  pipeline.on("viewer", ({ hlsDir, playlist, delayMs }) => {
    viewerServer.serve(hlsDir).then(
      (base) => send("hh:viewer", { url: `${base}/${playlist}`, delayMs }),
      (err) => send("hh:status", `viewer server failed: ${err.message}`),
    );
  });
  pipeline.on("frame", (b64) => send("hh:frame", b64));
  pipeline.on("labels", (labels) => send("hh:labels", labels));
  pipeline.on("transcript", (text) => send("hh:transcript", text));
  pipeline.on("commentary", (c) => send("hh:commentary", c));
  pipeline.on("audio", (audio) => send("hh:audio", audio));
  pipeline.on("status", (msg) => send("hh:status", msg));

  ipcMain.handle("hh:start", () => pipeline.start());
  ipcMain.handle("hh:stop", () => pipeline.stop());
  ipcMain.handle("hh:goal", (_e, goal) => pipeline.setGoal(goal));
  ipcMain.handle("hh:say", (_e, text) => pipeline.userSays(text));
  ipcMain.handle("hh:config", () => ({
    twitchChannel: config.twitchChannel,
    mockIngest: config.mockIngest,
    viewerDelayMs: pipeline.viewerDelayMs,
    sttProvider: config.stt.provider,
    maskyPersonas: config.maskyApiKey
      ? Object.entries(config.maskyAvatars)
        .filter(([, avatar]) => avatar.avatarId && avatar.avatarOwnerUserId)
        .map(([persona]) => persona)
      : [],
  }));
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (shutdownComplete || !pipeline) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  if (viewerServer) viewerServer.close();
  pipeline.stop().finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});
