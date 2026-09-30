import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CLAUDE_WORK_MS, creditClaudeEvent } from '../../claude/credit';
import { ClaudeEvent, SESSION_STALE_MS, SessionTracker, isDescendant, isWithin, parseEventLine } from '../../claude/events';
import { GameState, activeBuddy, createGame } from '../../model/game';
import { RULES } from '../../model/pet';
import { LineTailer } from '../../claude/tailer';

const T0 = 1_790_708_048_547;

function line(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({ v: 1, t: T0, session: 's1', event: 'tool_start', tool: 'Bash', subagent: false, cwd: '/repo', ...overrides });
}

function event(overrides: Partial<ClaudeEvent> = {}): ClaudeEvent {
    return { t: T0, session: 's1', event: 'tool_start', cwd: '/repo', subagent: false, ...overrides };
}

suite('claude events', () => {
    test('parses a contract v1 line', () => {
        assert.deepStrictEqual(parseEventLine(line()), event({ tool: 'Bash' }));
    });

    test('skips junk, unknown versions, and unknown kinds', () => {
        assert.strictEqual(parseEventLine('not json'), undefined);
        assert.strictEqual(parseEventLine('null'), undefined);
        assert.strictEqual(parseEventLine(line({ v: 2 })), undefined);
        assert.strictEqual(parseEventLine(line({ event: 'teleport' })), undefined);
        assert.strictEqual(parseEventLine(line({ cwd: undefined })), undefined);
    });

    test('isWithin matches the folder and its children only', () => {
        const folders = ['/work/app'];
        assert.ok(isWithin('/work/app', folders));
        assert.ok(isWithin('/work/app/src', folders));
        assert.ok(!isWithin('/work/app-other', folders));
        assert.ok(!isWithin('/work', folders));
        assert.ok(!isWithin('/work/app', []));
    });

    test('tracker reports working until the turn stops', () => {
        const tracker = new SessionTracker();
        tracker.apply(event({ event: 'prompt' }));
        assert.strictEqual(tracker.status(T0), 'working');
        tracker.apply(event({ event: 'stop' }));
        assert.strictEqual(tracker.status(T0), 'idle');
    });

    test('waiting on any session beats working on another', () => {
        const tracker = new SessionTracker();
        tracker.apply(event({ session: 'a', event: 'tool_start' }));
        tracker.apply(event({ session: 'b', event: 'needs_input' }));
        assert.strictEqual(tracker.status(T0), 'waiting');
        tracker.apply(event({ session: 'b', event: 'tool_start' }));
        assert.strictEqual(tracker.status(T0), 'working');
    });

    test('parses the optional parent pid and ignores bad values', () => {
        assert.strictEqual(parseEventLine(line({ ppid: 4242 }))!.ppid, 4242);
        assert.strictEqual(parseEventLine(line({ ppid: -1 }))!.ppid, undefined);
        assert.strictEqual(parseEventLine(line({ ppid: '4242' }))!.ppid, undefined);
    });

    test('tracker lists waiting sessions with their folder and pid', () => {
        const tracker = new SessionTracker();
        tracker.apply(event({ session: 'a', event: 'prompt', ppid: 10, cwd: '/work/a' }));
        tracker.apply(event({ session: 'a', event: 'needs_input', cwd: '/work/a' }));
        assert.deepStrictEqual(tracker.sessions(T0), [{ session: 'a', status: 'waiting', cwd: '/work/a', ppid: 10, lastSeen: T0 }]);
    });

    test('isDescendant walks up the process tree', () => {
        const parents = new Map([[40, 30], [30, 20], [20, 1], [99, 1]]);
        assert.ok(isDescendant(40, 20, parents));
        assert.ok(isDescendant(20, 20, parents));
        assert.ok(!isDescendant(99, 20, parents));
        assert.strictEqual(isDescendant(40, 20, new Map([[40, 30], [30, 40]])), false, 'a cycle ends the walk');
    });

    test('silent sessions expire', () => {
        const tracker = new SessionTracker();
        tracker.apply(event({ event: 'needs_input' }));
        assert.strictEqual(tracker.status(T0 + SESSION_STALE_MS + 1), 'idle');
    });
});

