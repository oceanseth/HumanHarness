"""Tests for typed environment configuration."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from humanharness.config import load_settings


class SettingsTests(unittest.TestCase):
    def test_loads_and_types_values_from_env_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text("TWITCH_CHANNEL=demo\nFRAME_INTERVAL_MS=250\nSTT_PROVIDER=deepgram\n")
            settings = load_settings(env_file)

        self.assertEqual(settings.twitch_channel, "demo")
        self.assertEqual(settings.frame_interval_ms, 250)
        self.assertEqual(settings.stt_provider, "deepgram")

    def test_rejects_invalid_frame_interval(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text("FRAME_INTERVAL_MS=0\n")
            with self.assertRaises(ValidationError):
                load_settings(env_file)


if __name__ == "__main__":
    unittest.main()
