"""Tests for portable contract provenance."""

from __future__ import annotations

import unittest
from datetime import UTC, datetime

from humanharness.contracts import Moment, PersonaProposal
from humanharness.crew.client import GuildClient


class ProvenanceTests(unittest.TestCase):
    def test_mock_decision_preserves_the_provenance_chain(self) -> None:
        moment = Moment(
            provenance_id="moment-prov",
            root_event_id="event-root",
            context_hashes=["frame-hash"],
            moment_id="moment-1",
            occurred_at=datetime(2026, 8, 3, tzinfo=UTC),
            kind="combat.telegraph",
            summary="Incoming attack.",
            persona_proposals=[
                PersonaProposal(
                    provenance_id="proposal-prov",
                    parent_provenance_id="moment-prov",
                    root_event_id="event-root",
                    context_hashes=["memory-hash"],
                    persona_id="strategist",
                    commentary="Dodge.",
                    priority=1,
                )
            ],
        )

        decision = GuildClient().decide_commentary(moment)

        assert decision is not None
        self.assertEqual(decision.parent_provenance_id, "proposal-prov")
        self.assertEqual(decision.root_event_id, "event-root")
        self.assertEqual(decision.context_hashes, ["frame-hash", "memory-hash"])
        self.assertEqual(decision.source_actor, "humanharness")

    def test_context_hash_defaults_are_not_shared(self) -> None:
        first = PersonaProposal(
            provenance_id="proposal-1", root_event_id="event-1", persona_id="one", commentary="one"
        )
        second = PersonaProposal(
            provenance_id="proposal-2", root_event_id="event-2", persona_id="two", commentary="two"
        )

        first.context_hashes.append("context")

        self.assertEqual(second.context_hashes, [])


if __name__ == "__main__":
    unittest.main()
