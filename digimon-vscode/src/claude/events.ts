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
    return {
        t: candidate.t as number,
        session: candidate.session as string,
        event: candidate.event as ClaudeEventKind,
        cwd: candidate.cwd as string,
        subagent: candidate.subagent === true,
        tool: typeof candidate.tool === 'string' ? candidate.tool : undefined,
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

/** A session that has been silent this long is treated as gone (crashed, killed, or hooks removed). */
export const SESSION_STALE_MS = 2 * 60_000;

/** Tracks what each Claude session is doing so the pet can show the most urgent state. */
export class SessionTracker {
    private readonly _sessions = new Map<string, { status: ClaudeStatus; lastSeen: number }>();

    apply(event: ClaudeEvent): void {
        const status = statusAfter(event.event);
        if (status === undefined) {
            return;
        }
        if (status === 'idle') {
            this._sessions.delete(event.session);
        } else {
            this._sessions.set(event.session, { status, lastSeen: event.t });
        }
    }

    /** Waiting beats working: a blocked Claude matters more than a busy one. */
    status(now: number): ClaudeStatus {
        let result: ClaudeStatus = 'idle';
        for (const [session, entry] of this._sessions) {
            if (now - entry.lastSeen > SESSION_STALE_MS) {
                this._sessions.delete(session);
            } else if (entry.status === 'waiting') {
                return 'waiting';
            } else {
                result = 'working';
            }
        }
        return result;
    }
}

function statusAfter(kind: ClaudeEventKind): ClaudeStatus | undefined {
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
