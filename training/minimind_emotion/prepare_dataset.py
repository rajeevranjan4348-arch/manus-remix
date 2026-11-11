#!/usr/bin/env python3
"""Validate, deduplicate, and split chat JSONL into MiniMind SFT format.

Accepts records with either "messages" or "conversations". Outputs the
"conversations" schema required by MiniMind's dataset/lm_dataset.py.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

ALLOWED_ROLES = {"system", "user", "assistant", "tool"}


def normalize(record: object, line_no: int) -> dict:
    if not isinstance(record, dict):
        raise ValueError(f"line {line_no}: expected a JSON object")
    raw = record.get("conversations", record.get("messages"))
    if not isinstance(raw, list):
        raise ValueError(f"line {line_no}: expected a messages or conversations array")
    conversations = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"line {line_no}, message {i}: expected an object")
        role = item.get("role")
        content = item.get("content", "")
        if role not in ALLOWED_ROLES:
            raise ValueError(f"line {line_no}, message {i}: unsupported role {role!r}")
        if not isinstance(content, str):
            raise ValueError(f"line {line_no}, message {i}: content must be text")
        normalized = {"role": role, "content": content.strip()}
        for key in ("reasoning_content", "tools", "tool_calls"):
            if key in item and item[key] is not None:
                value = item[key]
                normalized[key] = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        if role not in {"assistant", "tool"} and not normalized["content"]:
            raise ValueError(f"line {line_no}, message {i}: {role} content cannot be empty")
        conversations.append(normalized)
    roles = {m["role"] for m in conversations}
    if "user" not in roles or "assistant" not in roles:
        raise ValueError(f"line {line_no}: each example must include user and assistant messages")
    if conversations[-1]["role"] != "assistant":
        raise ValueError(f"line {line_no}: final message must be an assistant response")
    return {"conversations": conversations}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="input chat JSONL")
    parser.add_argument("--output-dir", type=Path, default=Path("data/validated"))
    parser.add_argument("--validation-ratio", type=float, default=0.05)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if not 0.0 < args.validation_ratio < 0.5:
        parser.error("--validation-ratio must be between 0 and 0.5")
    if not args.input.is_file():
        parser.error(f"input file does not exist: {args.input}")

    examples, seen = [], set()
    with args.input.open("r", encoding="utf-8") as source:
        for line_no, raw in enumerate(source, 1):
            if not raw.strip():
                continue
            try:
                example = normalize(json.loads(raw), line_no)
            except (json.JSONDecodeError, ValueError) as exc:
                print(str(exc), file=sys.stderr)
                return 2
            fingerprint = json.dumps(example, ensure_ascii=False, sort_keys=True)
            if fingerprint not in seen:
                seen.add(fingerprint)
                examples.append(example)

    if len(examples) < 2:
        parser.error("need at least two unique examples to create train/validation splits")
    random.Random(args.seed).shuffle(examples)
    validation_count = max(1, round(len(examples) * args.validation_ratio))
    validation = examples[:validation_count]
    train = examples[validation_count:]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, rows in (("train.jsonl", train), ("validation.jsonl", validation)):
        target = args.output_dir / name
        with target.open("w", encoding="utf-8") as out:
            for row in rows:
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"Validated {len(examples)} unique examples; train={len(train)}, validation={len(validation)}")
    print(f"Output: {args.output_dir.resolve()}")
    print("Review privacy/licensing and ensure related conversations do not leak across splits.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
