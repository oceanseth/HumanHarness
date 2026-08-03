"""Command-line interface for HumanHarness."""

from __future__ import annotations

import argparse
from collections.abc import Sequence

from .config import load_settings
from .runner import run, run_mock_replay


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="humanharness", description="HumanHarness live-feed companion")
    subcommands = parser.add_subparsers(dest="command", required=True)
    run_parser = subcommands.add_parser("run", help="start the HumanHarness bootstrap slice")
    run_parser.add_argument("--channel", help="Twitch channel; overrides TWITCH_CHANNEL")
    run_parser.add_argument("--env-file", default=".env", help="configuration file (default: .env)")
    run_parser.add_argument("--mock", metavar="FIXTURE", help="replay JSONL moments without external services")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "run":
        if args.mock:
            print(run_mock_replay(args.mock))
            return 0
        settings = load_settings(args.env_file)
        if args.channel:
            settings = settings.model_copy(update={"twitch_channel": args.channel})
        print(run(settings))
        return 0
    return 1
