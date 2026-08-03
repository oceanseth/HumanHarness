"""Typed application configuration loaded from environment variables."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration for the HumanHarness vertical slice.

    Values are loaded from process environment variables first, then from the
    supplied ``.env`` file. Secrets deliberately have no production defaults.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    twitch_channel: str | None = None
    laserdata_api_key: str | None = None
    laserdata_stream: str = "humanharness-live"
    falkordb_url: str = "redis://localhost:6379"
    falkordb_graph: str = "humanharness"
    rocketride_api_key: str | None = None
    guild_api_key: str | None = None
    guild_endpoint: str | None = None
    masky_api_key: str | None = None
    stt_provider: Literal["whisper", "deepgram", "none"] = "none"
    openai_api_key: str | None = None
    deepgram_api_key: str | None = None
    frame_interval_ms: int = Field(default=500, gt=0)


def load_settings(env_file: str | Path = ".env") -> Settings:
    """Load settings from an env file, with environment variables taking precedence."""

    return Settings(_env_file=env_file)
