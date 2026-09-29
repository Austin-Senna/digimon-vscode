"""Claude Code hook: translate hook payloads into pet events.

Registered for several hook events in ~/.claude/settings.json. Each call reads
the hook JSON on stdin and appends at most one line to the events log:

    {"v": 1, "t": <epoch ms>, "session": "...", "event": "<kind>",
     "tool": "Bash", "subagent": false, "cwd": "..."}

`tool` is present only for tool events. Event kinds:
    session_start, session_end, prompt, tool_start, tool_done, tool_failed,
    needs_input, stop, error

Consumers tail the file. When it passes MAX_BYTES it is renamed to
events.jsonl.1 and a new file starts, so a reader that sees the size shrink
or the inode change should restart from offset 0.

Stdlib only and run by path, so it works under any python3. It must never
fail the hook: every error is swallowed and the exit code is always 0.
"""
from __future__ import annotations  # keeps `dict | None` hints importable on macOS's system Python 3.9

import json
import os
import sys
import time
from pathlib import Path

VERSION = 1
MAX_BYTES = 256 * 1024
INPUT_NOTIFICATIONS = {"permission_prompt", "idle_prompt", "elicitation_dialog"}
SIMPLE_EVENTS = {
    "SessionStart": "session_start",
    "SessionEnd": "session_end",
    "UserPromptSubmit": "prompt",
    "PreToolUse": "tool_start",
    "PostToolUse": "tool_done",
    "PostToolUseFailure": "tool_failed",
    "Stop": "stop",
    "StopFailure": "error",
}
TOOL_EVENTS = {"tool_start", "tool_done", "tool_failed"}


def events_path() -> Path:
    """Events log, overridable with $DIGIMON_EVENTS."""
    return Path(os.environ.get("DIGIMON_EVENTS", "~/.claude/digimon/events.jsonl")).expanduser()


def to_event(payload: dict,
    now_ms: int,
) -> dict | None:
    """Map one hook payload to a pet event, or None if the pet should ignore it."""
    name = payload.get("hook_event_name")
    if name == "Notification":
        kind = "needs_input" if payload.get("notification_type") in INPUT_NOTIFICATIONS else None
    else:
        kind = SIMPLE_EVENTS.get(name)
    if kind is None:
        return None
    event = {
        "v": VERSION,
        "t": now_ms,
        "session": payload.get("session_id", ""),
        "event": kind,
        "subagent": bool(payload.get("agent_id")),
        "cwd": payload.get("cwd", ""),
    }
    if kind in TOOL_EVENTS:
        event["tool"] = payload.get("tool_name", "")
    return event


def append(event: dict,
    path: Path,
) -> None:
    """Append one JSON line, rotating first if the log is full.

    A single O_APPEND write of a short line lands whole even when several
    Claude sessions fire hooks at once.
    """
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        if path.stat().st_size >= MAX_BYTES:
            path.replace(path.with_name(path.name + ".1"))
    except FileNotFoundError:
        pass
    line = (json.dumps(event, separators=(",", ":")) + "\n").encode()
    # Owner-only: the log reveals which projects you work in and when.
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        os.fchmod(fd, 0o600)  # also tightens logs created by older versions
        os.write(fd, line)
    finally:
        os.close(fd)


def main() -> int:
    """Hook entry point."""
    try:
        event = to_event(json.load(sys.stdin), int(time.time() * 1000))
        if event is not None:
            append(event, events_path())
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
