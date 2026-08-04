const assert = require("node:assert/strict");
const test = require("node:test");
const { ContractError, parseMoment } = require("../src/moments");
const { replayMoments } = require("../src/replay");

const basicMoment = () => ({
  momentId: "moment-1",
  occurredAt: "2026-08-03T21:00:00Z",
  kind: "combat.telegraph",
  summary: "Incoming attack.",
});

test("legacy moments receive deterministic provider-neutral provenance", () => {
  const result = replayMoments([
    {
      ...basicMoment(),
      memoryReferences: [
        { memoryId: "memory-1", summary: "A prior attack.", relevance: 0.8 },
      ],
      personaProposals: [
        {
          personaId: "strategist",
          commentary: "Dodge.",
          priority: 1,
          memoryReferences: [
            { memoryId: "memory-2", summary: "A recovery window.", relevance: 0.9 },
          ],
        },
      ],
      actionRequests: [
        {
          actionId: "action-1",
          actionType: "overlay.warning",
          rationale: "Warn the player.",
        },
      ],
    },
  ]);
  const [moment] = result.moments;

  assert.deepEqual(
    {
      provenanceId: moment.provenanceId,
      parentProvenanceId: moment.parentProvenanceId,
      rootEventId: moment.rootEventId,
      sourceActor: moment.sourceActor,
      contextHashes: moment.contextHashes,
    },
    {
      provenanceId: "moment-1",
      parentProvenanceId: null,
      rootEventId: "moment-1",
      sourceActor: "unknown",
      contextHashes: [],
    },
  );
  assert.deepEqual(
    {
      provenanceId: moment.personaProposals[0].provenanceId,
      parentProvenanceId: moment.personaProposals[0].parentProvenanceId,
      rootEventId: moment.personaProposals[0].rootEventId,
      sourceActor: moment.personaProposals[0].sourceActor,
    },
    {
      provenanceId: "moment-1:proposal:0",
      parentProvenanceId: "moment-1",
      rootEventId: "moment-1",
      sourceActor: "unknown",
    },
  );
  assert.equal(moment.memoryReferences[0].parentProvenanceId, "moment-1");
  assert.equal(
    moment.personaProposals[0].memoryReferences[0].parentProvenanceId,
    "moment-1:proposal:0",
  );
  assert.equal(moment.actionRequests[0].parentProvenanceId, "moment-1");
  assert.equal(moment.actionRequests[0].sourceActor, "unknown");
  assert.deepEqual(
    {
      provenanceId: result.commentaryDecisions[0].provenanceId,
      parentProvenanceId: result.commentaryDecisions[0].parentProvenanceId,
      rootEventId: result.commentaryDecisions[0].rootEventId,
      contextHashes: result.commentaryDecisions[0].contextHashes,
    },
    {
      provenanceId: "moment-1:proposal:0:commentary-decision",
      parentProvenanceId: "moment-1:proposal:0",
      rootEventId: "moment-1",
      contextHashes: [],
    },
  );

  const second = parseMoment({ ...basicMoment(), momentId: "moment-2" });
  moment.contextHashes.push("first-only");
  assert.deepEqual(second.contextHashes, []);
});

test("replay decisions preserve explicit provenance and context", () => {
  const result = replayMoments([
    {
      ...basicMoment(),
      provenanceId: "moment-prov",
      rootEventId: "event-root",
      sourceActor: "ingest",
      contextHashes: ["frame-hash"],
      memoryReferences: [
        {
          provenanceId: "memory-prov",
          parentProvenanceId: "moment-prov",
          rootEventId: "event-root",
          contextHashes: ["memory-record-hash"],
          memoryId: "memory-1",
          summary: "The attack has a recovery window.",
          relevance: 0.9,
        },
      ],
      personaProposals: [
        {
          provenanceId: "proposal-prov",
          parentProvenanceId: "moment-prov",
          rootEventId: "event-root",
          sourceActor: "strategist",
          contextHashes: ["memory-hash"],
          personaId: "strategist",
          commentary: "Dodge.",
          priority: 1,
        },
      ],
      actionRequests: [
        {
          provenanceId: "action-prov",
          parentProvenanceId: "moment-prov",
          rootEventId: "event-root",
          sourceActor: "orchestrator",
          contextHashes: ["action-context-hash"],
          actionId: "action-1",
          actionType: "overlay.warning",
          rationale: "Warn the player.",
        },
      ],
    },
  ]);

  assert.equal(result.moments[0].memoryReferences[0].provenanceId, "memory-prov");
  assert.equal(result.moments[0].memoryReferences[0].sourceActor, "ingest");
  assert.equal(result.actionRequests[0].parentProvenanceId, "moment-prov");
  assert.equal(result.actionRequests[0].sourceActor, "orchestrator");
  assert.deepEqual(result.commentaryDecisions[0], {
    provenanceId: "proposal-prov:commentary-decision",
    parentProvenanceId: "proposal-prov",
    rootEventId: "event-root",
    sourceActor: "humanharness",
    contextHashes: ["frame-hash", "memory-hash"],
    momentId: "moment-1",
    personaId: "strategist",
    commentary: "Dodge.",
    reason: "replay selected the highest-priority proposal",
  });
});

test("parseMoment rejects malformed provenance", () => {
  assert.throws(
    () => parseMoment({ ...basicMoment(), provenanceId: "" }),
    (error) =>
      error instanceof ContractError &&
      /provenanceId must be a non-empty string/.test(error.message),
  );
  assert.throws(
    () => parseMoment({ ...basicMoment(), contextHashes: ["valid", 42] }),
    /contextHashes\[1\] must be a non-empty string/,
  );
  assert.throws(
    () => parseMoment({ ...basicMoment(), parent_provenance_id: "parent" }),
    /parent_provenance_id is not allowed/,
  );
});
