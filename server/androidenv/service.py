"""Authenticated, approval-gated ADB bridge for Manus Remix.

Run on a trusted host with Android SDK Platform Tools and a connected emulator.
AndroidEnv task policies must be configured separately before using its RL APIs.
"""
from __future__ import annotations

import base64
import hmac
import os
import subprocess
from typing import Literal
from urllib.parse import quote

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Manus Remix AndroidEnv Bridge", docs_url=None, redoc_url=None)
TOKEN = os.environ.get("ANDROID_CONTROL_TOKEN", "")
SERIAL = os.environ.get("ANDROID_ADB_SERIAL", "").strip()
ALLOWED_PACKAGES = {
    p.strip()
    for p in os.environ.get("ANDROID_ALLOWED_PACKAGES", "").split(",")
    if p.strip()
}
# Explicit allowlist: never expose arbitrary Android key events through the API.
ALLOWED_KEYS = {
    "back": "4",
    "home": "3",
    "recents": "187",
    "enter": "66",
    "volume_up": "24",
    "volume_down": "25",
    "power": "26",
    "tab": "61",
    "escape": "111",
}


def require_token(authorization: str | None = Header(default=None)) -> None:
    if not TOKEN:
        raise HTTPException(status_code=503, detail="Android control is not configured")
    expected = f"Bearer {TOKEN}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def adb(*args: str, timeout: int = 15) -> bytes:
    command = ["adb"]
    if SERIAL:
        command += ["-s", SERIAL]
    command += list(args)
    try:
        result = subprocess.run(
            command, check=False, capture_output=True, timeout=timeout
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503, detail="ADB is not installed on the sidecar host"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="ADB command timed out") from exc
    if result.returncode != 0:
        # Do not return raw stderr; it can contain device or path information.
        raise HTTPException(
            status_code=502, detail="ADB command failed; check sidecar host logs"
        )
    return result.stdout


class Action(BaseModel):
    action: Literal["tap", "swipe", "back", "home", "open_app", "key"]
    confirmed: bool = False
    x: int | None = Field(default=None, ge=0, le=20000)
    y: int | None = Field(default=None, ge=0, le=20000)
    end_x: int | None = Field(default=None, ge=0, le=20000)
    end_y: int | None = Field(default=None, ge=0, le=20000)
    duration_ms: int = Field(default=350, ge=80, le=5000)
    package_name: str | None = Field(
        default=None, min_length=3, max_length=180, pattern=r"^[A-Za-z0-9_.]+$"
    )
    key_name: str | None = Field(default=None, max_length=32)


class TextInput(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    confirmed: bool = False


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "manus-remix-androidenv-bridge"}


@app.get("/v1/device/info", dependencies=[Depends(require_token)])
def device_info() -> dict[str, str]:
    """Return non-sensitive emulator/device metadata."""
    size = adb("shell", "wm", "size").decode("utf-8", "replace").strip()
    density = adb("shell", "wm", "density").decode("utf-8", "replace").strip()
    model = adb("shell", "getprop", "ro.product.model").decode(
        "utf-8", "replace"
    ).strip()
    android_version = adb(
        "shell", "getprop", "ro.build.version.release"
    ).decode("utf-8", "replace").strip()
    return {
        "model": model[:120],
        "android_version": android_version[:40],
        "screen_size": size[-100:],
        "screen_density": density[-100:],
    }


@app.get("/v1/device/apps", dependencies=[Depends(require_token)])
def allowed_apps() -> dict[str, list[str]]:
    """Return only packages explicitly configured for app launching."""
    return {"packages": sorted(ALLOWED_PACKAGES)}


@app.get("/v1/device/screenshot", dependencies=[Depends(require_token)])
def screenshot() -> dict[str, str]:
    png = adb("exec-out", "screencap", "-p", timeout=20)
    return {"mime_type": "image/png", "image_base64": base64.b64encode(png).decode("ascii")}


@app.post("/v1/device/text", dependencies=[Depends(require_token)])
def type_text(body: TextInput) -> dict[str, str]:
    """Type user-confirmed text without allowing arbitrary shell commands."""
    if not body.confirmed:
        raise HTTPException(status_code=403, detail="Explicit user confirmation is required")
    # Android's input command treats %s as a space. Quote everything else so
    # shell metacharacters are never passed through as executable syntax.
    encoded = quote(body.text, safe="@._-/:,!?")
    encoded = encoded.replace("%20", "%s")
    adb("shell", "input", "text", encoded, timeout=20)
    return {"status": "accepted", "action": "type_text", "characters": str(len(body.text))}


@app.post("/v1/device/action", dependencies=[Depends(require_token)])
def perform_action(body: Action) -> dict[str, str]:
    if not body.confirmed:
        raise HTTPException(status_code=403, detail="Explicit user confirmation is required")

    if body.action == "tap":
        if body.x is None or body.y is None:
            raise HTTPException(status_code=422, detail="tap requires x and y")
        adb("shell", "input", "tap", str(body.x), str(body.y))
    elif body.action == "swipe":
        if None in (body.x, body.y, body.end_x, body.end_y):
            raise HTTPException(
                status_code=422, detail="swipe requires x, y, end_x, and end_y"
            )
        adb(
            "shell", "input", "swipe", str(body.x), str(body.y),
            str(body.end_x), str(body.end_y), str(body.duration_ms)
        )
    elif body.action == "back":
        adb("shell", "input", "keyevent", ALLOWED_KEYS["back"])
    elif body.action == "home":
        adb("shell", "input", "keyevent", ALLOWED_KEYS["home"])
    elif body.action == "key":
        if not body.key_name or body.key_name not in ALLOWED_KEYS:
            raise HTTPException(status_code=422, detail="Unsupported key_name")
        adb("shell", "input", "keyevent", ALLOWED_KEYS[body.key_name])
    elif body.action == "open_app":
        package = body.package_name
        if not package or package not in ALLOWED_PACKAGES:
            raise HTTPException(status_code=403, detail="Package is not in ANDROID_ALLOWED_PACKAGES")
        adb(
            "shell", "monkey", "-p", package,
            "-c", "android.intent.category.LAUNCHER", "1"
        )

    return {"status": "accepted", "action": body.action}
