const fs = require("fs/promises");
const { createCommentaryDecision, parseMoment } = require("./moments");

class ReplayError extends Error {}

async function loadMoments(filePath) {
  const contents = await fs.readFile(filePath, "utf8");
  const moments = [];
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      moments.push(parseMoment(JSON.parse(line), `moment on line ${index + 1}`));
    } catch (error) {
      throw new ReplayError(`Invalid moment on line ${index + 1} of ${filePath}: ${error.message}`);
    }
  }
  return moments;
}

function chooseCommentary(moment) {
  let winner = null;
  for (const proposal of moment.personaProposals) {
    if (!winner || proposal.priority > winner.priority) winner = proposal;
  }
  return winner ? createCommentaryDecision(moment, winner) : null;
}

function buildReplayResult(moments) {
  const commentaryDecisions = moments.map(chooseCommentary).filter(Boolean);
  const actionRequests = moments.flatMap((moment) => moment.actionRequests);
  return { moments, commentaryDecisions, actionRequests };
}

function replayMoments(inputs) {
  return buildReplayResult(inputs.map((input, index) => parseMoment(input, `moments[${index}]`)));
}

async function replayFile(filePath) {
  return buildReplayResult(await loadMoments(filePath));
}

module.exports = { ReplayError, loadMoments, replayFile, replayMoments };
