#!/usr/bin/env python3
"""Validate and normalize chat-style JSONL for MiniMind fine-tuning.

Input: one JSON object per line with a non-empty "messages" array.
Output: validated JSONL with only role/content fields. This intentionally does
not download data, call external APIs, or include any model weights.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

ALLOWED_ROLES = {"system", "user", "assistant"}
REQUIRED_ROLES = {"user", "assistant"}


def normalize(record: object, line_no: int) -> dict:
    if not isinstance(record, dict) or not isinstance(record.get("messages"), list):
        raise ValueError(f"line {line_no}: expected an object with a messages array")
    messages = []
    for i, item in enumerate(record["messages"]):
        if not isinstance(item, dict):
            raise ValueError(f"line {line_no}, message {i}: expected an object")
        role, content = item.get("role"), item.get("content")
        if role not in ALLOWED_ROLES:
            raise ValueError(f"line {line_no}, message {i}: unsupported role {role!r}")
        if not isinstance(content, str) or not content.strip():
            raise ValueError(f"line {line_no}, message {i}: content must be non-empty text")
        messages.append({"role": role, "content": content.strip()})
    roles = {m["role"] for m in messages}
    if not REQUIRED_ROLES.issubset(roles):
        raise ValueError(f"line {line_no}: each example must include user and assistant messages")
    if messages[-1]["role"] != "assistant":
        raise ValueError(f"line {line_no}: final message must be assistant output")
    return {"messages": messages}


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
    print("Reminder: inspect data for secrets/PII and split by source before training.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
