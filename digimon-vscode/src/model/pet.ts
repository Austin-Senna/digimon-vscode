import { Branch, LINES, STAGES, Stage, findLine, speciesFor } from './species';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const RULES = {
    /**
     * Reaching level L takes 15 * (L - 1)^2 total XP, so each level costs a little more than the last and levels
     * never run out. At roughly 300 XP per active hour: Lv 10 in ~4 hours, Lv 25 in ~a week, Lv 50 in ~a month.
     */
    xpPerLevelUnit: 15,
    /** Level at which each stage evolves. A Child at its level waits for the player to choose its path. */
    evolveAtLevel: {
        digitama: 2,
        babyI: 4,
        babyII: 10,
        child: 25,
        adult: 35,
        perfect: 50,
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
    /**
     * XP per rewarded activity. `claudeMinute` is one minute of a Claude session working in this workspace;
     * `save` only counts when the file had unsaved changes (checked by the caller).
     */
    xpPerActivity: { edit: 3, save: 5, commit: 10, prompt: 3, claudeMinute: 2 } as Record<ActivityKind, number>,
    /** Minimum gap between rewards of the same kind, so mashing keys, saves, or empty commits earns nothing extra. */
    cooldownMs: { edit: 30 * SECOND, save: MINUTE, commit: 5 * MINUTE } as Record<CooldownKind, number>,
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
    /** Last time each cooldown-limited activity earned XP. */
    readonly lastEditXpAt: number;
    readonly lastSaveXpAt: number;
    readonly lastCommitXpAt: number;
}

/** `prompt` and `claudeMinute` come from Claude Code sessions working in this workspace. */
export type ActivityKind = 'edit' | 'save' | 'commit' | 'prompt' | 'claudeMinute';

export type CooldownKind = 'edit' | 'save' | 'commit';

const COOLDOWN_FIELDS: Record<CooldownKind, 'lastEditXpAt' | 'lastSaveXpAt' | 'lastCommitXpAt'> = {
    edit: 'lastEditXpAt',
    save: 'lastSaveXpAt',
    commit: 'lastCommitXpAt',
};

/** The state field recording when `kind` last earned XP, or undefined for activities with no cooldown. */
function cooldownField(kind: ActivityKind) {
    return kind in COOLDOWN_FIELDS ? COOLDOWN_FIELDS[kind as CooldownKind] : undefined;
}

function onCooldown(state: PetState,
    kind: ActivityKind,
    now: number,
): boolean {
    const field = cooldownField(kind);
    return field !== undefined && now - state[field] < RULES.cooldownMs[kind as CooldownKind];
}

export type PetEvent =
    | { kind: 'evolved'; from: string; to: string; stage: Stage }
    | { kind: 'ate' }
    | { kind: 'refused' }
    | { kind: 'starving' }
    | { kind: 'readyToChoose' }
    | { kind: 'leveledUp'; level: number }
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
        lastSaveXpAt: 0,
        lastCommitXpAt: 0,
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

/** Total XP needed to reach `level`. */
export function xpForLevel(level: number): number {
    return RULES.xpPerLevelUnit * (level - 1) ** 2;
}

/** Current level from total XP; starts at 1 and has no cap. */
export function levelOf(xp: number): number {
    return Math.floor(Math.sqrt(Math.max(0, xp) / RULES.xpPerLevelUnit)) + 1;
}

/** Level at which the current stage evolves, or null once it is Ultimate. */
export function nextEvolutionLevel(state: PetState): number | null {
    return state.stage === 'ultimate' ? null : RULES.evolveAtLevel[state.stage];
}

/** A Child at its evolution level waits for the player to pick its Adult path instead of evolving on its own. */
export function isReadyToChoose(state: PetState): boolean {
    return state.stage === 'child' && levelOf(state.xp) >= RULES.evolveAtLevel.child && state.fullness > 0;
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

/** Advance real time: hunger while awake, energy recovery while asleep, evolution. */
export function tick(state: PetState,
    now: number,
): Update {
    const elapsed = Math.max(0, Math.min(now - state.lastTickAt, RULES.maxTickGapMs));
    const minutes = elapsed / MINUTE;
    const events: PetEvent[] = [];
    let next: PetState = { ...state, lastTickAt: now, ageMs: state.ageMs + elapsed };

    if (next.stage !== 'digitama') {
        if (isAsleep(next, now)) {
            // Asleep: it rests instead of getting hungry, so an idle VS Code left open never starves it.
            next = { ...next, energy: Math.min(RULES.maxEnergy, next.energy + RULES.energyRegenPerMinuteAsleep * minutes) };
        } else {
            const fullness = Math.max(0, next.fullness - RULES.fullnessDecayPerMinute * minutes);
            if (fullness <= 0 && state.fullness > 0) {
                events.push({ kind: 'starving' });
            }
            next = { ...next, fullness };
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
    if (onCooldown(state, kind, now)) {
        if (events.length === 0) {
            return { state, events };
        }
        return { state: { ...state, lastActivityAt: now }, events };
    }

    let next: PetState = { ...state, lastActivityAt: now };
    const field = cooldownField(kind);
    if (field) {
        next = { ...next, [field]: now };
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
    if (levelOf(next.xp) > levelOf(state.xp)) {
        events.push({ kind: 'leveledUp', level: levelOf(next.xp) });
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
 * Base XP an activity is worth before hunger or exhaustion, or 0 while on cooldown.
 * Drives bits and eggs, so a starving pet can still earn its way back to food.
 */
export function activityEffort(state: PetState,
    kind: ActivityKind,
    now: number,
): number {
    return onCooldown(state, kind, now) ? 0 : RULES.xpPerActivity[kind];
}

const NUMBER_FIELDS = ['xp', 'fullness', 'energy', 'ageMs', 'bornAt', 'lastTickAt', 'lastActivityAt', 'lastEditXpAt'] as const;
/** Added after the first release; older saves read them as never used. */
const OPTIONAL_NUMBER_FIELDS = ['lastSaveXpAt', 'lastCommitXpAt'] as const;

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
    OPTIONAL_NUMBER_FIELDS.forEach(key => state[key] = Number.isFinite(candidate[key]) ? candidate[key] : 0);
    return state as unknown as PetState;
}

/** Automatic evolution for every stage except Child, which waits for `chooseBranch`. */
function evolve(state: PetState): Update {
    const level = nextEvolutionLevel(state);
    if (level === null || levelOf(state.xp) < level || state.fullness <= 0 || state.stage === 'child') {
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
