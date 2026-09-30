import * as path from 'path';

// Reader for the digimon-claude event contract (v1): one JSON object per line in ~/.claude/digimon/events.jsonl.

export const CONTRACT_VERSION = 1;

export type ClaudeEventKind =
    | 'session_start' | 'session_end' | 'prompt' | 'tool_start' | 'tool_done' | 'tool_failed' | 'needs_input' | 'stop' | 'error';

const KINDS: ReadonlySet<string> = new Set<ClaudeEventKind>([
    'session_start', 'session_end', 'prompt', 'tool_start', 'tool_done', 'tool_failed', 'needs_input', 'stop', 'error',
]);

export interface ClaudeEvent {
    readonly t: number;
    readonly session: string;
    readonly event: ClaudeEventKind;
    readonly cwd: string;
    readonly subagent: boolean;
    readonly tool?: string;
    /** Parent process of the hook: Claude Code or a shell it spawned. Absent from older hook versions. */
    readonly ppid?: number;
}

/** Parse one log line; anything malformed or from an unknown contract version is skipped. */
export function parseEventLine(line: string): ClaudeEvent | undefined {
    let raw: unknown;
    try {
        raw = JSON.parse(line);
    } catch {
        return undefined;
    }
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const candidate = raw as Record<string, unknown>;
    const valid = candidate.v === CONTRACT_VERSION
        && typeof candidate.t === 'number'
        && typeof candidate.session === 'string'
        && typeof candidate.event === 'string' && KINDS.has(candidate.event)
        && typeof candidate.cwd === 'string';
    if (!valid) {
        return undefined;
    }
    const ppid = candidate.ppid;
    return {
        t: candidate.t as number,
        session: candidate.session as string,
        event: candidate.event as ClaudeEventKind,
        cwd: candidate.cwd as string,
        subagent: candidate.subagent === true,
        ...(typeof candidate.tool === 'string' ? { tool: candidate.tool } : {}),
        ...(typeof ppid === 'number' && Number.isInteger(ppid) && ppid > 0 ? { ppid } : {}),
    };
}

/** True when `cwd` is one of `folders` or inside one. */
export function isWithin(cwd: string,
    folders: readonly string[],
): boolean {
    return folders.some(folder => {
        const relative = path.relative(folder, cwd);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    });
}

export type ClaudeStatus = 'idle' | 'working' | 'waiting';

/**
 * A session silent this long is treated as gone (crashed, killed, or hooks removed). Long enough that a slow tool,
 * like a test suite, which is silent between tool_start and tool_done, still counts as working.
 */
export const SESSION_STALE_MS = 10 * 60_000;

export interface SessionInfo {
    readonly session: string;
    readonly status: Exclude<ClaudeStatus, 'idle'>;
    readonly cwd: string;
    readonly ppid?: number;
    readonly lastSeen: number;
}

/** Tracks what each Claude session is doing so the pet can show the most urgent state. */
export class SessionTracker {
    private readonly _sessions = new Map<string, SessionInfo>();

    apply(event: ClaudeEvent): void {
        const status = statusAfter(event.event);
        if (status === undefined) {
            return;
        }
        if (status === 'idle') {
            this._sessions.delete(event.session);
        } else {
            const ppid = event.ppid ?? this._sessions.get(event.session)?.ppid;
            this._sessions.set(event.session, { session: event.session, status, cwd: event.cwd, ppid, lastSeen: event.t });
        }
    }

    /** Waiting beats working: a blocked Claude matters more than a busy one. */
    status(now: number): ClaudeStatus {
        const live = this.sessions(now);
        if (live.some(session => session.status === 'waiting')) {
            return 'waiting';
        }
        return live.length > 0 ? 'working' : 'idle';
    }

    /** Sessions heard from recently, most recently active first. */
    sessions(now: number): SessionInfo[] {
        for (const [id, session] of this._sessions) {
            if (now - session.lastSeen > SESSION_STALE_MS) {
                this._sessions.delete(id);
            }
        }
        return [...this._sessions.values()].sort((a, b) => b.lastSeen - a.lastSeen);
    }
}

/** Whether `pid` is `ancestor` or below it, given each process's parent. */
export function isDescendant(pid: number,
    ancestor: number,
    parentOf: ReadonlyMap<number, number>,
): boolean {
    const seen = new Set<number>();
    for (let current: number | undefined = pid; current !== undefined && current > 1 && !seen.has(current); current = parentOf.get(current)) {
        if (current === ancestor) {
            return true;
        }
        seen.add(current);
    }
    return false;
}

/** The status a session has after `kind`, or undefined when the event does not change it. */
export function statusAfter(kind: ClaudeEventKind): ClaudeStatus | undefined {
    switch (kind) {
        case 'prompt':
        case 'tool_start':
        case 'tool_done':
        case 'tool_failed':
            return 'working';
        case 'needs_input':
            return 'waiting';
        case 'stop':
        case 'error':
        case 'session_end':
            return 'idle';
        case 'session_start':
            return undefined;
    }
}
