#!/usr/bin/env python3
"""Extract the final assistant response from Kiro CLI stream-json output."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

MAX_COMMENT_CHARS = 60_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--exit-code", type=int, required=True)
    return parser.parse_args()


def extract_final_text(path: Path) -> tuple[str | None, str | None]:
    final_text: str | None = None
    run_status: str | None = None

    if not path.exists():
        return final_text, run_status

    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            event = json.loads(raw_line)
        except json.JSONDecodeError:
            continue

        if event.get("type") != "runFinished":
            continue

        data = event.get("data", {})
        candidate = data.get("finalText")
        if isinstance(candidate, str) and candidate.strip():
            final_text = candidate.strip()
        status = data.get("status")
        if isinstance(status, str):
            run_status = status

    return final_text, run_status


def main() -> int:
    args = parse_args()
    final_text, run_status = extract_final_text(args.input)

    if args.exit_code != 0 or run_status != "success" or not final_text:
        message = (
            "## Review unavailable\n\n"
            "Kiro CLI did not complete the automated review. "
            f"CLI exit code: `{args.exit_code}`; run status: `{run_status or 'unknown'}`. "
            "Open the linked GitHub Actions run for diagnostic output."
        )
        args.output.write_text(message + "\n", encoding="utf-8")
        return 1

    if len(final_text) > MAX_COMMENT_CHARS:
        final_text = (
            final_text[:MAX_COMMENT_CHARS]
            + "\n\n_Review truncated to fit GitHub's comment limit. See the workflow log for the full response._"
        )

    args.output.write_text(final_text + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
