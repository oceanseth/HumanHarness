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

const provenanceKeys = [
  "provenanceId",
  "parentProvenanceId",
  "rootEventId",
  "sourceActor",
  "contextHashes",
];

const contractKeys = (...keys) => new Set([...provenanceKeys, ...keys]);

const valueOrDefault = (input, key, fallback) =>
  Object.prototype.hasOwnProperty.call(input, key) ? input[key] : fallback;

const parseProvenance = (input, path, defaults = {}) => {
  const provenanceId = valueOrDefault(input, "provenanceId", defaults.provenanceId);
  assertString(provenanceId, `${path}.provenanceId`);

  const parentProvenanceId = valueOrDefault(
    input,
    "parentProvenanceId",
    defaults.parentProvenanceId ?? null,
  );
  if (parentProvenanceId !== null) {
    assertString(parentProvenanceId, `${path}.parentProvenanceId`);
  }

  const rootEventId = valueOrDefault(
    input,
    "rootEventId",
    defaults.rootEventId ?? provenanceId,
  );
  assertString(rootEventId, `${path}.rootEventId`);

  const sourceActor = valueOrDefault(
    input,
    "sourceActor",
    defaults.sourceActor ?? "humanharness",
  );
  assertString(sourceActor, `${path}.sourceActor`);

  const contextHashes = valueOrDefault(input, "contextHashes", defaults.contextHashes ?? []);
  assertArray(contextHashes, `${path}.contextHashes`);
  const parsedContextHashes = contextHashes.map((hash, index) => {
    assertString(hash, `${path}.contextHashes[${index}]`);
    return hash;
  });

  return {
    provenanceId,
    parentProvenanceId,
    rootEventId,
    sourceActor,
    contextHashes: parsedContextHashes,
  };
};

const parseMemoryReference = (input, path = "memoryReference", defaults = {}) => {
  assertObject(input, path);
  assertExactKeys(input, contractKeys("memoryId", "summary", "relevance"), path);
  assertString(input.memoryId, `${path}.memoryId`);
  assertString(input.summary, `${path}.summary`);
  if (!Number.isFinite(input.relevance) || input.relevance < 0 || input.relevance > 1) {
    throw new ContractError(`${path}.relevance must be a number from 0 to 1`);
  }
  return {
    ...parseProvenance(input, path, {
      provenanceId: defaults.provenanceId ?? input.memoryId,
      parentProvenanceId: defaults.parentProvenanceId,
      rootEventId: defaults.rootEventId,
      sourceActor: defaults.sourceActor,
    }),
    memoryId: input.memoryId,
    summary: input.summary,
    relevance: input.relevance,
  };
};

const parsePersonaProposal = (input, path = "personaProposal", defaults = {}) => {
  assertObject(input, path);
  assertExactKeys(
    input,
    contractKeys("personaId", "commentary", "priority", "memoryReferences"),
    path,
  );
  assertString(input.personaId, `${path}.personaId`);
  assertString(input.commentary, `${path}.commentary`);
  const priority = valueOrDefault(input, "priority", 0);
  if (!Number.isInteger(priority) || priority < 0) {
    throw new ContractError(`${path}.priority must be a non-negative integer`);
  }
  const memoryReferences = valueOrDefault(input, "memoryReferences", []);
  assertArray(memoryReferences, `${path}.memoryReferences`);
  const provenance = parseProvenance(input, path, {
    provenanceId: defaults.provenanceId ?? `${input.personaId}:proposal`,
    parentProvenanceId: defaults.parentProvenanceId,
    rootEventId: defaults.rootEventId,
    sourceActor: defaults.sourceActor,
  });
  return {
    ...provenance,
    personaId: input.personaId,
    commentary: input.commentary,
    priority,
    memoryReferences: memoryReferences.map((item, index) =>
      parseMemoryReference(item, `${path}.memoryReferences[${index}]`, {
        provenanceId: `${provenance.provenanceId}:memory:${index}`,
        parentProvenanceId: provenance.provenanceId,
        rootEventId: provenance.rootEventId,
        sourceActor: provenance.sourceActor,
      }),
    ),
  };
};

