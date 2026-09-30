# Claude event contract (v1)

```json
{"v":1,"t":1790708048547,"session":"c80d97f5-...","event":"tool_start","tool":"Bash","subagent":false,"cwd":"/repo"}
```

| Field | Meaning |
|---|---|
| `v` | Contract version. Readers should skip lines with an unknown `v`. |
| `t` | Epoch milliseconds when the hook ran. |
| `session` | Claude Code session id. Several sessions can write concurrently. |
| `event` | One of the kinds below. |
| `tool` | Tool name, only on `tool_*` events. |
| `subagent` | True when a subagent, not the main agent, triggered the event. |
| `cwd` | Session working directory, for per-workspace filtering. |
| `ppid` | Optional. The hook's parent process (Claude Code, or a shell it spawned), used to find the terminal a session runs in. |

| `event` | Hook | Meaning |
|---|---|---|
| `session_start` | SessionStart | A session started, resumed, cleared, or compacted. |
| `session_end` | SessionEnd | A session ended. |
| `prompt` | UserPromptSubmit | The user sent a message. |
| `tool_start` | PreToolUse | A tool call is about to run. |
| `tool_done` | PostToolUse | A tool call succeeded. |
| `tool_failed` | PostToolUseFailure | A tool call failed. |
| `needs_input` | Notification (`permission_prompt`, `idle_prompt`, `elicitation_dialog`) | Claude is waiting on the user. |
| `stop` | Stop | Claude finished its turn. |
| `error` | StopFailure | The turn ended on an API error (rate limit, overload, auth). |

Hooks are registered with `"async": true`, so lines can arrive slightly after
the action and, across sessions, slightly out of order. Order by `t` if it matters.

**Rotation.** At 256 KiB the log is renamed to `events.jsonl.1` and a new file
starts. A reader that sees the size shrink or the inode change should reopen
and read from offset 0.

## Writer

`claude-hook/digimon_claude/hook.py`, installed to `~/.claude/digimon/hook.py` and registered by **Digimon: Connect Claude Code**
as `python3 -I -S "$HOME/.claude/digimon/hook.py"` with `"async": true` on each hook above. The log is created owner-only (`0600`).
It records event kinds, tool names, session ids, and working directories. It never records prompts, tool inputs, or tool output.
`$DIGIMON_EVENTS` overrides the log path.

## Reader

`src/claude/tailer.ts` polls the file every 500 ms from its current end, and `src/claude/events.ts` parses lines.
With `digimon.claude.scope` set to `workspace`, only sessions whose `cwd` is inside the window's workspace folders
count; the default, `all`, takes every session.

Every VS Code window runs its own reader, but they share one save. `src/claude/credit.ts` makes crediting
idempotent: the save keeps, per session, the `t` of the last event credited, and a window skips any event at or
before it. Working time comes from the gaps between a session's events while it was working (capped at 10
minutes, the point where a silent session counts as gone), not from each window's clock. A side effect: an event
logged after a newer one from the same session (see the async note above) is not credited.
