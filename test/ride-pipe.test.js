const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const pipePath = path.join(__dirname, "..", "ride.pipe");

test("ride.pipe defines the MiniMax Scout lookup pipeline", () => {
  const document = JSON.parse(fs.readFileSync(pipePath, "utf8"));
  const pipeline = document.pipeline;

  assert.equal(pipeline.project_id, "humanharness-lookup");
  assert.equal(pipeline.source, "source_1");

  const minimax = pipeline.components.find((component) => component.id === "llm_1");
  assert.equal(minimax.provider, "llm_minimax");
  assert.equal(minimax.config.custom.model, "${ROCKETRIDE_MINIMAX_MODEL}");
  assert.equal(minimax.config.custom.serverbase, "${ROCKETRIDE_MINIMAX_BASE_URL}");
  assert.equal(minimax.config.custom.apikey, "${ROCKETRIDE_MINIMAX_API_KEY}");

  const target = pipeline.components.find((component) => component.id === "target_1");
  assert.equal(target.provider, "response_answers");
});

test("RocketRide loads the checked-in pipeline file", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "actions.js"), "utf8");

  assert.match(source, /filepath: RIDE_PIPE_PATH/);
  assert.doesNotMatch(source, /provider:\s*["']llm_minimax/);
});
