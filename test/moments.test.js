const assert = require("node:assert/strict");
const test = require("node:test");
const { ContractError, parseMoment } = require("../src/moments");

const validMoment = () => ({
  momentId: "moment-1",
  occurredAt: "2026-08-03T21:00:00Z",
  kind: "combat.telegraph",
  summary: "A hammer rises.",
});

test("parseMoment fills optional collections with stable defaults", () => {
  const moment = parseMoment(validMoment());
  assert.deepEqual(moment.data, {});
  assert.deepEqual(moment.memoryReferences, []);
  assert.deepEqual(moment.personaProposals, []);
  assert.deepEqual(moment.actionRequests, []);
});

test("parseMoment rejects accidental provider fields", () => {
  assert.throws(
    () => parseMoment({ ...validMoment(), providerResponse: { id: "vendor-1" } }),
    (error) => error instanceof ContractError && /providerResponse is not allowed/.test(error.message),
  );
});

test("parseMoment requires an unambiguous timestamp", () => {
  assert.throws(
    () => parseMoment({ ...validMoment(), occurredAt: "2026-08-03T21:00:00" }),
    /ISO-8601 timestamp with a timezone/,
  );
});

test("parseMoment validates nested relevance and priority", () => {
  assert.throws(
    () =>
      parseMoment({
        ...validMoment(),
        memoryReferences: [{ memoryId: "memory-1", summary: "Past event", relevance: 2 }],
      }),
    /relevance must be a number from 0 to 1/,
  );
  assert.throws(
    () =>
      parseMoment({
        ...validMoment(),
        personaProposals: [{ personaId: "scout", commentary: "Look ahead", priority: -1 }],
      }),
    /priority must be a non-negative integer/,
  );
});
