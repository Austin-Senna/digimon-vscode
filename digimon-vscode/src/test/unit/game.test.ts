import * as assert from 'assert';
import {
    GAME_VERSION, GameState, ROSTER, activeBuddy, chooseEgg, createGame, eggOffer, eggProgress, feedGame, isPartyFull, migrateFromPet, parseGame,
    recordGameActivity, releaseBuddy, switchBuddy, tickGame,
} from '../../model/game';
import { FOODS, RULES, createEgg, levelOf } from '../../model/pet';
import { LINES } from '../../model/species';

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

function game(overrides: Partial<GameState> = {}): GameState {
    return { ...createGame(T0, () => 0), ...overrides };
}

/** Send prompts repeatedly (prompts have no cooldown) until lifetime effort reaches `effort`. */
function earn(state: GameState,
    effort: number,
): ReturnType<typeof recordGameActivity> {
    let current = state;
    const events = [];
    let t = T0;
    while (current.effort < effort) {
        const update = recordGameActivity(current, 'prompt', t += 1);
        current = update.state;
        events.push(...update.events);
    }
    return { state: current, events };
}

/** A game with a hatched first buddy and a chosen second egg. */
function withSecondBuddy(): GameState {
    const offered = earn(game(), ROSTER.effortPerEgg).state;
    return chooseEgg(offered, offered.eggOffers[0][0], T0).state;
}

