import {
    ActivityKind, FoodKind, PetEvent, PetState, activityEffort, chooseBranch, createEgg, feed, parseState, recordActivity, tick,
} from './pet';
import { Branch, LINES } from './species';

export const GAME_VERSION = 3;

export const ROSTER = {
    maxBuddies: 6,
    /** Lifetime effort per new egg; repeats forever. */
    effortPerEgg: 3_000,
    /** Bits earned per point of effort. */
    bitsPerEffort: 1,
    startingBits: 150,
    /** Sirloin refills both meters, so it costs as much as three single-stat foods. */
    foodPrices: { meat: 50, vitamin: 50, sirloin: 150 } as Record<FoodKind, number>,
};

export interface Buddy extends PetState {
    readonly id: string;
}

/** Everything the player owns. Only the active buddy lives in real time; the rest are frozen. */
export interface GameState {
    readonly version: typeof GAME_VERSION;
    readonly activeId: string;
    readonly buddies: readonly Buddy[];
    /** Money for food. Earned from effort, spent when buying food; evolution XP is never spent. */
    readonly bits: number;
    /** Eggs earned while the roster was full; one joins whenever a slot opens. */
    readonly pendingEggs: number;
    /** Lifetime base XP from all activity, whether or not the pet could use it. */
    readonly effort: number;
    /** Eggs granted so far from effort milestones. */
    readonly eggsGranted: number;
    readonly nextBuddyId: number;
}

export type GameEvent =
    | PetEvent
    | { kind: 'eggEarned'; waiting: boolean }
    | { kind: 'cannotAfford'; food: FoodKind }
    | { kind: 'switched'; id: string };

export interface GameUpdate {
    readonly state: GameState;
    readonly events: GameEvent[];
}

export function createGame(now: number,
    random: () => number = Math.random,
): GameState {
    return withFirstBuddy(createEgg(now, random), now);
}

/** Wrap a pre-roster (v1) pet as the first buddy of a new game. */
export function migrateFromPet(pet: PetState,
    now: number,
): GameState {
    return withFirstBuddy({ ...pet, lastTickAt: now }, now);
}

export function activeBuddy(game: GameState): Buddy {
    const buddy = game.buddies.find(candidate => candidate.id === game.activeId);
    if (!buddy) {
        throw new Error(`Active buddy ${game.activeId} is missing`);
    }
    return buddy;
}

/** How far lifetime effort is toward the next egg. */
export function eggProgress(game: GameState): { current: number; target: number } {
    return { current: game.effort % ROSTER.effortPerEgg, target: ROSTER.effortPerEgg };
}

export function tickGame(game: GameState,
    now: number,
): GameUpdate {
    const update = tick(activeBuddy(game), now);
    return { state: replaceActive(game, update.state), events: update.events };
}

export function recordGameActivity(game: GameState,
    kind: ActivityKind,
    now: number,
): GameUpdate {
    const active = activeBuddy(game);
    const effort = activityEffort(active, kind, now);
    const update = recordActivity(active, kind, now);
    if (update.state === active && effort === 0) {
        return { state: game, events: update.events };
    }
    const next = replaceActive({ ...game, effort: game.effort + effort, bits: game.bits + effort * ROSTER.bitsPerEffort }, update.state);
    const rewards = grantEggs(next, now);
    return { state: rewards.state, events: [...update.events, ...rewards.events] };
}

/** Buy one food and feed it to the active buddy. Nothing is charged if the buddy refuses it. */
export function feedGame(game: GameState,
    food: FoodKind,
): GameUpdate {
    const price = ROSTER.foodPrices[food];
    if (game.bits < price) {
        return { state: game, events: [{ kind: 'cannotAfford', food }] };
    }
    const update = feed(activeBuddy(game), food);
    if (update.state === activeBuddy(game)) {
        return { state: game, events: update.events };
    }
    return { state: replaceActive({ ...game, bits: game.bits - price }, update.state), events: update.events };
}

export function chooseGameBranch(game: GameState,
    branch: Branch,
): GameUpdate {
    const update = chooseBranch(activeBuddy(game), branch);
    return { state: update.state === activeBuddy(game) ? game : replaceActive(game, update.state), events: update.events };
}

/** Make another buddy active. The outgoing one freezes as-is; the incoming one resumes from now. */
export function switchBuddy(game: GameState,
    id: string,
    now: number,
): GameUpdate {
    const target = game.buddies.find(buddy => buddy.id === id);
    if (!target || id === game.activeId) {
        return { state: game, events: [] };
    }
    const settled = tickGame(game, now);
    const resumed: Buddy = { ...target, lastTickAt: now, lastActivityAt: now };
    return {
        state: {
            ...settled.state,
            activeId: id,
            buddies: settled.state.buddies.map(buddy => buddy.id === id ? resumed : buddy),
        },
        events: [...settled.events, { kind: 'switched', id }],
    };
}

