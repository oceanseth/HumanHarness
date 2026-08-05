#!/usr/bin/env node

const { replayFile } = require("../src/replay");

const usage = "Usage: humanharness replay <fixture.jsonl>";

async function main(argv = process.argv.slice(2), output = console) {
  const [command, fixturePath, ...extra] = argv;
  const helpRequested =
    (argv.length === 1 && (command === "--help" || command === "-h")) ||
    (command === "replay" &&
      extra.length === 0 &&
      (fixturePath === "--help" || fixturePath === "-h"));
  if (helpRequested) {
    output.log(usage);
    return 0;
  }
  if (command !== "replay" || !fixturePath || extra.length) {
    output.error(usage);
    return 1;
  }

  try {
    const result = await replayFile(fixturePath);
    const actionLabel = result.actionRequests.length === 1 ? "action request" : "action requests";
    output.log(
      `Replay completed (${result.moments.length} moments; ` +
        `${result.commentaryDecisions.length} commentary decisions; ` +
        `${result.actionRequests.length} ${actionLabel}).`,
    );
    return 0;
  } catch (error) {
    output.error(error.message);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { main, usage };
