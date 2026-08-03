"""Bootstrap runtime for the HumanHarness service."""

from __future__ import annotations

from .config import Settings
from .replay import replay


def run(settings: Settings) -> str:
    """Start the bootstrap slice and return a concise status message.

    Future ingest, memory, and crew workers attach here. Keeping this boundary
    small gives the CLI a working end-to-end entry point today.
    """

    channel = settings.twitch_channel or "not configured"
    return (
        "HumanHarness bootstrap started "
        f"(channel: {channel}; frame interval: {settings.frame_interval_ms} ms)."
    )


def run_mock_replay(fixture_path: str) -> str:
    """Run the local deterministic replay mode and report its output counts."""

    result = replay(fixture_path)
    return (
        "Mock replay completed "
        f"({len(result.moments)} moments; {len(result.commentary_decisions)} commentary decisions; "
        f"{len(result.action_requests)} action requests)."
    )
