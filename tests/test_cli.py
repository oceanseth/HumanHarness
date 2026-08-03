"""Tests for the module command-line entry point."""

from __future__ import annotations

import contextlib
import io
import unittest

from humanharness.cli import main


class CliTests(unittest.TestCase):
    def test_run_uses_channel_argument(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = main(["run", "--channel", "demo_channel", "--env-file", "missing.env"])

        self.assertEqual(result, 0)
        self.assertIn("channel: demo_channel", output.getvalue())


if __name__ == "__main__":
    unittest.main()
