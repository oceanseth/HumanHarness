"""Tests for the Guild routing client."""

from __future__ import annotations

import unittest
from datetime import UTC, datetime

from humanharness.contracts import Moment, PersonaProposal
from humanharness.crew.client import GuildClient, GuildClientError


def moment_with_proposals() -> Moment:
    return Moment(
        provenance_id="moment-prov",
        root_event_id="event-root",
        moment_id="moment-1",
        occurred_at=datetime(2026, 8, 3, tzinfo=UTC),
        kind="combat.telegraph",
        summary="Incoming attack.",
        persona_proposals=[
            PersonaProposal(
                provenance_id="low-prov", root_event_id="event-root", persona_id="hype", commentary="Look out!", priority=1
            ),
            PersonaProposal(
                provenance_id="high-prov", root_event_id="event-root", persona_id="strategist", commentary="Dodge left.", priority=10
            ),
        ],
    )


class GuildClientTests(unittest.TestCase):
    def test_mock_policy_selects_the_highest_priority_proposal(self) -> None:
        decision = GuildClient().decide_commentary(moment_with_proposals())

        assert decision is not None
        self.assertEqual(decision.persona_id, "strategist")
        self.assertEqual(decision.commentary, "Dodge left.")

    def test_mock_policy_returns_none_without_a_proposal(self) -> None:
        moment = Moment(
            provenance_id="moment-prov",
            root_event_id="event-root",
            moment_id="moment-1",
            occurred_at=datetime(2026, 8, 3, tzinfo=UTC),
            kind="quiet",
            summary="No commentary needed.",
        )

        self.assertIsNone(GuildClient().decide_commentary(moment))

    def test_json_rpc_mode_serializes_the_moment_and_validates_the_result(self) -> None:
        requests: list[dict[str, object]] = []

        def transport(request: dict[str, object]) -> dict[str, object]:
            requests.append(request)
            return {
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "provenance_id": "decision-prov",
                    "parent_provenance_id": "high-prov",
                    "root_event_id": "event-root",
                    "moment_id": "moment-1",
                    "persona_id": "strategist",
                    "commentary": "Dodge left.",
                    "reason": "remote policy",
                },
            }

        decision = GuildClient(mode="json-rpc", transport=transport).decide_commentary(moment_with_proposals())

        self.assertEqual(decision.reason, "remote policy")
        self.assertEqual(requests[0]["method"], "guild.commentary.decide")
        params = requests[0]["params"]
        assert isinstance(params, dict)
        self.assertEqual(params["moment"]["provenance_id"], "moment-prov")
        self.assertEqual(params["provenance"]["root_event_id"], "event-root")
        self.assertEqual(params["provenance"]["provenance_id"], "moment-prov")

    def test_json_rpc_error_is_reported(self) -> None:
        client = GuildClient(mode="json-rpc", transport=lambda _: {"error": {"code": -1, "message": "unavailable"}})

        with self.assertRaisesRegex(GuildClientError, "unavailable"):
            client.decide_commentary(moment_with_proposals())

    def test_json_rpc_rejects_a_decision_from_another_root_event(self) -> None:
        def transport(_: dict[str, object]) -> dict[str, object]:
            return {
                "result": {
                    "provenance_id": "decision-prov",
                    "parent_provenance_id": "high-prov",
                    "root_event_id": "other-event",
                    "moment_id": "moment-1",
                    "persona_id": "strategist",
                    "commentary": "Dodge left.",
                    "reason": "remote policy",
                }
            }

        with self.assertRaisesRegex(GuildClientError, "root_event_id"):
            GuildClient(mode="json-rpc", transport=transport).decide_commentary(moment_with_proposals())


if __name__ == "__main__":
    unittest.main()