/** Permanently remove a buddy other than the active one; a waiting egg takes its slot. */
export function releaseBuddy(game: GameState,
    id: string,
    now: number,
    random: () => number = Math.random,
): GameUpdate {
    if (id === game.activeId || !game.buddies.some(buddy => buddy.id === id)) {
        return { state: game, events: [] };
    }
    const next = { ...game, buddies: game.buddies.filter(buddy => buddy.id !== id) };
    return { state: game.pendingEggs > 0 ? hatchPendingEgg(next, now, random) : next, events: [] };
}

/**
 * Accept a well-formed game whose active buddy exists, keeping only known fields.
 * Version 2 saves held food items from milestones; they are refunded as bits at today's prices.
 */
export function parseGame(raw: unknown): GameState | undefined {
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const candidate = raw as Record<string, unknown>;
    if ((candidate.version !== GAME_VERSION && candidate.version !== 2)
        || !Array.isArray(candidate.buddies) || typeof candidate.activeId !== 'string') {
        return undefined;
    }
    const buddies = candidate.buddies.map((buddy: unknown) => {
        const pet = parseState(buddy);
        const id = (buddy as { id?: unknown } | null)?.id;
        return pet && typeof id === 'string' ? { ...pet, id } : undefined;
    });
    const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    if (!buddies.every(buddy => buddy !== undefined) || !buddies.some(buddy => buddy!.id === candidate.activeId)
        || !finite(candidate.pendingEggs) || !finite(candidate.effort) || !finite(candidate.nextBuddyId)) {
        return undefined;
    }
    const money = candidate.version === 2 ? refundV2(candidate) : { bits: candidate.bits, eggsGranted: candidate.eggsGranted };
    if (!money || !finite(money.bits) || !finite(money.eggsGranted)) {
        return undefined;
    }
    return {
        version: GAME_VERSION,
        activeId: candidate.activeId,
        buddies: buddies as Buddy[],
        bits: money.bits,
        pendingEggs: candidate.pendingEggs,
        effort: candidate.effort,
        eggsGranted: money.eggsGranted,
        nextBuddyId: candidate.nextBuddyId,
    };
}

function refundV2(save: Record<string, unknown>): { bits: unknown; eggsGranted: unknown } | undefined {
    const food = save.food as Record<string, unknown> | undefined;
    const granted = save.granted as Record<string, unknown> | undefined;
    const kinds = Object.keys(ROSTER.foodPrices) as FoodKind[];
    if (!food || !granted || !kinds.every(kind => Number.isFinite(food[kind]))) {
        return undefined;
    }
    return {
        bits: kinds.reduce((total, kind) => total + (food[kind] as number) * ROSTER.foodPrices[kind], 0),
        eggsGranted: granted.egg,
    };
}

function withFirstBuddy(pet: PetState,
    now: number,
): GameState {
    const first: Buddy = { ...pet, id: 'b1' };
    return {
        version: GAME_VERSION,
        activeId: first.id,
        buddies: [first],
        bits: ROSTER.startingBits,
        pendingEggs: 0,
        effort: 0,
        eggsGranted: 0,
        nextBuddyId: 2,
    };
}

function replaceActive(game: GameState,
    pet: PetState,
): GameState {
    return {
        ...game,
        buddies: game.buddies.map(buddy => buddy.id === game.activeId ? { ...pet, id: buddy.id } : buddy),
    };
}

function grantEggs(game: GameState,
    now: number,
): GameUpdate {
    const events: GameEvent[] = [];
    let next = game;
    const due = Math.floor(next.effort / ROSTER.effortPerEgg) - next.eggsGranted;
    for (let i = 0; i < due; i++) {
        const waiting = next.buddies.length >= ROSTER.maxBuddies;
        next = waiting ? { ...next, pendingEggs: next.pendingEggs + 1 } : addEgg(next, now);
        events.push({ kind: 'eggEarned', waiting });
    }
    return { state: due > 0 ? { ...next, eggsGranted: next.eggsGranted + due } : next, events };
}

function hatchPendingEgg(game: GameState,
    now: number,
    random: () => number,
): GameState {
    return addEgg({ ...game, pendingEggs: game.pendingEggs - 1 }, now, random);
}

/** New eggs prefer lines the player does not already have. */
function addEgg(game: GameState,
    now: number,
    random: () => number = Math.random,
): GameState {
    const owned = new Set(game.buddies.map(buddy => buddy.lineId));
    const fresh = LINES.map(line => line.id).filter(id => !owned.has(id));
    const egg: Buddy = { ...createEgg(now, random, fresh.length > 0 ? fresh : undefined), id: `b${game.nextBuddyId}` };
    return { ...game, buddies: [...game.buddies, egg], nextBuddyId: game.nextBuddyId + 1 };
}
