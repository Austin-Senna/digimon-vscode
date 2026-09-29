import * as assert from 'assert';
import {
    PetState, RULES, createEgg, feed, isAsleep, mood, parseState, recordActivity, species, tick,
} from '../../model/pet';
import { LINES } from '../../model/species';

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

function egg(overrides: Partial<PetState> = {}): PetState {
    return { ...createEgg(T0, () => 0), ...overrides };
}

function hatched(overrides: Partial<PetState> = {}): PetState {
    return egg({ stage: 'child', xp: RULES.xpToEvolve.babyII, ...overrides });
}

/** Tick forward in steps no larger than the gap clamp, as the controller does. */
function advance(state: PetState,
    ms: number,
    step = MINUTE,
): { state: PetState; events: ReturnType<typeof tick>['events'] } {
    const events = [];
    let current = state;
    for (let t = step; t <= ms; t += step) {
        const update = tick(current, current.lastTickAt + step);
        current = update.state;
        events.push(...update.events);
    }
    return { state: current, events };
}

suite('pet model', () => {
    test('createEgg picks a line from the random source', () => {
        assert.strictEqual(createEgg(T0, () => 0).lineId, LINES[0].id);
        assert.strictEqual(createEgg(T0, () => 0.999).lineId, LINES[LINES.length - 1].id);
    });

    test('eggs do not get hungry', () => {
        const { state } = advance(egg(), 60 * MINUTE);
        assert.strictEqual(state.fullness, RULES.maxFullness);
    });

    test('egg hatches once it has enough XP', () => {
        const update = tick(egg({ xp: RULES.xpToEvolve.digitama }), T0 + MINUTE);
        assert.strictEqual(update.state.stage, 'babyI');
        assert.deepStrictEqual(update.events, [
            { kind: 'evolved', from: 'Agu_Digitama', to: LINES[0].babyI, stage: 'babyI' },
        ]);
    });

    test('evolves as soon as activity crosses the threshold, without waiting for a tick', () => {
        const state = egg({ xp: RULES.xpToEvolve.digitama - 1 });
        const update = recordActivity(state, 'save', T0 + 1);
        assert.strictEqual(update.state.stage, 'babyI');
        assert.ok(update.events.some(event => event.kind === 'evolved'));
    });

    test('evolves one stage per tick', () => {
        const update = tick(egg({ xp: 1_000_000 }), T0 + MINUTE);
        assert.strictEqual(update.state.stage, 'babyI');
    });

    test('time gaps while VS Code is closed are clamped', () => {
        const state = hatched();
        const update = tick(state, T0 + 24 * 60 * MINUTE);
        const expectedLoss = RULES.fullnessDecayPerMinute * RULES.maxTickGapMs / MINUTE;
        assert.strictEqual(update.state.fullness, RULES.maxFullness - expectedLoss);
        assert.strictEqual(update.state.ageMs, RULES.maxTickGapMs);
    });

    test('starving counts one care mistake, then one per interval', () => {
        const state = hatched({ fullness: 1 });
        const minutesToEmpty = 1 / RULES.fullnessDecayPerMinute;
        const first = advance(state, minutesToEmpty * MINUTE);
        assert.strictEqual(first.state.fullness, 0);
        assert.strictEqual(first.state.careMistakes, 1);
        assert.ok(first.events.some(event => event.kind === 'starving'));

        const later = advance(first.state, RULES.starvingMistakeIntervalMs);
        assert.strictEqual(later.state.careMistakes, 2);
    });

    test('feeding resets the starvation clock', () => {
        const starving = hatched({ fullness: 0, starvingMs: RULES.starvingMistakeIntervalMs - MINUTE });
        const fed = feed(starving).state;
        assert.strictEqual(fed.fullness, RULES.foodValue);
        assert.strictEqual(fed.starvingMs, 0);
    });

    test('feeding a full pet or an egg is refused', () => {
        assert.deepStrictEqual(feed(hatched()).events, [{ kind: 'refused' }]);
        assert.deepStrictEqual(feed(egg()).events, [{ kind: 'refused' }]);
    });

    test('edits are throttled to one XP per cooldown', () => {
        const state = hatched({ lastActivityAt: T0 });
        const first = recordActivity(state, 'edit', T0 + 1);
        const throttled = recordActivity(first.state, 'edit', T0 + 2);
        assert.strictEqual(first.state.xp, state.xp + RULES.xpPerActivity.edit);
        assert.strictEqual(throttled.state, first.state);
        const later = recordActivity(first.state, 'edit', T0 + 1 + RULES.activeSecondCooldownMs);
        assert.strictEqual(later.state.xp, first.state.xp + RULES.xpPerActivity.edit);
    });

    test('Claude tool calls share the active-second budget with edits', () => {
        const state = hatched({ lastActivityAt: T0 });
        const edited = recordActivity(state, 'edit', T0 + 1).state;
        assert.strictEqual(recordActivity(edited, 'agentTool', T0 + 2).state, edited);
        const later = recordActivity(edited, 'agentTool', T0 + 1 + RULES.activeSecondCooldownMs).state;
        assert.strictEqual(later.xp, edited.xp + RULES.xpPerActivity.agentTool);
    });

    test('prompts are not throttled', () => {
        const state = hatched({ lastActivityAt: T0, lastEditXpAt: T0 });
        const update = recordActivity(state, 'prompt', T0 + 1);
        assert.strictEqual(update.state.xp, state.xp + RULES.xpPerActivity.prompt);
    });

    test('starving pets gain no XP', () => {
        const state = hatched({ fullness: 0 });
        const update = recordActivity(state, 'commit', T0 + 1);
        assert.strictEqual(update.state.xp, state.xp);
    });

    test('exhausted pets gain reduced XP and say so once', () => {
        const tired = hatched({ energy: RULES.xpPerActivity.commit * RULES.energyCostPerXp });
        const drained = recordActivity(tired, 'commit', T0 + 1);
        assert.strictEqual(drained.state.energy, 0);
        assert.deepStrictEqual(drained.events, [{ kind: 'exhausted' }]);

        const again = recordActivity(drained.state, 'commit', T0 + 2);
        assert.strictEqual(again.state.xp, drained.state.xp + RULES.xpPerActivity.commit * RULES.exhaustedXpMultiplier);
        assert.deepStrictEqual(again.events, []);
    });

    test('falls asleep when idle, recovers energy, and wakes on activity', () => {
        const state = hatched({ energy: 10, lastActivityAt: T0 });
        assert.strictEqual(isAsleep(state, T0 + RULES.sleepAfterMs), true);
        assert.strictEqual(mood(state, T0 + RULES.sleepAfterMs), 'sleeping');

        const rested = advance(state, RULES.sleepAfterMs + 10 * MINUTE).state;
        assert.ok(rested.energy > 10);

        const woke = recordActivity(rested, 'edit', rested.lastTickAt);
        assert.ok(woke.events.some(event => event.kind === 'woke'));
        assert.strictEqual(isAsleep(woke.state, rested.lastTickAt), false);
    });

    test('care mistakes at Child pick the adult branch', () => {
        const line = LINES[0];
        const evolveWith = (careMistakes: number) =>
            species(tick(hatched({ xp: RULES.xpToEvolve.child, careMistakes, lastActivityAt: T0 }), T0 + MINUTE).state);
        assert.strictEqual(evolveWith(0), line.good[0]);
        assert.strictEqual(evolveWith(RULES.maxMistakesForGood), line.good[0]);
        assert.strictEqual(evolveWith(RULES.maxMistakesForGood + 1), line.bad[0]);
        assert.strictEqual(evolveWith(RULES.maxMistakesForBad + 1), 'Numemon');
    });

    test('branch is kept through later stages', () => {
        const adult = hatched({ stage: 'adult', branch: 'bad', xp: RULES.xpToEvolve.adult, lastActivityAt: T0 });
        const perfect = tick(adult, T0 + MINUTE).state;
        assert.strictEqual(species(perfect), LINES[0].bad[1]);
    });

    test('ultimate is final', () => {
        const ultimate = hatched({ stage: 'ultimate', branch: 'good', xp: 10_000_000, lastActivityAt: T0 });
        assert.strictEqual(tick(ultimate, T0 + MINUTE).state.stage, 'ultimate');
    });

    test('parseState round-trips valid state and rejects junk', () => {
        const state = hatched();
        assert.deepStrictEqual(parseState(JSON.parse(JSON.stringify(state))), state);
        assert.strictEqual(parseState(undefined), undefined);
        assert.strictEqual(parseState({ ...state, lineId: 'missingno' }), undefined);
        assert.strictEqual(parseState({ ...state, version: 0 }), undefined);
        assert.strictEqual(parseState({ ...state, xp: 'lots' }), undefined);
    });
});
