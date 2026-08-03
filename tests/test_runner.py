"""Tests for bootstrap runtime configuration routing."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from humanharness.config import Settings
from humanharness.runner import run


class RunnerTests(unittest.TestCase):
    @patch("humanharness.runner.GuildClient")
    def test_guild_api_key_enables_json_rpc_mode(self, guild_client: object) -> None:
        with patch.dict(os.environ, {"GUILD_API_KEY": "guild-secret"}):
            run(Settings())

        guild_client.assert_called_once_with(
            mode="json-rpc",
            api_key="guild-secret",
            endpoint=None,
        )

    @patch("humanharness.runner.GuildClient")
    def test_guild_endpoint_enables_json_rpc_mode(self, guild_client: object) -> None:
        with patch.dict(os.environ, {"GUILD_ENDPOINT": "https://guild.example/rpc"}):
            run(Settings())

        guild_client.assert_called_once_with(
            mode="json-rpc",
            api_key=None,
            endpoint="https://guild.example/rpc",
        )

    @patch("humanharness.runner.GuildClient")
    def test_no_guild_configuration_uses_mock_mode(self, guild_client: object) -> None:
        with patch.dict(os.environ, {"GUILD_API_KEY": "", "GUILD_ENDPOINT": ""}):
            run(Settings())

        guild_client.assert_called_once_with(mode="mock")


if __name__ == "__main__":
    unittest.main()
