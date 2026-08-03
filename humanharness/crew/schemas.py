"""Provider-neutral Guild turn contracts shared with the TypeScript runtime.

The wire representation deliberately retains snake_case provenance keys.  This
keeps the lineage contract stable across the Python orchestration boundary and
the Electron/TypeScript consumer without requiring a lossy key conversion.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from hashlib import sha256
from typing import Any, Mapping
from uuid import UUID, uuid4


class SchemaValidationError(ValueError):
    """Raised when a Guild contract is incomplete or malformed."""


def _validate_identifier(name: str, value: str | None, *, required: bool) -> None:
    if value is None:
        if required:
            raise SchemaValidationError(f"{name} is required")
        return
    try:
        UUID(value)
    except (TypeError, ValueError) as exc:
        raise SchemaValidationError(f"{name} must be a UUID") from exc


@dataclass(frozen=True)
class ProvenanceHeaders:
    """The four provenance pillars carried by every Guild boundary crossing.

    ``provenance_id`` identifies this turn, ``parent_provenance_id`` records
    its immediate causal parent (or ``None`` for a root turn),
    ``context_hashes`` binds every supplied context item to its digest, and
    ``schema_version`` identifies the contract used to interpret the record.
    """

    provenance_id: str
    parent_provenance_id: str | None
    context_hashes: Mapping[str, str]
    schema_version: str = "guild-turn/v1"

    def __post_init__(self) -> None:
        _validate_identifier("provenance_id", self.provenance_id, required=True)
        _validate_identifier("parent_provenance_id", self.parent_provenance_id, required=False)
        if not self.schema_version:
            raise SchemaValidationError("schema_version is required")
        for context_id, digest in self.context_hashes.items():
            if not context_id or not isinstance(digest, str) or len(digest) != 64:
                raise SchemaValidationError("context_hashes must contain named SHA-256 digests")
            try:
                int(digest, 16)
            except ValueError as exc:
                raise SchemaValidationError("context_hashes must contain named SHA-256 digests") from exc

    @classmethod
    def root(cls, context: Mapping[str, str] | None = None) -> "ProvenanceHeaders":
        """Create the mandatory provenance header set for an initial turn."""

        return cls(
            provenance_id=str(uuid4()),
            parent_provenance_id=None,
            context_hashes={key: sha256(value.encode("utf-8")).hexdigest() for key, value in (context or {}).items()},
        )

    def child(self, context: Mapping[str, str] | None = None) -> "ProvenanceHeaders":
        """Create a causally linked header set for a downstream turn."""

        return type(self).root(context)._with_parent(self.provenance_id)

    def _with_parent(self, parent_provenance_id: str) -> "ProvenanceHeaders":
        return type(self)(
            provenance_id=self.provenance_id,
            parent_provenance_id=parent_provenance_id,
            context_hashes=self.context_hashes,
            schema_version=self.schema_version,
        )


@dataclass(frozen=True)
class GuildTurn:
    """A persona-to-persona or human-to-persona message."""

    sender: str
    recipient: str
    body: str
    occurred_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def __post_init__(self) -> None:
        if not self.sender or not self.recipient or not self.body:
            raise SchemaValidationError("sender, recipient, and body are required")


@dataclass(frozen=True)
class GuildTurnRequest:
    turn: GuildTurn
    provenance: ProvenanceHeaders

    def to_wire(self) -> dict[str, Any]:
        return {"turn": asdict(self.turn), "provenance": asdict(self.provenance)}


@dataclass(frozen=True)
class GuildTurnResponse:
    turn: GuildTurn
    provenance: ProvenanceHeaders

    @classmethod
    def from_wire(cls, payload: Mapping[str, Any]) -> "GuildTurnResponse":
        try:
            turn = GuildTurn(**payload["turn"])
            provenance = ProvenanceHeaders(**payload["provenance"])
        except (KeyError, TypeError) as exc:
            raise SchemaValidationError("Guild response must include turn and provenance") from exc
        return cls(turn=turn, provenance=provenance)
