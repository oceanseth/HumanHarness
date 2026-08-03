"""Tests for the module command-line entry point."""

from __future__ import annotations

import contextlib
import io
from pathlib import Path
import unittest

from humanharness.cli import main


class CliTests(unittest.TestCase):
    def test_run_uses_channel_argument(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = main(["run", "--channel", "demo_channel", "--env-file", "missing.env"])

        self.assertEqual(result, 0)
        self.assertIn("channel: demo_channel", output.getvalue())

    def test_run_mock_replays_fixture_without_settings(self) -> None:
        fixture = Path(__file__).parent / "fixtures" / "boss-fight.jsonl"
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = main(["run", "--mock", str(fixture)])

        self.assertEqual(result, 0)
        self.assertIn("3 moments; 2 commentary decisions; 1 action requests", output.getvalue())


if __name__ == "__main__":
    unittest.main()
