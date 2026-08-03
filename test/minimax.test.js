const assert = require("node:assert/strict");
const test = require("node:test");
const { parseJsonResponse, stripReasoning } = require("../src/minimax");

test("stripReasoning removes MiniMax thinking blocks", () => {
  assert.equal(stripReasoning("<think>private work</think>\nfinal answer"), "final answer");
});

test("parseJsonResponse accepts fenced MiniMax JSON", () => {
  assert.deepEqual(
    parseJsonResponse('<think>work</think>\n```json\n{"scene":"road","objects":[],"events":[]}\n```'),
    { scene: "road", objects: [], events: [] },
  );
});

test("parseJsonResponse rejects non-JSON output", () => {
  assert.throws(() => parseJsonResponse("nothing structured"), /no JSON object/);
});
