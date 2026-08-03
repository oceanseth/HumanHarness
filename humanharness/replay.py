"""Deterministic local replay of recorded HumanHarness moments."""

from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError

from .contracts import ActionRequest, CommentaryDecision, Moment
from .crew.client import GuildClient


class ReplayError(ValueError):
    """A replay fixture could not be decoded into the public contracts."""


class ReplayResult:
    """The outputs produced by replaying a sequence of moments."""

    def __init__(
        self,
        moments: list[Moment],
        commentary_decisions: list[CommentaryDecision],
        action_requests: list[ActionRequest],
    ) -> None:
        self.moments = moments
        self.commentary_decisions = commentary_decisions
        self.action_requests = action_requests


def load_moments(path: str | Path) -> list[Moment]:
    """Load a JSONL fixture, reporting its line number for invalid records."""

    fixture_path = Path(path)
    moments: list[Moment] = []
    for line_number, line in enumerate(fixture_path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            moments.append(Moment.model_validate_json(line))
        except ValidationError as error:
            raise ReplayError(f"Invalid moment on line {line_number} of {fixture_path}: {error}") from error
    return moments


def choose_commentary(moment: Moment) -> CommentaryDecision | None:
    """Apply the mock policy: highest priority proposal wins, then source order."""

    return GuildClient().decide_commentary(moment)


def replay(path: str | Path) -> ReplayResult:
    """Replay recorded moments through mock commentary and action boundaries."""

    moments = load_moments(path)
    decisions = [decision for moment in moments if (decision := choose_commentary(moment)) is not None]
    actions = [action for moment in moments for action in moment.action_requests]
    return ReplayResult(moments=moments, commentary_decisions=decisions, action_requests=actions)
