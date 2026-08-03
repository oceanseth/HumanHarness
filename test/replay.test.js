const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { replayFile, replayMoments } = require("../src/replay");

const fixture = path.join(__dirname, "fixtures", "boss-fight.jsonl");

test("replay selects commentary deterministically and collects actions", async () => {
  const result = await replayFile(fixture);
  assert.deepEqual(
    result.moments.map((moment) => moment.momentId),
    ["moment-001", "moment-002", "moment-003"],
  );
  assert.deepEqual(
    result.commentaryDecisions.map((decision) => decision.personaId),
    ["strategist", "strategist"],
  );
  assert.equal(
    result.commentaryDecisions[0].commentary,
    "Dodge left now; punish during the recovery.",
  );
  assert.equal(result.actionRequests[0].actionType, "overlay.warning");
});

test("equal-priority proposals preserve source order", () => {
  const result = replayMoments([
    {
      momentId: "moment-tie",
      occurredAt: "2026-08-03T21:00:00Z",
      kind: "test",
      summary: "A tie.",
      personaProposals: [
        { personaId: "first", commentary: "First", priority: 5 },
        { personaId: "second", commentary: "Second", priority: 5 },
      ],
    },
  ]);
  assert.equal(result.commentaryDecisions[0].personaId, "first");
});

test("invalid JSONL identifies the fixture line", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "humanharness-replay-"));
  const invalidFixture = path.join(directory, "invalid.jsonl");
  const valid = {
    momentId: "moment-valid",
    occurredAt: "2026-08-03T21:00:00Z",
    kind: "test",
    summary: "Valid first line.",
  };
  await fs.writeFile(
    invalidFixture,
    `${JSON.stringify(valid)}\n{"momentId":"missing-fields"}\n`,
    "utf8",
  );
  try {
    await assert.rejects(() => replayFile(invalidFixture), /line 2/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
