class ContractError extends TypeError {}

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const assertObject = (value, path) => {
  if (!isObject(value)) throw new ContractError(`${path} must be an object`);
};

const assertExactKeys = (value, allowed, path) => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ContractError(`${path}.${key} is not allowed`);
  }
};

const assertString = (value, path) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ContractError(`${path} must be a non-empty string`);
  }
};

const assertArray = (value, path) => {
  if (!Array.isArray(value)) throw new ContractError(`${path} must be an array`);
};

const parseMemoryReference = (input, path) => {
  assertObject(input, path);
  assertExactKeys(input, new Set(["memoryId", "summary", "relevance"]), path);
  assertString(input.memoryId, `${path}.memoryId`);
  assertString(input.summary, `${path}.summary`);
  if (typeof input.relevance !== "number" || input.relevance < 0 || input.relevance > 1) {
    throw new ContractError(`${path}.relevance must be a number from 0 to 1`);
  }
  return { memoryId: input.memoryId, summary: input.summary, relevance: input.relevance };
};

const parsePersonaProposal = (input, path) => {
  assertObject(input, path);
  assertExactKeys(
    input,
    new Set(["personaId", "commentary", "priority", "memoryReferences"]),
    path,
  );
  assertString(input.personaId, `${path}.personaId`);
  assertString(input.commentary, `${path}.commentary`);
  const priority = input.priority ?? 0;
  if (!Number.isInteger(priority) || priority < 0) {
    throw new ContractError(`${path}.priority must be a non-negative integer`);
  }
  const memoryReferences = input.memoryReferences ?? [];
  assertArray(memoryReferences, `${path}.memoryReferences`);
  return {
    personaId: input.personaId,
    commentary: input.commentary,
    priority,
    memoryReferences: memoryReferences.map((item, index) =>
      parseMemoryReference(item, `${path}.memoryReferences[${index}]`),
    ),
  };
};

const parseActionRequest = (input, path) => {
  assertObject(input, path);
  assertExactKeys(
    input,
    new Set(["actionId", "actionType", "parameters", "rationale"]),
    path,
  );
  assertString(input.actionId, `${path}.actionId`);
  assertString(input.actionType, `${path}.actionType`);
  assertString(input.rationale, `${path}.rationale`);
  const parameters = input.parameters ?? {};
  assertObject(parameters, `${path}.parameters`);
  return {
    actionId: input.actionId,
    actionType: input.actionType,
    parameters,
    rationale: input.rationale,
  };
};

const parseTimestamp = (value, path) => {
  assertString(value, path);
  const hasTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
    value,
  );
  if (!hasTimezone || Number.isNaN(Date.parse(value))) {
    throw new ContractError(`${path} must be an ISO-8601 timestamp with a timezone`);
  }
  return value;
};

// A provider-neutral moment exchanged by ingest, replay, memory, action, and
// persona boundaries. Runtime validation keeps recorded fixtures honest while
// leaving vendor payloads inside the explicit `data` field.
const parseMoment = (input, path = "moment") => {
  assertObject(input, path);
  assertExactKeys(
    input,
    new Set([
      "momentId",
      "occurredAt",
      "kind",
      "summary",
      "data",
      "memoryReferences",
      "personaProposals",
      "actionRequests",
    ]),
    path,
  );
  assertString(input.momentId, `${path}.momentId`);
  assertString(input.kind, `${path}.kind`);
  assertString(input.summary, `${path}.summary`);
  const data = input.data ?? {};
  const memoryReferences = input.memoryReferences ?? [];
  const personaProposals = input.personaProposals ?? [];
  const actionRequests = input.actionRequests ?? [];
  assertObject(data, `${path}.data`);
  assertArray(memoryReferences, `${path}.memoryReferences`);
  assertArray(personaProposals, `${path}.personaProposals`);
  assertArray(actionRequests, `${path}.actionRequests`);

  return {
    momentId: input.momentId,
    occurredAt: parseTimestamp(input.occurredAt, `${path}.occurredAt`),
    kind: input.kind,
    summary: input.summary,
    data,
    memoryReferences: memoryReferences.map((item, index) =>
      parseMemoryReference(item, `${path}.memoryReferences[${index}]`),
    ),
    personaProposals: personaProposals.map((item, index) =>
      parsePersonaProposal(item, `${path}.personaProposals[${index}]`),
    ),
    actionRequests: actionRequests.map((item, index) =>
      parseActionRequest(item, `${path}.actionRequests[${index}]`),
    ),
  };
};

const createCommentaryDecision = (moment, proposal) => ({
  momentId: moment.momentId,
  personaId: proposal.personaId,
  commentary: proposal.commentary,
  reason: "replay selected the highest-priority proposal",
});

module.exports = {
  ContractError,
  createCommentaryDecision,
  parseActionRequest,
  parseMemoryReference,
  parseMoment,
  parsePersonaProposal,
};
