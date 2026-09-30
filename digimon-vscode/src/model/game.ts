import {
    ActivityKind, FoodKind, PetEvent, PetState, activityEffort, createEgg, feed, parseState, recordActivity, tick,
} from './pet';
import { LINES } from './species';

export const GAME_VERSION = 2;

export const ROSTER = {
    maxBuddies: 6,
    /** Lifetime effort per milestone reward. Milestones repeat: every 250 effort drops another meat, and so on. */
    milestones: { meat: 250, vitamin: 1_000, sirloin: 2_500, egg: 3_000 } as Record<Milestone, number>,
    startingFood: { meat: 3, vitamin: 0, sirloin: 0 } as Record<FoodKind, number>,
};

export type Milestone = FoodKind | 'egg';

export interface Buddy extends PetState {
    readonly id: string;
}

/** Everything the player owns. Only the active buddy lives in real time; the rest are frozen. */
export interface GameState {
    readonly version: typeof GAME_VERSION;
    readonly activeId: string;
    readonly buddies: readonly Buddy[];
    readonly food: Readonly<Record<FoodKind, number>>;
    /** Eggs earned while the roster was full; one joins whenever a slot opens. */
    readonly pendingEggs: number;
    /** Lifetime base XP from all activity, whether or not the pet could use it. */
    readonly effort: number;
    /** How many of each milestone reward has been granted so far. */
    readonly granted: Readonly<Record<Milestone, number>>;
    readonly nextBuddyId: number;
}

export type GameEvent =
    | PetEvent
    | { kind: 'foodEarned'; food: FoodKind }
    | { kind: 'eggEarned'; waiting: boolean }
    | { kind: 'noFood'; food: FoodKind }
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

/** How far lifetime effort is into the current cycle of a milestone. */
export function milestoneProgress(game: GameState,
    milestone: Milestone,
): { current: number; target: number } {
    const target = ROSTER.milestones[milestone];
    return { current: game.effort % target, target };
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
    const next = replaceActive({ ...game, effort: game.effort + effort }, update.state);
    const rewards = grantMilestones(next, now);
    return { state: rewards.state, events: [...update.events, ...rewards.events] };
}

export function feedGame(game: GameState,
    food: FoodKind,
): GameUpdate {
    if (game.food[food] <= 0) {
        return { state: game, events: [{ kind: 'noFood', food }] };
    }
    const update = feed(activeBuddy(game), food);
    if (update.state === activeBuddy(game)) {
        return { state: game, events: update.events };
    }
    const next = { ...game, food: { ...game.food, [food]: game.food[food] - 1 } };
    return { state: replaceActive(next, update.state), events: update.events };
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

/** Accept only a well-formed v2 game whose active buddy exists. */
export function parseGame(raw: unknown): GameState | undefined {
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const candidate = raw as Partial<GameState>;
    if (candidate.version !== GAME_VERSION || !Array.isArray(candidate.buddies) || typeof candidate.activeId !== 'string') {
        return undefined;
    }
    const buddiesValid = candidate.buddies.every(buddy => typeof buddy?.id === 'string' && parseState(buddy) !== undefined);
    const counts = (value: unknown, keys: readonly string[]) => typeof value === 'object' && value !== null
        && keys.every(key => Number.isFinite((value as Record<string, unknown>)[key]));
    const valid = buddiesValid
        && candidate.buddies.some(buddy => buddy.id === candidate.activeId)
        && counts(candidate.food, Object.keys(ROSTER.startingFood))
        && counts(candidate.granted, Object.keys(ROSTER.milestones))
        && Number.isFinite(candidate.pendingEggs)
        && Number.isFinite(candidate.effort)
        && Number.isFinite(candidate.nextBuddyId);
    return valid ? candidate as GameState : undefined;
}

function withFirstBuddy(pet: PetState,
    now: number,
): GameState {
    const first: Buddy = { ...pet, id: 'b1' };
    return {
        version: GAME_VERSION,
        activeId: first.id,
        buddies: [first],
        food: { ...ROSTER.startingFood },
        pendingEggs: 0,
        effort: 0,
        granted: { meat: 0, vitamin: 0, sirloin: 0, egg: 0 },
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

function grantMilestones(game: GameState,
    now: number,
): GameUpdate {
    const events: GameEvent[] = [];
    let next = game;
    for (const milestone of Object.keys(ROSTER.milestones) as Milestone[]) {
        const due = Math.floor(next.effort / ROSTER.milestones[milestone]) - next.granted[milestone];
        for (let i = 0; i < due; i++) {
            if (milestone === 'egg') {
                const waiting = next.buddies.length >= ROSTER.maxBuddies;
                next = waiting ? { ...next, pendingEggs: next.pendingEggs + 1 } : addEgg(next, now);
                events.push({ kind: 'eggEarned', waiting });
            } else {
                next = { ...next, food: { ...next.food, [milestone]: next.food[milestone] + 1 } };
                events.push({ kind: 'foodEarned', food: milestone });
            }
        }
        if (due > 0) {
            next = { ...next, granted: { ...next.granted, [milestone]: next.granted[milestone] + due } };
        }
    }
    return { state: next, events };
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
