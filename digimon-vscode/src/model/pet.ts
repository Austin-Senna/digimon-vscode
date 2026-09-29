import { Branch, LINES, STAGES, Stage, findLine, speciesFor } from './species';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const RULES = {
    /** Cumulative XP needed to leave each stage. */
    xpToEvolve: {
        digitama: 30,
        babyI: 300,
        babyII: 1_500,
        child: 6_000,
        adult: 20_000,
        perfect: 50_000,
    } as Record<Exclude<Stage, 'ultimate'>, number>,
    maxFullness: 100,
    maxEnergy: 100,
    foodValue: 25,
    fullnessDecayPerMinute: 0.5,
    energyCostPerXp: 0.05,
    energyRegenPerMinuteAsleep: 2,
    /** No activity for this long and the pet falls asleep. */
    sleepAfterMs: 5 * MINUTE,
    /** Time only advances while VS Code is open; longer gaps between ticks are clamped to this. */
    maxTickGapMs: 5 * MINUTE,
    /** Staying starved this long counts as another care mistake. */
    starvingMistakeIntervalMs: 60 * MINUTE,
    /** Care mistakes at Child -> Adult: at most this many takes the good branch. */
    maxMistakesForGood: 2,
    /** At most this many takes the bad branch; more is neglect. */
    maxMistakesForBad: 5,
    /** Edits and Claude tool calls share one budget: at most one XP per active second. */
    activeSecondCooldownMs: SECOND,
    xpPerActivity: { edit: 1, save: 5, commit: 25, prompt: 3, agentTool: 1 } as Record<ActivityKind, number>,
    exhaustedXpMultiplier: 0.5,
};

export const STATE_VERSION = 1;

export interface PetState {
    readonly version: typeof STATE_VERSION;
    readonly lineId: string;
    readonly stage: Stage;
    readonly branch: Branch | null;
    readonly xp: number;
    readonly fullness: number;
    readonly energy: number;
    readonly careMistakes: number;
    /** Starved time not yet counted as a care mistake. */
    readonly starvingMs: number;
    /** Time VS Code has been open with this pet. */
    readonly ageMs: number;
    readonly bornAt: number;
    readonly lastTickAt: number;
    readonly lastActivityAt: number;
    /** Last time an active-second activity (edit or Claude tool call) earned XP. */
    readonly lastEditXpAt: number;
}

/** `prompt` and `agentTool` come from Claude Code sessions working in this workspace. */
export type ActivityKind = 'edit' | 'save' | 'commit' | 'prompt' | 'agentTool';

const ACTIVE_SECOND_KINDS: ReadonlySet<ActivityKind> = new Set<ActivityKind>(['edit', 'agentTool']);

export type PetEvent =
    | { kind: 'evolved'; from: string; to: string; stage: Stage }
    | { kind: 'ate' }
    | { kind: 'refused' }
    | { kind: 'starving' }
    | { kind: 'careMistake'; total: number }
    | { kind: 'exhausted' }
    | { kind: 'woke' };

export interface Update {
    readonly state: PetState;
    readonly events: PetEvent[];
}

export type Mood = 'sleeping' | 'starving' | 'exhausted' | 'hungry' | 'happy';

export function createEgg(now: number,
    random: () => number = Math.random,
): PetState {
    const line = LINES[Math.floor(random() * LINES.length)];
    return {
        version: STATE_VERSION,
        lineId: line.id,
        stage: 'digitama',
        branch: null,
        xp: 0,
        fullness: RULES.maxFullness,
        energy: RULES.maxEnergy,
        careMistakes: 0,
        starvingMs: 0,
        ageMs: 0,
        bornAt: now,
        lastTickAt: now,
        lastActivityAt: now,
        lastEditXpAt: 0,
    };
}

export function species(state: PetState): string {
    return speciesFor(lineOf(state), state.stage, state.branch);
}

export function isAsleep(state: PetState,
    now: number,
): boolean {
    return state.stage !== 'digitama' && now - state.lastActivityAt >= RULES.sleepAfterMs;
}

export function mood(state: PetState,
    now: number,
): Mood {
    if (isAsleep(state, now)) {
        return 'sleeping';
    }
    if (state.fullness <= 0) {
        return 'starving';
    }
    if (state.energy <= 0) {
        return 'exhausted';
    }
    if (state.fullness < RULES.foodValue) {
        return 'hungry';
    }
    return 'happy';
}

/** XP needed to leave the current stage, or null at the final stage. */
export function xpForNextStage(state: PetState): number | null {
    return state.stage === 'ultimate' ? null : RULES.xpToEvolve[state.stage];
}

