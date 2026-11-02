#!/usr/bin/env python3
"""Extract validated Kiro edits and apply them to an isolated PR checkout."""

from __future__ import annotations

import argparse
import json
from pathlib import Path, PurePosixPath
from typing import Any

START_MARKER = "<KIRO_FIX_JSON>"
END_MARKER = "</KIRO_FIX_JSON>"
MAX_EDITS = 20
MAX_CHANGED_LINES = 2_000
MAX_FILE_BYTES = 1_000_000
PROTECTED_PARTS = {".git", ".github", ".kiro"}
PROTECTED_NAMES = {".gitmodules", "package-lock.json", "bun.lock", "yarn.lock", "pnpm-lock.yaml"}
PROTECTED_SUFFIXES = {".pem", ".key", ".p12", ".pfx"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("stream", type=Path)
    parser.add_argument("root", type=Path)
    parser.add_argument("--exit-code", type=int, required=True)
    return parser.parse_args()


def extract_final_text(path: Path) -> tuple[str | None, str | None]:
    final_text: str | None = None
    status: str | None = None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "runFinished":
            data = event.get("data", {})
            if isinstance(data.get("finalText"), str):
                final_text = data["finalText"].strip()
            if isinstance(data.get("status"), str):
                status = data["status"]
    return final_text, status


def extract_payload(text: str) -> dict[str, Any]:
    start = text.rfind(START_MARKER)
    if start < 0:
        raise ValueError(f"missing {START_MARKER} marker")
    start += len(START_MARKER)
    end = text.find(END_MARKER, start)
    if end < 0:
        raise ValueError(f"missing {END_MARKER} marker")
    payload = json.loads(text[start:end].strip())
    if not isinstance(payload, dict) or not isinstance(payload.get("edits"), list):
        raise ValueError("fix payload must be an object with an edits array")
    return payload


def safe_relative_path(value: Any) -> PurePosixPath:
    if not isinstance(value, str):
        raise ValueError("edit path must be a string")
    normalized = value.strip().removeprefix("review-target/").removeprefix("./")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts:
        raise ValueError(f"invalid edit path: {value!r}")
    if PROTECTED_PARTS.intersection(path.parts):
        raise ValueError(f"protected path: {normalized}")
    if path.name in PROTECTED_NAMES or path.name.startswith(".env"):
        raise ValueError(f"protected file: {normalized}")
    if path.suffix.lower() in PROTECTED_SUFFIXES:
        raise ValueError(f"credential file is protected: {normalized}")
    return path


def apply_edits(root: Path, edits: list[Any]) -> list[str]:
    if not edits or len(edits) > MAX_EDITS:
        raise ValueError(f"edits must contain between 1 and {MAX_EDITS} entries")

    root = root.resolve(strict=True)
    staged: dict[Path, str] = {}
    changed_lines = 0

    for index, edit in enumerate(edits, start=1):
        if not isinstance(edit, dict):
            raise ValueError(f"edit {index} must be an object")
        relative = safe_relative_path(edit.get("path"))
        target = root.joinpath(*relative.parts)
        resolved = target.resolve(strict=True)
        if target.is_symlink() or root not in resolved.parents:
            raise ValueError(f"edit {index} escapes the review target")
        if not resolved.is_file() or resolved.stat().st_size > MAX_FILE_BYTES:
            raise ValueError(f"edit {index} targets an unsupported file")

        old = edit.get("old")
        new = edit.get("new")
        if not isinstance(old, str) or not old:
            raise ValueError(f"edit {index} old text must be non-empty")
        if not isinstance(new, str) or old == new:
            raise ValueError(f"edit {index} replacement must change the text")

        content = staged.get(resolved)
        if content is None:
            content = resolved.read_text(encoding="utf-8")
        if content.count(old) != 1:
            raise ValueError(f"edit {index} old text must occur exactly once in {relative}")

        changed_lines += max(old.count("\n") + 1, new.count("\n") + 1)
        if changed_lines > MAX_CHANGED_LINES:
            raise ValueError(f"fix exceeds the {MAX_CHANGED_LINES}-line limit")
        staged[resolved] = content.replace(old, new, 1)

    for target, content in staged.items():
        target.write_text(content, encoding="utf-8")

    return sorted(str(path.relative_to(root)) for path in staged)


def main() -> int:
    args = parse_args()
    text, status = extract_final_text(args.stream)
    if args.exit_code != 0 or status != "success" or not text:
        raise SystemExit(f"Kiro did not complete: exit={args.exit_code}, status={status or 'unknown'}")

    payload = extract_payload(text)
    changed = apply_edits(args.root, payload["edits"])
    print("Applied Kiro edits to: " + ", ".join(changed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
