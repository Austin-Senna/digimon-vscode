import * as assert from 'assert';
import {
    GameState, ROSTER, activeBuddy, createGame, feedGame, migrateFromPet, milestoneProgress, parseGame,
    recordGameActivity, releaseBuddy, switchBuddy, tickGame,
} from '../../model/game';
import { RULES, createEgg } from '../../model/pet';

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
    test('starts with one egg and starting food', () => {
        const state = game();
        assert.strictEqual(state.buddies.length, 1);
        assert.strictEqual(activeBuddy(state).stage, 'digitama');
        assert.deepStrictEqual(state.food, ROSTER.startingFood);
    });

    test('migrates a v1 pet as the first buddy', () => {
        const pet = { ...createEgg(T0, () => 0), xp: 42 };
        const migrated = migrateFromPet(pet, T0 + MINUTE);
        assert.strictEqual(activeBuddy(migrated).xp, 42);
        assert.strictEqual(activeBuddy(migrated).lastTickAt, T0 + MINUTE);
    });

    test('food milestones repeat and reset', () => {
        const { state, events } = earn(game(), ROSTER.milestones.meat * 2);
        assert.strictEqual(state.food.meat, ROSTER.startingFood.meat + 2);
        assert.strictEqual(events.filter(event => event.kind === 'foodEarned').length, 2);
        assert.strictEqual(milestoneProgress(state, 'meat').current, state.effort % ROSTER.milestones.meat);
    });

    test('a starving pet still earns food, so it can never get stuck', () => {
        const hungry = game({ food: { meat: 0, vitamin: 0, sirloin: 0 } });
        const starving = { ...hungry, buddies: [{ ...activeBuddy(hungry), stage: 'child' as const, fullness: 0 }] };
        const { state } = earn(starving, ROSTER.milestones.meat);
        assert.strictEqual(activeBuddy(state).xp, 0);
        assert.strictEqual(state.food.meat, 1);
        assert.strictEqual(activeBuddy(feedGame(state, 'meat').state).fullness, 25);
    });

    test('feeding uses up food and refuses without it', () => {
        const base = game();
        const hungry = { ...base, buddies: [{ ...activeBuddy(base), stage: 'child' as const, fullness: 10 }] };
        const fed = feedGame(hungry, 'meat').state;
        assert.strictEqual(fed.food.meat, ROSTER.startingFood.meat - 1);
        assert.deepStrictEqual(feedGame(hungry, 'sirloin').events, [{ kind: 'noFood', food: 'sirloin' }]);
    });

    test('a refused food is not consumed', () => {
        const full = game({ buddies: [{ ...activeBuddy(game()), stage: 'child' }] });
        assert.strictEqual(feedGame(full, 'meat').state.food.meat, ROSTER.startingFood.meat);
    });

    test('eggs arrive every milestone from lines not already owned', () => {
        const { state, events } = earn(game(), ROSTER.milestones.egg);
        assert.strictEqual(state.buddies.length, 2);
        assert.ok(events.some(event => event.kind === 'eggEarned'));
        assert.notStrictEqual(state.buddies[1].lineId, state.buddies[0].lineId);
        assert.strictEqual(state.activeId, state.buddies[0].id);
    });

    test('a full roster queues eggs until a buddy is released', () => {
        const { state } = earn(game(), ROSTER.milestones.egg * ROSTER.maxBuddies);
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
        const { state } = earn(game(), ROSTER.milestones.egg);
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
        const { state } = earn(game(), ROSTER.milestones.egg);
        const switched = switchBuddy(state, state.buddies[1].id, T0).state;
        const before = switched.buddies[0].xp;
        const after = recordGameActivity(switched, 'commit', T0 + 1).state;
        assert.strictEqual(after.buddies[0].xp, before);
        assert.ok(activeBuddy(after).xp > 0);
    });

    test('parseGame round-trips and rejects junk', () => {
        const state = earn(game(), ROSTER.milestones.egg).state;
        assert.deepStrictEqual(parseGame(JSON.parse(JSON.stringify(state))), state);
        assert.strictEqual(parseGame({ ...state, activeId: 'nobody' }), undefined);
        assert.strictEqual(parseGame({ ...state, version: 1 }), undefined);
        assert.strictEqual(parseGame({ ...state, food: { meat: 'lots' } }), undefined);
        assert.strictEqual(parseGame(createEgg(T0)), undefined);
    });

    test('time decay never exceeds the tick clamp', () => {
        const child = game({ buddies: [{ ...activeBuddy(game()), stage: 'child' }] });
        const later = tickGame(child, T0 + 24 * 60 * MINUTE).state;
        assert.strictEqual(activeBuddy(later).fullness, RULES.maxFullness - RULES.fullnessDecayPerMinute * RULES.maxTickGapMs / MINUTE);
    });
});