const parseActionRequest = (input, path = "actionRequest", defaults = {}) => {
  assertObject(input, path);
  assertExactKeys(
    input,
    contractKeys("actionId", "actionType", "parameters", "rationale"),
    path,
  );
  assertString(input.actionId, `${path}.actionId`);
  assertString(input.actionType, `${path}.actionType`);
  assertString(input.rationale, `${path}.rationale`);
  const parameters = valueOrDefault(input, "parameters", {});
  assertObject(parameters, `${path}.parameters`);
  return {
    ...parseProvenance(input, path, {
      provenanceId: defaults.provenanceId ?? input.actionId,
      parentProvenanceId: defaults.parentProvenanceId,
      rootEventId: defaults.rootEventId,
      sourceActor: defaults.sourceActor,
    }),
    actionId: input.actionId,
    actionType: input.actionType,
    parameters,
    rationale: input.rationale,
  };
};

const parseTimestamp = (value, path) => {
  assertString(value, path);
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/,
  );
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] =
    match || [];
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const validOffset =
    offsetHourText === undefined ||
    (Number(offsetHourText) <= 23 && Number(offsetMinuteText) <= 59);
  const validCalendar =
    match &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    validOffset;
  if (!validCalendar || Number.isNaN(Date.parse(value))) {
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
    contractKeys(
      "momentId",
      "occurredAt",
      "kind",
      "summary",
      "data",
      "memoryReferences",
      "personaProposals",
      "actionRequests",
    ),
    path,
  );
  assertString(input.momentId, `${path}.momentId`);
  assertString(input.kind, `${path}.kind`);
  assertString(input.summary, `${path}.summary`);
  const data = valueOrDefault(input, "data", {});
  const memoryReferences = valueOrDefault(input, "memoryReferences", []);
  const personaProposals = valueOrDefault(input, "personaProposals", []);
  const actionRequests = valueOrDefault(input, "actionRequests", []);
  assertObject(data, `${path}.data`);
  assertArray(memoryReferences, `${path}.memoryReferences`);
  assertArray(personaProposals, `${path}.personaProposals`);
  assertArray(actionRequests, `${path}.actionRequests`);
  const provenance = parseProvenance(input, path, { provenanceId: input.momentId });

  return {
    ...provenance,
    momentId: input.momentId,
    occurredAt: parseTimestamp(input.occurredAt, `${path}.occurredAt`),
    kind: input.kind,
    summary: input.summary,
    data,
    memoryReferences: memoryReferences.map((item, index) =>
      parseMemoryReference(item, `${path}.memoryReferences[${index}]`, {
        provenanceId: `${provenance.provenanceId}:memory:${index}`,
        parentProvenanceId: provenance.provenanceId,
        rootEventId: provenance.rootEventId,
        sourceActor: provenance.sourceActor,
      }),
    ),
    personaProposals: personaProposals.map((item, index) =>
      parsePersonaProposal(item, `${path}.personaProposals[${index}]`, {
        provenanceId: `${provenance.provenanceId}:proposal:${index}`,
        parentProvenanceId: provenance.provenanceId,
        rootEventId: provenance.rootEventId,
        sourceActor: provenance.sourceActor,
      }),
    ),
    actionRequests: actionRequests.map((item, index) =>
      parseActionRequest(item, `${path}.actionRequests[${index}]`, {
        provenanceId: `${provenance.provenanceId}:action:${index}`,
        parentProvenanceId: provenance.provenanceId,
        rootEventId: provenance.rootEventId,
        sourceActor: provenance.sourceActor,
      }),
    ),
  };
};

const createCommentaryDecision = (moment, proposal) => ({
  provenanceId: `${proposal.provenanceId}:commentary-decision`,
  parentProvenanceId: proposal.provenanceId,
  rootEventId: moment.rootEventId,
  sourceActor: "humanharness",
  contextHashes: [...moment.contextHashes, ...proposal.contextHashes],
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