suite('claude credit', () => {
    const MINUTE = 60_000;

    /** Apply events in order, as one window reading the log would. */
    function credit(game: GameState,
        ...events: ClaudeEvent[]
    ): GameState {
        return events.reduce((state, next) => creditClaudeEvent(state, next, next.t).state, game);
    }

    function xp(game: GameState): number {
        return activeBuddy(game).xp;
    }

    test('a prompt read by two windows is credited once', () => {
        const start = createGame(T0, () => 0);
        const prompt = event({ event: 'prompt' });
        const firstWindow = creditClaudeEvent(start, prompt, T0);
        const secondWindow = creditClaudeEvent(firstWindow.state, prompt, T0 + 500);
        assert.strictEqual(xp(firstWindow.state), xp(start) + RULES.xpPerActivity.prompt);
        assert.strictEqual(secondWindow.state, firstWindow.state, 'the second window changes nothing');
    });

    test('work time between events is credited in whole units, carrying the remainder', () => {
        const start = createGame(T0, () => 0);
        const state = credit(start,
            event({ event: 'prompt', t: T0 }),
            event({ event: 'tool_start', t: T0 + 2 * CLAUDE_WORK_MS + 5_000 }),
            event({ event: 'tool_done', t: T0 + 3 * CLAUDE_WORK_MS + 20_000 }),
        );
        assert.strictEqual(xp(state), xp(start) + RULES.xpPerActivity.prompt + 3 * RULES.xpPerActivity.claudeWork);
        assert.strictEqual(state.claudeSessions.s1.bankedMs, 20_000);
    });

    test('time spent waiting on the user or idle earns nothing', () => {
        const start = createGame(T0, () => 0);
        const state = credit(start,
            event({ event: 'needs_input', t: T0 }),
            event({ event: 'tool_start', t: T0 + 5 * MINUTE }),
            event({ event: 'stop', t: T0 + 5 * MINUTE + 1 }),
            event({ event: 'prompt', t: T0 + 10 * MINUTE }),
        );
        assert.strictEqual(xp(state), xp(start) + RULES.xpPerActivity.prompt);
    });

    test('a long silent gap, e.g. a suspended laptop, is capped', () => {
        const start = createGame(T0, () => 0);
        const state = credit(start,
            event({ event: 'tool_start', t: T0 }),
            event({ event: 'tool_done', t: T0 + 8 * 60 * MINUTE }),
        );
        assert.strictEqual(xp(state), xp(start) + (SESSION_STALE_MS / CLAUDE_WORK_MS) * RULES.xpPerActivity.claudeWork);
    });

    test('an event older than the last credited one is skipped', () => {
        const start = createGame(T0, () => 0);
        const state = credit(start, event({ event: 'tool_start', t: T0 + 1_000 }));
        assert.strictEqual(creditClaudeEvent(state, event({ event: 'prompt', t: T0 }), T0 + 1_000).state, state);
    });

    test('sessions are tracked separately and pruned once stale', () => {
        const start = createGame(T0, () => 0);
        const both = credit(start, event({ session: 'a', t: T0 }), event({ session: 'b', t: T0 + 1 }));
        assert.deepStrictEqual(Object.keys(both.claudeSessions).sort(), ['a', 'b']);
        const later = T0 + SESSION_STALE_MS + MINUTE;
        const pruned = creditClaudeEvent(both, event({ session: 'c', t: later }), later).state;
        assert.deepStrictEqual(Object.keys(pruned.claudeSessions), ['c']);
    });
});

suite('LineTailer', () => {
    let dir: string;
    let file: string;
    let tailer: LineTailer | undefined;

    setup(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digimon-tailer-'));
        file = path.join(dir, 'events.jsonl');
    });

    teardown(() => {
        tailer?.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function collect(): string[] {
        const lines: string[] = [];
        tailer = new LineTailer(file, value => lines.push(value), 20);
        return lines;
    }

    async function until(check: () => boolean): Promise<void> {
        for (let i = 0; i < 100 && !check(); i++) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    }

    test('skips history and reads appended lines', async () => {
        fs.writeFileSync(file, 'old\n');
        const lines = collect();
        fs.appendFileSync(file, 'a\nb\n');
        await until(() => lines.length >= 2);
        assert.deepStrictEqual(lines, ['a', 'b']);
    });

    test('waits for a partial line to be completed', async () => {
        fs.writeFileSync(file, '');
        const lines = collect();
        fs.appendFileSync(file, 'hel');
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.deepStrictEqual(lines, []);
        fs.appendFileSync(file, 'lo\n');
        await until(() => lines.length >= 1);
        assert.deepStrictEqual(lines, ['hello']);
    });

    test('picks up a file created after it starts', async () => {
        const lines = collect();
        fs.writeFileSync(file, 'first\n');
        await until(() => lines.length >= 1);
        assert.deepStrictEqual(lines, ['first']);
    });

    test('follows rotation to the new file', async () => {
        fs.writeFileSync(file, '');
        const lines = collect();
        fs.appendFileSync(file, 'before\n');
        await until(() => lines.length >= 1);
        fs.renameSync(file, `${file}.1`);
        fs.writeFileSync(file, 'after\n');
        await until(() => lines.length >= 2);
        assert.deepStrictEqual(lines, ['before', 'after']);
    });
});
