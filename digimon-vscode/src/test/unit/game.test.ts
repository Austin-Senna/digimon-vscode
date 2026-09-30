import * as assert from 'assert';
import {
    GameState, ROSTER, activeBuddy, createGame, feedGame, migrateFromPet, parseGame,
    recordGameActivity, releaseBuddy, switchBuddy, tickGame,
} from '../../model/game';
import { FOODS, RULES, createEgg } from '../../model/pet';

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

function game(overrides: Partial<GameState> = {}): GameState {
    return { ...createGame(T0, () => 0), ...overrides };
}

/** Commit repeatedly (commits are never throttled) until lifetime effort reaches `effort`. */
function earn(state: GameState,
    effort: number,
): ReturnType<typeof recordGameActivity> {
    let current = state;
    const events = [];
    let t = T0;
    while (current.effort < effort) {
        const update = recordGameActivity(current, 'commit', t += 1);
        current = update.state;
        events.push(...update.events);
    }
    return { state: current, events };
}

suite('game', () => {
    test('starts with one egg and starting bits', () => {
        const state = game();
        assert.strictEqual(state.buddies.length, 1);
        assert.strictEqual(activeBuddy(state).stage, 'digitama');
        assert.strictEqual(state.bits, ROSTER.startingBits);
    });

    test('migrates a v1 pet as the first buddy', () => {
        const pet = { ...createEgg(T0, () => 0), xp: 42 };
        const migrated = migrateFromPet(pet, T0 + MINUTE);
        assert.strictEqual(activeBuddy(migrated).xp, 42);
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
        const { bits: _bits, eggsGranted: _eggs, ...rest } = v3;
        const v2 = { ...rest, version: 2, food: { meat: 2, vitamin: 1, sirloin: 1 }, granted: { meat: 4, vitamin: 1, sirloin: 0, egg: 1 } };
        const migrated = parseGame(JSON.parse(JSON.stringify(v2)))!;
        assert.strictEqual(migrated.version, 3);
        assert.strictEqual(migrated.bits, 2 * 50 + 1 * 50 + 1 * 150);
        assert.strictEqual(migrated.eggsGranted, 1);
        assert.ok(!('food' in migrated) && !('granted' in migrated));
    });

    test('eggs arrive every milestone from lines not already owned', () => {
        const { state, events } = earn(game(), ROSTER.effortPerEgg);
        assert.strictEqual(state.buddies.length, 2);
        assert.ok(events.some(event => event.kind === 'eggEarned'));
        assert.notStrictEqual(state.buddies[1].lineId, state.buddies[0].lineId);
        assert.strictEqual(state.activeId, state.buddies[0].id);
    });

    test('a full roster queues eggs until a buddy is released', () => {
        const { state } = earn(game(), ROSTER.effortPerEgg * ROSTER.maxBuddies);
        assert.strictEqual(state.buddies.length, ROSTER.maxBuddies);
        assert.strictEqual(state.pendingEggs, 1);

        const released = releaseBuddy(state, state.buddies[1].id, T0).state;
        assert.strictEqual(released.buddies.length, ROSTER.maxBuddies);
        assert.strictEqual(released.pendingEggs, 0);
    });

    test('the active buddy cannot be released', () => {
        const state = game();
        assert.strictEqual(releaseBuddy(state, state.activeId, T0).state, state);
    });

    test('idle buddies are frozen; switching resumes from now', () => {
        const { state } = earn(game(), ROSTER.effortPerEgg);
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
        const { state } = earn(game(), ROSTER.effortPerEgg);
        const switched = switchBuddy(state, state.buddies[1].id, T0).state;
        const before = switched.buddies[0].xp;
        const after = recordGameActivity(switched, 'commit', T0 + 1).state;
        assert.strictEqual(after.buddies[0].xp, before);
        assert.ok(activeBuddy(after).xp > 0);
    });

    test('parseGame round-trips and rejects junk', () => {
        const state = earn(game(), ROSTER.effortPerEgg).state;
        assert.deepStrictEqual(parseGame(JSON.parse(JSON.stringify(state))), state);
        assert.strictEqual(parseGame({ ...state, activeId: 'nobody' }), undefined);
        assert.strictEqual(parseGame({ ...state, version: 1 }), undefined);
        assert.strictEqual(parseGame({ ...state, bits: 'lots' }), undefined);
        assert.strictEqual(parseGame(createEgg(T0)), undefined);
    });

    test('time decay never exceeds the tick clamp', () => {
        const child = game({ buddies: [{ ...activeBuddy(game()), stage: 'child' }] });
        const later = tickGame(child, T0 + 24 * 60 * MINUTE).state;
        assert.strictEqual(activeBuddy(later).fullness, RULES.maxFullness - RULES.fullnessDecayPerMinute * RULES.maxTickGapMs / MINUTE);
    });
});
