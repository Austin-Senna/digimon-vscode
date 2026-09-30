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
    /** Below this fullness the pet reads as hungry. */
    hungryBelow: 25,
    /** A full stomach lasts 100 minutes; one meat buys 25. */
    fullnessDecayPerMinute: 1,
    energyCostPerXp: 0.05,
    energyRegenPerMinuteAsleep: 2,
    /** No activity for this long and the pet falls asleep. */
    sleepAfterMs: 5 * MINUTE,
    /** Time only advances while VS Code is open; longer gaps between ticks are clamped to this. */
    maxTickGapMs: 5 * MINUTE,
    /** Edits earn at most one XP per active second. */
    activeSecondCooldownMs: SECOND,
    /** `claudeMinute` is one minute of a Claude session working in this workspace. */
    xpPerActivity: { edit: 1, save: 5, commit: 25, prompt: 3, claudeMinute: 2 } as Record<ActivityKind, number>,
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
    /** Time VS Code has been open with this pet. */
    readonly ageMs: number;
    readonly bornAt: number;
    readonly lastTickAt: number;
    readonly lastActivityAt: number;
    /** Last time an edit earned XP. */
    readonly lastEditXpAt: number;
}

/** `prompt` and `claudeMinute` come from Claude Code sessions working in this workspace. */
export type ActivityKind = 'edit' | 'save' | 'commit' | 'prompt' | 'claudeMinute';

const ACTIVE_SECOND_KINDS: ReadonlySet<ActivityKind> = new Set<ActivityKind>(['edit']);

export type PetEvent =
    | { kind: 'evolved'; from: string; to: string; stage: Stage }
    | { kind: 'ate' }
    | { kind: 'refused' }
    | { kind: 'starving' }
    | { kind: 'readyToChoose' }
    | { kind: 'exhausted' }
    | { kind: 'woke' };

export interface Update {
    readonly state: PetState;
    readonly events: PetEvent[];
}

export type FoodKind = 'meat' | 'vitamin' | 'sirloin';

export const FOODS: Record<FoodKind, { readonly name: string; readonly fullness: number; readonly energy: number }> = {
    meat: { name: 'Meat', fullness: 25, energy: 0 },
    vitamin: { name: 'Vitamin', fullness: 0, energy: 40 },
    sirloin: { name: 'Sirloin', fullness: 100, energy: 100 },
};

export type Mood = 'sleeping' | 'starving' | 'exhausted' | 'hungry' | 'happy';

export function createEgg(now: number,
    random: () => number = Math.random,
    lineIds: readonly string[] = LINES.map(line => line.id),
): PetState {
    return {
        version: STATE_VERSION,
        lineId: lineIds[Math.floor(random() * lineIds.length)],
        stage: 'digitama',
        branch: null,
        xp: 0,
        fullness: RULES.maxFullness,
        energy: RULES.maxEnergy,
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
    if (state.fullness < RULES.hungryBelow) {
        return 'hungry';
    }
    return 'happy';
}

/** XP needed to leave the current stage, or null at the final stage. */
export function xpForNextStage(state: PetState): number | null {
    return state.stage === 'ultimate' ? null : RULES.xpToEvolve[state.stage];
}

/** A Child with enough XP waits for the player to pick its Adult path instead of evolving on its own. */
export function isReadyToChoose(state: PetState): boolean {
    return state.stage === 'child' && state.xp >= RULES.xpToEvolve.child && state.fullness > 0;
}

/** Evolve a waiting Child into the chosen Adult; the branch then fixes its Perfect and Ultimate forms. */
export function chooseBranch(state: PetState,
    branch: Branch,
): Update {
    if (!isReadyToChoose(state)) {
        return { state, events: [] };
    }
    const next: PetState = { ...state, stage: 'adult', branch };
    return { state: next, events: [{ kind: 'evolved', from: species(state), to: species(next), stage: 'adult' }] };
}

/** Advance real time: hunger, sleep, energy recovery, evolution. */
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
    if (isReadyToChoose(next) && !isReadyToChoose(state)) {
        events.push({ kind: 'readyToChoose' });
    }
    const evolution = evolve(next);
    return { state: evolution.state, events: [...events, ...evolution.events] };
}

/** Eat one food. Refused (and not consumed) by eggs, or when the food would change nothing. */
export function feed(state: PetState,
    food: FoodKind,
): Update {
    const { fullness, energy } = FOODS[food];
    const helps = (fullness > 0 && state.fullness < RULES.maxFullness) || (energy > 0 && state.energy < RULES.maxEnergy);
    if (state.stage === 'digitama' || !helps) {
        return { state, events: [{ kind: 'refused' }] };
    }
    return {
        state: {
            ...state,
            fullness: Math.min(RULES.maxFullness, state.fullness + fullness),
            energy: Math.min(RULES.maxEnergy, state.energy + energy),
        },
        events: [{ kind: 'ate' }],
    };
}

/**
 * Base XP an activity is worth before hunger or exhaustion, or 0 when throttled.
 * Drives food and egg milestones, so a starving pet can still earn its way back to food.
 */
export function activityEffort(state: PetState,
    kind: ActivityKind,
    now: number,
): number {
    const throttled = ACTIVE_SECOND_KINDS.has(kind) && now - state.lastEditXpAt < RULES.activeSecondCooldownMs;
    return throttled ? 0 : RULES.xpPerActivity[kind];
}

const NUMBER_FIELDS = ['xp', 'fullness', 'energy', 'ageMs', 'bornAt', 'lastTickAt', 'lastActivityAt', 'lastEditXpAt'] as const;

/**
 * Accept only a well-formed state for a line that still exists, keeping just the known fields.
 * Older saves may carry removed fields (care mistakes) or the removed Numemon branch, which reads as the dark path.
 */
export function parseState(raw: unknown): PetState | undefined {
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const candidate = raw as Record<string, unknown>;
    const branch = candidate.branch === 'neglected' ? 'bad' : candidate.branch;
    const valid = candidate.version === STATE_VERSION
        && typeof candidate.lineId === 'string' && findLine(candidate.lineId) !== undefined
        && typeof candidate.stage === 'string' && (STAGES as readonly string[]).includes(candidate.stage)
        && (branch === null || branch === 'good' || branch === 'bad')
        && NUMBER_FIELDS.every(key => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]));
    if (!valid) {
        return undefined;
    }
    const state: Record<string, unknown> = { version: STATE_VERSION, lineId: candidate.lineId, stage: candidate.stage, branch };
    NUMBER_FIELDS.forEach(key => state[key] = candidate[key]);
    return state as unknown as PetState;
}

/** Automatic evolution for every stage except Child, which waits for `chooseBranch`. */
function evolve(state: PetState): Update {
    const threshold = xpForNextStage(state);
    if (threshold === null || state.xp < threshold || state.fullness <= 0 || state.stage === 'child') {
        return { state, events: [] };
    }
    const next: PetState = { ...state, stage: STAGES[STAGES.indexOf(state.stage) + 1] };
    return { state: next, events: [{ kind: 'evolved', from: species(state), to: species(next), stage: next.stage }] };
}

function lineOf(state: PetState) {
    const line = findLine(state.lineId);
    if (!line) {
        throw new Error(`Unknown evolution line: ${state.lineId}`);
    }
    return line;
}