suite('game', () => {
    test('starts with one egg and starting bits', () => {
        const state = game();
        assert.strictEqual(state.buddies.length, 1);
        assert.strictEqual(activeBuddy(state).stage, 'digitama');
        assert.strictEqual(state.bits, ROSTER.startingBits);
    });

    test('migrates a v1 pet as the first buddy', () => {
        const pet = { ...createEgg(T0, () => 0), xp: 15 * 9 ** 2 };
        const migrated = migrateFromPet(pet, T0 + MINUTE);
        assert.strictEqual(levelOf(activeBuddy(migrated).xp), 10, 'rescaled to the version 6 level curve');
        assert.strictEqual(activeBuddy(migrated).lastTickAt, T0 + MINUTE);
    });

    test('effort earns bits one for one', () => {
        const { state } = earn(game(), 100);
        assert.strictEqual(state.bits, ROSTER.startingBits + state.effort * ROSTER.bitsPerEffort);
    });

    test('a starving pet still earns bits, so it can never get stuck', () => {
        const broke = game({ bits: 0 });
        const starving = { ...broke, buddies: [{ ...activeBuddy(broke), stage: 'child' as const, fullness: 0 }] };
        const { state } = earn(starving, ROSTER.foodPrices.meat);
        assert.strictEqual(activeBuddy(state).xp, 0);
        const fed = feedGame(state, 'meat').state;
        assert.strictEqual(activeBuddy(fed).fullness, FOODS.meat.fullness);
    });

    test('buying food spends its price and never touches XP', () => {
        const base = game();
        const hungry = { ...base, buddies: [{ ...activeBuddy(base), stage: 'child' as const, fullness: 10, energy: 10, xp: 500 }] };
        const fed = feedGame(hungry, 'sirloin').state;
        assert.strictEqual(fed.bits, ROSTER.startingBits - ROSTER.foodPrices.sirloin);
        assert.strictEqual(activeBuddy(fed).xp, 500);
    });

    test('food you cannot afford is not bought', () => {
        const poor = game({ bits: ROSTER.foodPrices.meat - 1 });
        const hungry = { ...poor, buddies: [{ ...activeBuddy(poor), stage: 'child' as const, fullness: 10 }] };
        assert.deepStrictEqual(feedGame(hungry, 'meat'), { state: hungry, events: [{ kind: 'cannotAfford', food: 'meat' }] });
    });

    test('a refused food is not charged', () => {
        const full = game({ buddies: [{ ...activeBuddy(game()), stage: 'child' }] });
        assert.strictEqual(feedGame(full, 'meat').state.bits, ROSTER.startingBits);
    });

    test('version 2 saves refund their food as bits', () => {
        const v3 = game();
        const { bits: _bits, eggsGranted: _eggs, eggOffers: _offers, ...rest } = v3;
        const v2 = { ...rest, version: 2, pendingEggs: 0, food: { meat: 2, vitamin: 1, sirloin: 1 }, granted: { meat: 4, vitamin: 1, sirloin: 0, egg: 1 } };
        const migrated = parseGame(JSON.parse(JSON.stringify(v2)))!;
        assert.strictEqual(migrated.version, GAME_VERSION);
        assert.strictEqual(migrated.bits, (2 * 50 + 1 * 50 + 1 * 150) * 2, 'valued at the old prices, then rescaled');
        assert.strictEqual(migrated.eggsGranted, 1);
        assert.ok(!('food' in migrated) && !('granted' in migrated));
    });

    test('each egg milestone offers two lines the player does not own', () => {
        const { state, events } = earn(game(), ROSTER.effortPerEgg);
        assert.strictEqual(state.buddies.length, 1, 'nothing joins until the player picks');
        assert.strictEqual(events.filter(event => event.kind === 'eggOffered').length, 1);
        const [offer] = state.eggOffers;
        assert.strictEqual(offer.length, 2);
        assert.notStrictEqual(offer[0], offer[1]);
        assert.ok(!offer.includes(state.buddies[0].lineId));
    });

    test('choosing an egg adds that line and consumes the offer', () => {
        const offered = earn(game(), ROSTER.effortPerEgg).state;
        const pick = offered.eggOffers[0][1];
        const update = chooseEgg(offered, pick, T0);
        assert.strictEqual(update.state.buddies.length, 2);
        assert.strictEqual(update.state.buddies[1].lineId, pick);
        assert.strictEqual(update.state.buddies[1].stage, 'digitama');
        assert.strictEqual(update.state.activeId, offered.activeId);
        assert.deepStrictEqual(update.state.eggOffers, []);
        assert.deepStrictEqual(update.events, [{ kind: 'eggChosen', lineId: pick }]);
    });

    test('a line outside the offer cannot be chosen', () => {
        const offered = earn(game(), ROSTER.effortPerEgg).state;
        const outside = LINES.map(line => line.id).find(id => !offered.eggOffers[0].includes(id))!;
        assert.strictEqual(chooseEgg(offered, outside, T0).state, offered);
    });

    test('a full party keeps offers waiting until a buddy is released', () => {
        let state = game();
        for (let i = 1; i < ROSTER.maxBuddies; i++) {
            state = earn(state, ROSTER.effortPerEgg * i).state;
            state = chooseEgg(state, state.eggOffers[0][0], T0).state;
        }
        assert.strictEqual(isPartyFull(state), true);
        state = earn(state, ROSTER.effortPerEgg * ROSTER.maxBuddies).state;
        const pick = state.eggOffers[0][0];
        assert.strictEqual(chooseEgg(state, pick, T0).state, state);

        const released = releaseBuddy(state, state.buddies[1].id).state;
        const chosen = chooseEgg(released, pick, T0).state;
        assert.strictEqual(chosen.buddies.length, ROSTER.maxBuddies);
        assert.deepStrictEqual(chosen.eggOffers, []);
    });

    test('offers fall back to any line once every line is owned', () => {
        const offer = eggOffer(LINES.map(line => line.id), () => 0.5);
        assert.strictEqual(new Set(offer).size, 2);
    });

    test('version 3 saves turn waiting eggs into offers', () => {
        const { eggOffers: _offers, ...rest } = game();
        const v3 = { ...rest, version: 3, pendingEggs: 2 };
        const migrated = parseGame(JSON.parse(JSON.stringify(v3)))!;
        assert.strictEqual(migrated.version, GAME_VERSION);
        assert.strictEqual(migrated.eggOffers.length, 2);
        assert.ok(!('pendingEggs' in migrated));
    });

    test('the active buddy cannot be released', () => {
        const state = game();
        assert.strictEqual(releaseBuddy(state, state.activeId).state, state);
    });

    test('idle buddies are frozen; switching resumes from now', () => {
        const state = withSecondBuddy();
        const first = state.buddies[0];
        const second = state.buddies[1];
        const switched = switchBuddy(state, second.id, T0 + MINUTE).state;
        assert.strictEqual(switched.activeId, second.id);

        const later = tickGame(switched, T0 + 2 * MINUTE).state;
        const frozen = later.buddies.find(buddy => buddy.id === first.id)!;
        assert.strictEqual(frozen.fullness, switched.buddies.find(buddy => buddy.id === first.id)!.fullness);
        assert.strictEqual(activeBuddy(switched).lastTickAt, T0 + MINUTE);
    });

    test('XP only goes to the active buddy', () => {
        const state = withSecondBuddy();
        const switched = switchBuddy(state, state.buddies[1].id, T0).state;
        const before = switched.buddies[0].xp;
        const after = recordGameActivity(switched, 'commit', T0 + 1).state;
        assert.strictEqual(after.buddies[0].xp, before);
        assert.ok(activeBuddy(after).xp > 0);
    });

    test('saves before version 6 keep their levels, egg progress, and buying power', () => {
        const { claudeSessions: _, ...rest } = game();
        const buddy = { ...activeBuddy(game()), xp: 15 * 9 ** 2 + 7 };
        const v5 = { ...rest, version: 5, buddies: [buddy], bits: 100, effort: 1_500 * 2 + 750, eggsGranted: 2 };
        const migrated = parseGame(JSON.parse(JSON.stringify(v5)))!;
        assert.strictEqual(levelOf(activeBuddy(migrated).xp), 10);
        assert.strictEqual(migrated.bits, 200);
        assert.strictEqual(Math.floor(migrated.effort / ROSTER.effortPerEgg), 2, 'no eggs gained or lost');
        assert.strictEqual(eggProgress(migrated).current, ROSTER.effortPerEgg / 2, 'halfway to the next egg, as before');
        assert.deepStrictEqual(parseGame(JSON.parse(JSON.stringify(migrated))), migrated, 'version 6 saves are not rescaled again');
    });

    test('version 4 saves start with no Claude sessions', () => {
        const { claudeSessions: _, ...rest } = game();
        const migrated = parseGame(JSON.parse(JSON.stringify({ ...rest, version: 4 })))!;
        assert.strictEqual(migrated.version, GAME_VERSION);
        assert.deepStrictEqual(migrated.claudeSessions, {});
    });

    test('malformed Claude session bookkeeping is dropped, not the save', () => {
        const sessions = { good: { lastT: T0, working: true, bankedMs: 0 }, bad: { lastT: 'soon' } };
        const parsed = parseGame({ ...game(), claudeSessions: sessions })!;
        assert.deepStrictEqual(parsed.claudeSessions, { good: sessions.good });
        assert.deepStrictEqual(parseGame({ ...game(), claudeSessions: 'nope' })!.claudeSessions, {});
    });

    test('parseGame round-trips and rejects junk', () => {
        const state = earn(game(), ROSTER.effortPerEgg).state;
        assert.deepStrictEqual(parseGame(JSON.parse(JSON.stringify(state))), state);
        assert.strictEqual(parseGame({ ...state, eggOffers: [['missingno', 'agumon']] }), undefined);
        assert.strictEqual(parseGame({ ...state, activeId: 'nobody' }), undefined);
        assert.strictEqual(parseGame({ ...state, version: 1 }), undefined);
        assert.strictEqual(parseGame({ ...state, bits: 'lots' }), undefined);
        assert.strictEqual(parseGame(createEgg(T0)), undefined);
    });

    test('time decay never exceeds the tick clamp', () => {
        const reopened = T0 + 24 * 60 * MINUTE;
        const child = game({ buddies: [{ ...activeBuddy(game()), stage: 'child', lastActivityAt: reopened }] });
        const later = tickGame(child, reopened).state;
        assert.strictEqual(activeBuddy(later).fullness, RULES.maxFullness - RULES.fullnessDecayPerMinute * RULES.maxTickGapMs / MINUTE);
    });
});
