"""Command-line interface for HumanHarness."""

from __future__ import annotations

import argparse
from collections.abc import Sequence

from .config import load_settings
from .runner import run


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="humanharness", description="HumanHarness live-feed companion")
    subcommands = parser.add_subparsers(dest="command", required=True)
    run_parser = subcommands.add_parser("run", help="start the HumanHarness bootstrap slice")
    run_parser.add_argument("--channel", help="Twitch channel; overrides TWITCH_CHANNEL")
    run_parser.add_argument("--env-file", default=".env", help="configuration file (default: .env)")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "run":
        settings = load_settings(args.env_file)
        if args.channel:
            settings = settings.model_copy(update={"twitch_channel": args.channel})
        print(run(settings))
        return 0
    return 1
