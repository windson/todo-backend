#!/usr/bin/env python3
"""Print the latest Kiro credit total from a stream-json run."""

from __future__ import annotations

import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


def extract_credits(path: Path) -> str:
    latest_usage: list[dict[str, Any]] | None = None

    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return "unknown"

    for line in lines:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if event.get("type") != "metadata":
            continue

        usage = event.get("data", {}).get("meteringUsage")
        if isinstance(usage, list):
            latest_usage = [item for item in usage if isinstance(item, dict)]

    if latest_usage is None:
        return "unknown"

    total = Decimal("0")
    found = False
    for item in latest_usage:
        if item.get("unit") not in {"credit", "credits"}:
            continue
        try:
            total += Decimal(str(item["value"]))
        except (InvalidOperation, KeyError, TypeError, ValueError):
            continue
        found = True

    return format(total, "f") if found else "unknown"


def main() -> int:
    if len(sys.argv) != 2:
        print("unknown")
        return 0

    print(extract_credits(Path(sys.argv[1])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
