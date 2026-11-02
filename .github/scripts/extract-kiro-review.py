#!/usr/bin/env python3
"""Extract and validate inline findings from Kiro CLI stream-json output."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path, PurePosixPath
from typing import Any

START_MARKER = "<KIRO_REVIEW_JSON>"
END_MARKER = "</KIRO_REVIEW_JSON>"
MAX_FINDINGS = 25
MAX_BODY_CHARS = 10_000
SEVERITIES = {"P0", "P1", "P2", "P3"}
HUNK_HEADER = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("diff", type=Path)
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


def extract_payload(final_text: str) -> dict[str, Any]:
    start = final_text.rfind(START_MARKER)
    if start < 0:
        raise ValueError(f"missing {START_MARKER} marker")
    start += len(START_MARKER)
    end = final_text.find(END_MARKER, start)
    if end < 0:
        raise ValueError(f"missing {END_MARKER} marker")

    payload = json.loads(final_text[start:end].strip())
    if not isinstance(payload, dict) or not isinstance(payload.get("findings"), list):
        raise ValueError("review payload must be an object with a findings array")
    return payload


def diff_right_lines(path: Path) -> set[tuple[str, int]]:
    valid: set[tuple[str, int]] = set()
    current_path: str | None = None
    right_line: int | None = None

    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("+++ "):
            target = line[4:]
            current_path = None if target == "/dev/null" else target.removeprefix("b/")
            right_line = None
            continue

        match = HUNK_HEADER.match(line)
        if match:
            right_line = int(match.group(1))
            continue

        if current_path is None or right_line is None or line.startswith("\\ No newline"):
            continue
        if line.startswith("-"):
            continue
        if line.startswith("+") or line.startswith(" "):
            valid.add((current_path, right_line))
            right_line += 1

    return valid


def normalize_path(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("finding path must be a string")
    path = value.strip().removeprefix("review-target/").removeprefix("./")
    parsed = PurePosixPath(path)
    if not path or parsed.is_absolute() or ".." in parsed.parts:
        raise ValueError(f"invalid finding path: {value!r}")
    return path


def validate_findings(payload: dict[str, Any], valid_lines: set[tuple[str, int]]) -> list[dict[str, Any]]:
    raw_findings = payload["findings"]
    if len(raw_findings) > MAX_FINDINGS:
        raise ValueError(f"review returned more than {MAX_FINDINGS} findings")

    findings: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_findings, start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"finding {index} must be an object")

        severity = raw.get("severity")
        if severity not in SEVERITIES:
            raise ValueError(f"finding {index} has invalid severity")

        title = raw.get("title")
        body = raw.get("body")
        line = raw.get("line")
        path = normalize_path(raw.get("path"))

        if not isinstance(title, str) or not title.strip() or len(title) > 200:
            raise ValueError(f"finding {index} has an invalid title")
        if not isinstance(body, str) or not body.strip() or len(body) > MAX_BODY_CHARS:
            raise ValueError(f"finding {index} has an invalid body")
        if not isinstance(line, int) or line <= 0:
            raise ValueError(f"finding {index} has an invalid line")
        if (path, line) not in valid_lines:
            raise ValueError(f"finding {index} location {path}:{line} is not on the PR diff")

        findings.append(
            {
                "severity": severity,
                "title": title.strip(),
                "body": body.strip(),
                "path": path,
                "line": line,
            }
        )

    return findings


def write_failure(path: Path, message: str) -> None:
    path.write_text(json.dumps({"findings": [], "error": message}) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    final_text, run_status = extract_final_text(args.input)

    if args.exit_code != 0 or run_status != "success" or not final_text:
        write_failure(
            args.output,
            f"Kiro CLI did not complete: exit={args.exit_code}, status={run_status or 'unknown'}",
        )
        return 1

    try:
        payload = extract_payload(final_text)
        findings = validate_findings(payload, diff_right_lines(args.diff))
    except (ValueError, json.JSONDecodeError, OSError) as error:
        write_failure(args.output, str(error))
        return 1

    args.output.write_text(json.dumps({"findings": findings}, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
