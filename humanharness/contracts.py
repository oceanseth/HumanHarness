"""Vendor-neutral contracts exchanged by HumanHarness pipeline stages."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Contract(BaseModel):
    """Base contract that rejects provider-specific, accidental fields."""

    model_config = ConfigDict(extra="forbid")


class MemoryReference(Contract):
    """A relevant, portable reference to prior session knowledge."""

    memory_id: str
    summary: str
    relevance: float = Field(ge=0, le=1)


class PersonaProposal(Contract):
    """A persona's candidate response to a moment."""

    persona_id: str
    commentary: str
    priority: int = Field(default=0, ge=0)
    memory_references: list[MemoryReference] = Field(default_factory=list)


class ActionRequest(Contract):
    """A requested operation for an action adapter to perform."""

    action_id: str
    action_type: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    rationale: str


class Moment(Contract):
    """A single observed instant, independent of its ingest provider."""

    moment_id: str
    occurred_at: datetime
    kind: str
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)
    memory_references: list[MemoryReference] = Field(default_factory=list)
    persona_proposals: list[PersonaProposal] = Field(default_factory=list)
    action_requests: list[ActionRequest] = Field(default_factory=list)


class CommentaryDecision(Contract):
    """The proposal selected for delivery for a specific moment."""

    moment_id: str
    persona_id: str
    commentary: str
    reason: str
