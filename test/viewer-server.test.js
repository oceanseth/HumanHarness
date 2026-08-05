const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ViewerServer } = require("../src/viewer-server");

async function withServer(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-viewer-test-"));
  fs.writeFileSync(path.join(root, "live.m3u8"), "#EXTM3U\n");
  fs.writeFileSync(path.join(root, "seg-00001.ts"), Buffer.from([0x47]));
  fs.writeFileSync(path.join(os.tmpdir(), "hh-viewer-outside.txt"), "secret");
  const server = new ViewerServer();
  try {
    const base = await server.serve(root);
    await run(base, root);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("ViewerServer serves the playlist with HLS mime, CORS, and no-store", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/live.m3u8`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/vnd.apple.mpegurl");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(await res.text(), "#EXTM3U\n");
  });
});

test("ViewerServer serves segments as cacheable video/mp2t", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/seg-00001.ts`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "video/mp2t");
    assert.equal(res.headers.get("cache-control"), "max-age=60");
  });
});

test("ViewerServer refuses paths outside its root", async () => {
  await withServer(async (base) => {
    for (const url of [
      `${base}/../hh-viewer-outside.txt`,
      `${base}/%2e%2e/hh-viewer-outside.txt`,
      `${base}/..%5chh-viewer-outside.txt`,
    ]) {
      const res = await fetch(url);
      assert.notEqual(res.status, 200, url);
    }
  });
});

test("ViewerServer 404s missing files and rejects non-GET", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/nope.ts`)).status, 404);
    assert.equal((await fetch(`${base}/live.m3u8`, { method: "POST" })).status, 405);
  });
});
