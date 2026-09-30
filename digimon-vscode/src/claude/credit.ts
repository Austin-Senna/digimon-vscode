import { ClaudeSessionCredit, GameEvent, GameState, GameUpdate, recordGameActivity } from '../model/game';
import { ActivityKind } from '../model/pet';
import { ClaudeEvent, SESSION_STALE_MS, statusAfter } from './events';

/** Working time per `claudeWork` reward. */
export const CLAUDE_WORK_MS = 30_000;

/**
 * Credit one Claude event to the game. Every window reads the same log and writes the same save, so crediting
 * is keyed on the event log itself: each session records the time of the last event credited, and any window
 * that reaches an event at or before it skips it. Work time is the gap between events while the session was
 * working, capped at the point where a silent session counts as gone.
 */
export function creditClaudeEvent(game: GameState,
    event: ClaudeEvent,
    now: number,
): GameUpdate {
    const previous = game.claudeSessions[event.session];
    if (previous && event.t <= previous.lastT) {
        return { state: game, events: [] };
    }
    let bankedMs = previous?.bankedMs ?? 0;
    if (previous?.working) {
        bankedMs += Math.min(event.t - previous.lastT, SESSION_STALE_MS);
    }
    const units = Math.floor(bankedMs / CLAUDE_WORK_MS);
    bankedMs -= units * CLAUDE_WORK_MS;
    const status = statusAfter(event.event);
    const credit: ClaudeSessionCredit = {
        lastT: event.t,
        working: status === undefined ? previous?.working ?? false : status === 'working',
        bankedMs,
    };

    let state: GameState = { ...game, claudeSessions: { ...recentSessions(game.claudeSessions, now), [event.session]: credit } };
    const events: GameEvent[] = [];
    const reward = (kind: ActivityKind) => {
        const update = recordGameActivity(state, kind, now);
        state = update.state;
        events.push(...update.events);
    };
    for (let unit = 0; unit < units; unit++) {
        reward('claudeWork');
    }
    if (event.event === 'prompt') {
        reward('prompt');
    }
    return { state, events };
}

/** Drop sessions silent long enough to count as gone, so the save does not grow without bound. */
function recentSessions(sessions: GameState['claudeSessions'],
    now: number,
): Record<string, ClaudeSessionCredit> {
    return Object.fromEntries(Object.entries(sessions).filter(([, credit]) => now - credit.lastT <= SESSION_STALE_MS));
}
