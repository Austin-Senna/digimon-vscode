import json
import subprocess
import sys
from pathlib import Path

import pytest

from digimon_claude import hook

HOOK_SCRIPT = Path(hook.__file__)


def payload(name: str, **extra) -> dict:
    return {"hook_event_name": name, "session_id": "s1", "cwd": "/repo", **extra}


@pytest.mark.parametrize("name, kind", [
    ("SessionStart", "session_start"),
    ("SessionEnd", "session_end"),
    ("UserPromptSubmit", "prompt"),
    ("Stop", "stop"),
    ("StopFailure", "error"),
])
def test_simple_events(name, kind):
    event = hook.to_event(payload(name), 123)
    assert event == {"v": 1, "t": 123, "session": "s1", "event": kind,
                     "subagent": False, "cwd": "/repo"}


@pytest.mark.parametrize("name, kind", [
    ("PreToolUse", "tool_start"),
    ("PostToolUse", "tool_done"),
    ("PostToolUseFailure", "tool_failed"),
])
def test_tool_events_carry_tool_name(name, kind):
    event = hook.to_event(payload(name, tool_name="Bash", agent_id="a1"), 0)
    assert (event["event"], event["tool"], event["subagent"]) == (kind, "Bash", True)


def test_notifications_only_when_input_is_needed():
    assert hook.to_event(payload("Notification", notification_type="permission_prompt"), 0)["event"] == "needs_input"
    assert hook.to_event(payload("Notification", notification_type="auth_success"), 0) is None


def test_unmapped_events_are_ignored():
    assert hook.to_event(payload("PreCompact"), 0) is None
    assert hook.to_event({}, 0) is None


def test_append_rotates_full_log(tmp_path: Path, monkeypatch):
    log = tmp_path / "events.jsonl"
    monkeypatch.setattr(hook, "MAX_BYTES", 10)
    log.write_text("x" * 10 + "\n")
    hook.append({"event": "stop"}, log)
    assert (tmp_path / "events.jsonl.1").read_text() == "x" * 10 + "\n"
    assert json.loads(log.read_text()) == {"event": "stop"}


SYSTEM_PYTHON = Path("/usr/bin/python3")


def run_script(stdin: str, log: Path) -> subprocess.CompletedProcess:
    # Same flags as the installed command: isolated mode, no site-packages.
    return subprocess.run([sys.executable, "-I", "-S", str(HOOK_SCRIPT)], input=stdin, text=True,
                          capture_output=True, env={"DIGIMON_EVENTS": str(log)})


def test_script_runs_standalone_and_appends(tmp_path: Path):
    log = tmp_path / "nested" / "events.jsonl"
    for name in ("PreToolUse", "PostToolUse"):
        result = run_script(json.dumps(payload(name, tool_name="Edit")), log)
        assert (result.returncode, result.stdout, result.stderr) == (0, "", "")
    events = [json.loads(line) for line in log.read_text().splitlines()]
    assert [e["event"] for e in events] == ["tool_start", "tool_done"]


@pytest.mark.skipif(not SYSTEM_PYTHON.exists(), reason="no system python3")
def test_script_runs_under_system_python(tmp_path: Path):
    """macOS ships Python 3.9 as /usr/bin/python3, and that is what `python3` often resolves to in hooks."""
    log = tmp_path / "events.jsonl"
    result = subprocess.run([str(SYSTEM_PYTHON), "-I", "-S", str(HOOK_SCRIPT)], input=json.dumps(payload("Stop")),
                            text=True, capture_output=True, env={"DIGIMON_EVENTS": str(log)})
    assert (result.returncode, result.stderr) == (0, "")
    assert json.loads(log.read_text())["event"] == "stop"


def test_log_is_private_to_the_user(tmp_path: Path):
    log = tmp_path / "digimon" / "events.jsonl"
    log.parent.mkdir()
    log.write_text("")
    log.chmod(0o644)
    run_script(json.dumps(payload("Stop")), log)
    assert log.stat().st_mode & 0o777 == 0o600


def test_script_never_fails_the_hook(tmp_path: Path):
    result = run_script("not json", tmp_path / "events.jsonl")
    assert (result.returncode, result.stderr) == (0, "")
    assert not (tmp_path / "events.jsonl").exists()
