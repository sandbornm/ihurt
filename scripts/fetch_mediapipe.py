#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# ///
"""Vendor MediaPipe SIMD wasm and the hand landmarker so Hands works offline."""

from __future__ import annotations

import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WASM_SRC = ROOT / "node_modules" / "@mediapipe" / "tasks-vision" / "wasm"
DEST = ROOT / "public" / "mediapipe"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
MODEL_PATH = DEST / "hand_landmarker.task"
SIMD_NAMES = ("vision_wasm_internal.js", "vision_wasm_internal.wasm")


def copy_simd_wasm() -> None:
    if not WASM_SRC.is_dir():
        raise FileNotFoundError(
            "Install npm packages first (missing @mediapipe/tasks-vision wasm)."
        )
    wasm_dest = DEST / "wasm"
    wasm_dest.mkdir(parents=True, exist_ok=True)
    for name in SIMD_NAMES:
        source = WASM_SRC / name
        if not source.is_file():
            raise FileNotFoundError(f"Missing {source}")
        target = wasm_dest / name
        if target.is_file() and target.stat().st_size == source.stat().st_size:
            continue
        shutil.copy2(source, target)


def fetch_model() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    if MODEL_PATH.is_file() and MODEL_PATH.stat().st_size > 1_000_000:
        return
    request = urllib.request.Request(MODEL_URL, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not download the hand landmarker: {error}") from error
    if len(data) < 1_000_000:
        raise RuntimeError("Hand landmarker download was too small.")
    tmp = MODEL_PATH.with_suffix(".tmp")
    tmp.write_bytes(data)
    tmp.replace(MODEL_PATH)


def main() -> int:
    copy_simd_wasm()
    fetch_model()
    print(f"MediaPipe hands assets ready in {DEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
