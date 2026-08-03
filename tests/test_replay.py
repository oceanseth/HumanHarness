"""Tests for deterministic mock event replay."""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from humanharness.replay import ReplayError, load_moments, replay


FIXTURE = Path(__file__).parent / "fixtures" / "boss-fight.jsonl"


class ReplayTests(unittest.TestCase):
    def test_replay_selects_highest_priority_commentary_and_collects_actions(self) -> None:
        result = replay(FIXTURE)

        self.assertEqual([moment.moment_id for moment in result.moments], ["moment-001", "moment-002", "moment-003"])
        self.assertEqual(
            [decision.persona_id for decision in result.commentary_decisions], ["strategist", "strategist"]
        )
        self.assertEqual(result.commentary_decisions[0].commentary, "Dodge left now; punish during the recovery.")
        self.assertEqual(result.action_requests[0].action_type, "overlay.warning")

    def test_invalid_record_identifies_fixture_line(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "invalid.jsonl"
            fixture.write_text('{"moment_id":"missing-fields"}\n', encoding="utf-8")

            with self.assertRaisesRegex(ReplayError, "line 1"):
                load_moments(fixture)


if __name__ == "__main__":
    unittest.main()
