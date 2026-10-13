#!/usr/bin/env python3
"""Prepare an emotion-aware chat dataset and run MiniMind's native full-SFT trainer.

This script does not download model weights or data. Train on a GPU host such as
Google Colab; do not run the training loop inside Netlify Functions.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROLES = {"system", "user", "assistant", "tool"}


def normalize_record(record: object, line_no: int) -> dict:
    if not isinstance(record, dict):
        raise ValueError(f"line {line_no}: expected a JSON object")
    raw = record.get("conversations", record.get("messages"))
    if not isinstance(raw, list):
        raise ValueError(f"line {line_no}: expected 'conversations' or 'messages' array")
    conversations = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"line {line_no}, message {i}: expected an object")
        role = item.get("role")
        content = item.get("content", "")
        if role not in ROLES:
            raise ValueError(f"line {line_no}, message {i}: unsupported role {role!r}")
        if not isinstance(content, str):
            raise ValueError(f"line {line_no}, message {i}: content must be text")
        normalized = {"role": role, "content": content.strip()}
        # Preserve optional MiniMind tool metadata when provided.
        for key in ("reasoning_content", "tools", "tool_calls"):
            if key in item and item[key] is not None:
                value = item[key]
                normalized[key] = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        if role != "assistant" and not normalized["content"] and role != "tool":
            raise ValueError(f"line {line_no}, message {i}: {role} content cannot be empty")
        if normalized["content"] or role == "assistant" or role == "tool":
            conversations.append(normalized)
    roles = {m["role"] for m in conversations}
    if "user" not in roles or "assistant" not in roles:
        raise ValueError(f"line {line_no}: example needs at least one user and assistant message")
    if conversations[-1]["role"] != "assistant":
        raise ValueError(f"line {line_no}: final message must be an assistant response")
    return {"conversations": conversations}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data", required=True, type=Path, help="JSONL with messages/conversations arrays")
    p.add_argument("--minimind-dir", required=True, type=Path, help="path to a cloned jingyaogong/minimind checkout")
    p.add_argument("--output-dir", type=Path, default=Path("training/minimind_emotion/prepared"))
    p.add_argument("--epochs", type=int, default=2)
    p.add_argument("--batch-size", type=int, default=2)
    p.add_argument("--learning-rate", type=float, default=1e-5)
    p.add_argument("--max-seq-len", type=int, default=512)
    p.add_argument("--hidden-size", type=int, default=512, help="must match the base checkpoint architecture")
    p.add_argument("--num-hidden-layers", type=int, default=8)
    p.add_argument("--from-weight", default="pretrain", help="MiniMind checkpoint prefix, usually pretrain")
    p.add_argument("--save-weight", default="emotion_sft")
    p.add_argument("--device", default=None, help="e.g. cuda:0; defaults to MiniMind auto selection")
    p.add_argument("--dtype", choices=("float16", "bfloat16"), default="float16", help="mixed precision; float16 is a safer default for Colab T4 GPUs")
    p.add_argument("--dry-run", action="store_true", help="validate data and print the command without training")
    args = p.parse_args()

    if not args.data.is_file():
        p.error(f"dataset file not found: {args.data}")
    root = args.minimind_dir.resolve()
    trainer = root / "trainer" / "train_full_sft.py"
    if not trainer.is_file():
        p.error(f"{trainer} not found; clone https://github.com/jingyaogong/minimind first")
    if args.epochs < 1 or args.batch_size < 1 or args.max_seq_len < 32:
        p.error("epochs/batch-size must be >= 1 and max-seq-len must be >= 32")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    prepared = args.output_dir.resolve() / "emotion_sft.jsonl"
    count, seen = 0, set()
    with args.data.open("r", encoding="utf-8") as src, prepared.open("w", encoding="utf-8") as dst:
        for line_no, line in enumerate(src, 1):
            if not line.strip():
                continue
            try:
                row = normalize_record(json.loads(line), line_no)
            except (json.JSONDecodeError, ValueError) as exc:
                print(str(exc), file=sys.stderr)
                return 2
            fingerprint = json.dumps(row, ensure_ascii=False, sort_keys=True)
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            dst.write(json.dumps(row, ensure_ascii=False) + "\n")
            count += 1
    if count < 2:
        p.error("at least two unique examples are required; create a separate held-out validation set too")

    checkpoint = root / "out" / f"{args.from_weight}_{args.hidden_size}.pth"
    if args.from_weight != "none" and not checkpoint.is_file():
        p.error(
            f"base checkpoint not found: {checkpoint}. Train/download a compatible MiniMind checkpoint "
            "first, or choose --from-weight none only if intentionally training without pretrained weights."
        )

    cmd = [
        sys.executable, str(trainer),
        "--data_path", str(prepared),
        "--save_dir", str((root / "out").resolve()),
        "--save_weight", args.save_weight,
        "--epochs", str(args.epochs),
        "--batch_size", str(args.batch_size),
        "--learning_rate", str(args.learning_rate),
        "--max_seq_len", str(args.max_seq_len),
        "--hidden_size", str(args.hidden_size),
        "--num_hidden_layers", str(args.num_hidden_layers),
        "--from_weight", args.from_weight,
        "--dtype", args.dtype,
    ]
    if args.device:
        cmd += ["--device", args.device]
    print(f"Prepared {count} unique conversations: {prepared}")
    print("Training output will be written outside Manus Remix's web runtime:", root / "out")
    print("Command:", " ".join(cmd))
    if args.dry_run:
        print("Dry run only: training was not started.")
        return 0
    print("Starting MiniMind full supervised fine-tuning. Keep a copy of your base checkpoint.")
    return subprocess.call(cmd, cwd=root / "trainer")


if __name__ == "__main__":
    raise SystemExit(main())
