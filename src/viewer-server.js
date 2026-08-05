const http = require("http");
const fs = require("fs");
const path = require("path");

// Loopback static server for the delayed viewer: hls.js in the renderer can't
// XHR file:// URLs, so the rolling HLS window ffmpeg writes to a temp dir is
// served over 127.0.0.1 instead. Serves exactly one directory (the current
// run's HLS dir) and nothing else.
const MIME = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
};

class ViewerServer {
  constructor() {
    this.server = null;
    this.root = null;
  }

  // Point the server at a run's HLS directory, starting it on a random
  // loopback port first if needed. Returns the base URL.
  async serve(root) {
    this.root = path.resolve(root);
    if (!this.server) {
      const server = http.createServer((req, res) => this.handle(req, res));
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      this.server = server;
    }
    return `http://127.0.0.1:${this.server.address().port}`;
  }

  handle(req, res) {
    // The renderer page is file:// (opaque origin), so every request is
    // cross-origin and needs CORS headers to be readable.
    res.setHeader("Access-Control-Allow-Origin", "*");
    const root = this.root;
    if (!root || req.method !== "GET") {
      res.writeHead(root ? 405 : 503);
      res.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const target = path.resolve(root, "." + pathname.replaceAll("/", path.sep));
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const ext = path.extname(target).toLowerCase();
    fs.readFile(target, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        // The playlist mutates every segment; never let the renderer cache it.
        "Cache-Control": ext === ".m3u8" ? "no-store" : "max-age=60",
      });
      res.end(data);
    });
  }

  close() {
    if (this.server) this.server.close();
    this.server = null;
    this.root = null;
  }
}

module.exports = { ViewerServer };
