const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "bin", "humanharness.js");
const fixture = path.join(root, "test", "fixtures", "boss-fight.jsonl");

test("replay CLI runs the fixture without external services", () => {
  const run = spawnSync(process.execPath, [cli, "replay", fixture], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /3 moments; 2 commentary decisions; 1 action request/);
});

test("replay CLI rejects incomplete arguments", () => {
  const run = spawnSync(process.execPath, [cli, "replay"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Usage: humanharness replay/);
});

for (const args of [["--help"], ["-h"], ["replay", "--help"], ["replay", "-h"]]) {
  test(`replay CLI shows help for ${args.join(" ")}`, () => {
    const run = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Usage: humanharness replay <fixture\.jsonl>/);
    assert.equal(run.stderr, "");
  });
}