/** Advance real time: hunger, sleep, energy recovery, care mistakes, evolution. */
export function tick(state: PetState,
    now: number,
): Update {
    const elapsed = Math.max(0, Math.min(now - state.lastTickAt, RULES.maxTickGapMs));
    const minutes = elapsed / MINUTE;
    const events: PetEvent[] = [];
    let next: PetState = { ...state, lastTickAt: now, ageMs: state.ageMs + elapsed };

    if (next.stage !== 'digitama') {
        const fullness = Math.max(0, next.fullness - RULES.fullnessDecayPerMinute * minutes);
        if (fullness <= 0 && state.fullness > 0) {
            events.push({ kind: 'starving' });
            next = { ...next, careMistakes: next.careMistakes + 1, starvingMs: 0 };
            events.push({ kind: 'careMistake', total: next.careMistakes });
        } else if (fullness <= 0) {
            const starvingMs = next.starvingMs + elapsed;
            if (starvingMs >= RULES.starvingMistakeIntervalMs) {
                next = { ...next, careMistakes: next.careMistakes + 1, starvingMs: starvingMs - RULES.starvingMistakeIntervalMs };
                events.push({ kind: 'careMistake', total: next.careMistakes });
            } else {
                next = { ...next, starvingMs };
            }
        }
        next = { ...next, fullness };

        if (isAsleep(next, now)) {
            next = { ...next, energy: Math.min(RULES.maxEnergy, next.energy + RULES.energyRegenPerMinuteAsleep * minutes) };
        }
    }

    const evolution = evolve(next);
    return { state: evolution.state, events: [...events, ...evolution.events] };
}

/** Credit coding activity, evolving immediately if it crosses a threshold. Returns the same state object when nothing changed. */
export function recordActivity(state: PetState,
    kind: ActivityKind,
    now: number,
): Update {
    const events: PetEvent[] = [];
    if (isAsleep(state, now)) {
        events.push({ kind: 'woke' });
    }
    const throttled = ACTIVE_SECOND_KINDS.has(kind);
    if (throttled && now - state.lastEditXpAt < RULES.activeSecondCooldownMs) {
        if (events.length === 0) {
            return { state, events };
        }
        return { state: { ...state, lastActivityAt: now }, events };
    }

    let next: PetState = { ...state, lastActivityAt: now };
    if (throttled) {
        next = { ...next, lastEditXpAt: now };
    }

    if (state.fullness > 0) {
        const baseXp = RULES.xpPerActivity[kind];
        const xp = state.energy > 0 ? baseXp : baseXp * RULES.exhaustedXpMultiplier;
        const energy = Math.max(0, state.energy - xp * RULES.energyCostPerXp);
        if (energy <= 0 && state.energy > 0) {
            events.push({ kind: 'exhausted' });
        }
        next = { ...next, xp: state.xp + xp, energy };
    }
    const evolution = evolve(next);
    return { state: evolution.state, events: [...events, ...evolution.events] };
}

export function feed(state: PetState): Update {
    if (state.stage === 'digitama' || state.fullness >= RULES.maxFullness) {
        return { state, events: [{ kind: 'refused' }] };
    }
    return {
        state: { ...state, fullness: Math.min(RULES.maxFullness, state.fullness + RULES.foodValue), starvingMs: 0 },
        events: [{ kind: 'ate' }],
    };
}

/** Accept only a well-formed state for a line that still exists. */
export function parseState(raw: unknown): PetState | undefined {
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const candidate = raw as Partial<PetState>;
    const numbers: (keyof PetState)[] = [
        'xp', 'fullness', 'energy', 'careMistakes', 'starvingMs', 'ageMs', 'bornAt', 'lastTickAt', 'lastActivityAt', 'lastEditXpAt',
    ];
    const valid = candidate.version === STATE_VERSION
        && typeof candidate.lineId === 'string' && findLine(candidate.lineId) !== undefined
        && typeof candidate.stage === 'string' && STAGES.includes(candidate.stage)
        && (candidate.branch === null || candidate.branch === 'good' || candidate.branch === 'bad' || candidate.branch === 'neglected')
        && numbers.every(key => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]));
    return valid ? candidate as PetState : undefined;
}

function evolve(state: PetState): Update {
    const threshold = xpForNextStage(state);
    if (threshold === null || state.xp < threshold || state.fullness <= 0) {
        return { state, events: [] };
    }
    const stage = STAGES[STAGES.indexOf(state.stage) + 1];
    const branch = stage === 'adult' ? branchFor(state.careMistakes) : state.branch;
    const next: PetState = { ...state, stage, branch };
    return { state: next, events: [{ kind: 'evolved', from: species(state), to: species(next), stage }] };
}

function branchFor(careMistakes: number): Branch {
    if (careMistakes <= RULES.maxMistakesForGood) {
        return 'good';
    }
    return careMistakes <= RULES.maxMistakesForBad ? 'bad' : 'neglected';
}

function lineOf(state: PetState) {
    const line = findLine(state.lineId);
    if (!line) {
        throw new Error(`Unknown evolution line: ${state.lineId}`);
    }
    return line;
}
