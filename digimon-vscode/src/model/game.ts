import {
    ActivityKind, FoodKind, PetEvent, PetState, activityEffort, chooseBranch, createEgg, feed, parseState, recordActivity, tick,
} from './pet';
import { Branch, LINES } from './species';

export const GAME_VERSION = 4;

export const ROSTER = {
    maxBuddies: 6,
    /** How many different lines each earned egg lets the player choose between. */
    eggChoices: 2,
    /** Lifetime effort per new egg (about one active day); repeats forever. */
    effortPerEgg: 1_500,
    /** Bits earned per point of effort. */
    bitsPerEffort: 1,
    startingBits: 150,
    /** Sirloin refills both meters, so it costs as much as three single-stat foods. */
    foodPrices: { meat: 50, vitamin: 50, sirloin: 150 } as Record<FoodKind, number>,
};

export interface Buddy extends PetState {
    readonly id: string;
}

/** Line ids to choose between for one earned egg. */
export type EggOffer = readonly string[];

/** Everything the player owns. Only the active buddy lives in real time; the rest are frozen. */
export interface GameState {
    readonly version: typeof GAME_VERSION;
    readonly activeId: string;
    readonly buddies: readonly Buddy[];
    /** Money for food. Earned from effort, spent when buying food; evolution XP is never spent. */
    readonly bits: number;
    /** Earned eggs waiting for the player to pick one of two lines, oldest first. */
    readonly eggOffers: readonly EggOffer[];
    /** Lifetime base XP from all activity, whether or not the pet could use it. */
    readonly effort: number;
    /** Eggs granted so far from effort milestones. */
    readonly eggsGranted: number;
    readonly nextBuddyId: number;
}

export type GameEvent =
    | PetEvent
    | { kind: 'eggOffered' }
    | { kind: 'eggChosen'; lineId: string }
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
    const rewards = grantEggs(next);
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

/** Permanently remove a buddy other than the active one, freeing a slot for a waiting egg. */
export function releaseBuddy(game: GameState,
    id: string,
): GameUpdate {
    if (id === game.activeId || !game.buddies.some(buddy => buddy.id === id)) {
        return { state: game, events: [] };
    }
    return { state: { ...game, buddies: game.buddies.filter(buddy => buddy.id !== id) }, events: [] };
}

export function isPartyFull(game: GameState): boolean {
    return game.buddies.length >= ROSTER.maxBuddies;
}

/** Take the egg of `lineId` from the oldest offer. Needs a free slot; the egg joins the party but does not become active. */
export function chooseEgg(game: GameState,
    lineId: string,
    now: number,
): GameUpdate {
    const [offer, ...rest] = game.eggOffers;
    if (!offer || !offer.includes(lineId) || isPartyFull(game)) {
        return { state: game, events: [] };
    }
    const egg: Buddy = { ...createEgg(now, () => 0, [lineId]), id: `b${game.nextBuddyId}` };
    return {
        state: { ...game, eggOffers: rest, buddies: [...game.buddies, egg], nextBuddyId: game.nextBuddyId + 1 },
        events: [{ kind: 'eggChosen', lineId }],
    };
}

/** Two different lines for an egg offer, preferring lines the player does not own yet. */
export function eggOffer(ownedLineIds: readonly string[],
    random: () => number = Math.random,
): EggOffer {
    const owned = new Set(ownedLineIds);
    const fresh = LINES.map(line => line.id).filter(id => !owned.has(id));
    // Draw without replacement so the result is always distinct, whatever the random source returns.
    const pool = [...(fresh.length >= ROSTER.eggChoices ? fresh : LINES.map(line => line.id))];
    const picks: string[] = [];
    while (picks.length < ROSTER.eggChoices && pool.length > 0) {
        picks.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    }
    return picks;
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
    if (typeof candidate.version !== 'number' || candidate.version < 2 || candidate.version > GAME_VERSION
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
        || !finite(candidate.effort) || !finite(candidate.nextBuddyId)) {
        return undefined;
    }
    const eggOffers = candidate.version >= 4 ? parseOffers(candidate.eggOffers) : pendingEggsAsOffers(candidate, buddies as Buddy[]);
    if (!eggOffers) {
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
        eggOffers,
        effort: candidate.effort,
        eggsGranted: money.eggsGranted,
        nextBuddyId: candidate.nextBuddyId,
    };
}

function parseOffers(raw: unknown): EggOffer[] | undefined {
    const known = new Set(LINES.map(line => line.id));
    const valid = Array.isArray(raw) && raw.every(offer => Array.isArray(offer) && offer.length > 0
        && offer.every(id => typeof id === 'string' && known.has(id)));
    return valid ? raw as EggOffer[] : undefined;
}

/** Saves before version 4 counted eggs waiting for a free slot; each becomes an offer to choose from. */
function pendingEggsAsOffers(save: Record<string, unknown>,
    buddies: readonly Buddy[],
): EggOffer[] | undefined {
    const pending = save.pendingEggs;
    if (typeof pending !== 'number' || !Number.isInteger(pending) || pending < 0) {
        return undefined;
    }
    return Array.from({ length: pending }, () => eggOffer(buddies.map(buddy => buddy.lineId)));
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
        eggOffers: [],
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

/** Each egg milestone adds an offer of two lines; the player picks one with `chooseEgg`. */
function grantEggs(game: GameState,
    random: () => number = Math.random,
): GameUpdate {
    const due = Math.floor(game.effort / ROSTER.effortPerEgg) - game.eggsGranted;
    if (due <= 0) {
        return { state: game, events: [] };
    }
    const owned = game.buddies.map(buddy => buddy.lineId);
    const offers = Array.from({ length: due }, () => eggOffer(owned, random));
    return {
        state: { ...game, eggOffers: [...game.eggOffers, ...offers], eggsGranted: game.eggsGranted + due },
        events: offers.map(() => ({ kind: 'eggOffered' as const })),
    };
}
