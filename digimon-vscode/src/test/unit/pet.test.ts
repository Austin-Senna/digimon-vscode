import * as assert from 'assert';
import {
    FOODS, chooseBranch, isReadyToChoose, levelOf, nextEvolutionLevel, xpForLevel, PetState, RULES, activityEffort, createEgg, feed, isAsleep, mood, parseState, recordActivity, species, tick,
} from '../../model/pet';
import { LINES } from '../../model/species';

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

function egg(overrides: Partial<PetState> = {}): PetState {
    return { ...createEgg(T0, () => 0), ...overrides };
}

function hatched(overrides: Partial<PetState> = {}): PetState {
    return egg({ stage: 'child', xp: xpForLevel(RULES.evolveAtLevel.babyII), ...overrides });
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
        const update = tick(egg({ xp: xpForLevel(RULES.evolveAtLevel.digitama) }), T0 + MINUTE);
        assert.strictEqual(update.state.stage, 'babyI');
        assert.deepStrictEqual(update.events, [
            { kind: 'evolved', from: 'Agu_Digitama', to: LINES[0].babyI, stage: 'babyI' },
        ]);
    });

    test('evolves as soon as activity crosses the threshold, without waiting for a tick', () => {
        const state = egg({ xp: xpForLevel(RULES.evolveAtLevel.digitama) - 1 });
        const update = recordActivity(state, 'save', T0 + 1);
        assert.strictEqual(update.state.stage, 'babyI');
        assert.ok(update.events.some(event => event.kind === 'evolved'));
    });

    test('level curve: 15 * (L - 1)^2 XP per level, no cap', () => {
        assert.deepStrictEqual([1, 2, 10, 25, 50].map(xpForLevel), [0, 15, 1215, 8640, 36015]);
        assert.strictEqual(levelOf(0), 1);
        assert.strictEqual(levelOf(14), 1);
        assert.strictEqual(levelOf(15), 2);
        assert.strictEqual(levelOf(xpForLevel(120)), 120);
        assert.strictEqual(levelOf(xpForLevel(120) - 1), 119);
    });

    test('announces each level gained', () => {
        const state = hatched({ xp: xpForLevel(12) - 1, lastActivityAt: T0 });
        const update = recordActivity(state, 'prompt', T0 + 1);
        assert.ok(update.events.some(event => event.kind === 'leveledUp' && event.level === 12));
        assert.ok(!recordActivity(update.state, 'prompt', T0 + 2).events.some(event => event.kind === 'leveledUp'));
    });

    test('Ultimate keeps leveling with no next evolution', () => {
        const ultimate = hatched({ stage: 'ultimate', branch: 'good', xp: xpForLevel(80), lastActivityAt: T0 });
        assert.strictEqual(nextEvolutionLevel(ultimate), null);
        const update = recordActivity({ ...ultimate, xp: xpForLevel(81) - 1 }, 'prompt', T0 + 1);
        assert.ok(update.events.some(event => event.kind === 'leveledUp' && event.level === 81));
        assert.strictEqual(update.state.stage, 'ultimate');
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

    test('warns once when fullness runs out', () => {
        const state = hatched({ fullness: 1 });
        const minutesToEmpty = 1 / RULES.fullnessDecayPerMinute;
        const first = advance(state, minutesToEmpty * MINUTE);
        assert.strictEqual(first.state.fullness, 0);
        assert.strictEqual(first.events.filter(event => event.kind === 'starving').length, 1);
        assert.strictEqual(advance(first.state, 60 * MINUTE).events.some(event => event.kind === 'starving'), false);
    });

    test('meat feeds a starving pet', () => {
        assert.strictEqual(feed(hatched({ fullness: 0 }), 'meat').state.fullness, FOODS.meat.fullness);
    });

    test('feeding a full pet or an egg is refused', () => {
        assert.deepStrictEqual(feed(hatched(), 'meat').events, [{ kind: 'refused' }]);
        assert.deepStrictEqual(feed(hatched({ fullness: 10 }), 'vitamin').events, [{ kind: 'refused' }]);
        assert.deepStrictEqual(feed(egg({ fullness: 0 }), 'meat').events, [{ kind: 'refused' }]);
    });

    test('each food restores what it says', () => {
        assert.strictEqual(feed(hatched({ energy: 10 }), 'vitamin').state.energy, 10 + FOODS.vitamin.energy);
        const sirloin = feed(hatched({ fullness: 5, energy: 5 }), 'sirloin').state;
        assert.deepStrictEqual([sirloin.fullness, sirloin.energy], [RULES.maxFullness, RULES.maxEnergy]);
    });

    test('effort ignores hunger but respects the active-second cap', () => {
        const starving = hatched({ fullness: 0, lastEditXpAt: T0 });
        assert.strictEqual(activityEffort(starving, 'commit', T0 + 1), RULES.xpPerActivity.commit);
        assert.strictEqual(activityEffort(starving, 'edit', T0 + 1), 0);
        assert.strictEqual(activityEffort(starving, 'edit', T0 + RULES.cooldownMs.edit), RULES.xpPerActivity.edit);
    });

    test('edits are throttled to one XP per cooldown', () => {
        const state = hatched({ lastActivityAt: T0 });
        const first = recordActivity(state, 'edit', T0 + 1);
        const throttled = recordActivity(first.state, 'edit', T0 + 2);
        assert.strictEqual(first.state.xp, state.xp + RULES.xpPerActivity.edit);
        assert.strictEqual(throttled.state, first.state);
        const later = recordActivity(first.state, 'edit', T0 + 1 + RULES.cooldownMs.edit);
        assert.strictEqual(later.state.xp, first.state.xp + RULES.xpPerActivity.edit);
    });

    test('Claude working minutes are never throttled by edits', () => {
        const edited = recordActivity(hatched({ lastActivityAt: T0 }), 'edit', T0 + 1).state;
        const minute = recordActivity(edited, 'claudeMinute', T0 + 2).state;
        assert.strictEqual(minute.xp, edited.xp + RULES.xpPerActivity.claudeMinute);
    });

    test('prompts are not throttled', () => {
        const state = hatched({ lastActivityAt: T0, lastEditXpAt: T0 });
        const update = recordActivity(state, 'prompt', T0 + 1);
        assert.strictEqual(update.state.xp, state.xp + RULES.xpPerActivity.prompt);
    });

    test('saves and commits are rewarded at most once per cooldown', () => {
        for (const kind of ['save', 'commit'] as const) {
            const state = hatched({ lastActivityAt: T0 });
            const first = recordActivity(state, kind, T0 + 1).state;
            assert.strictEqual(first.xp, state.xp + RULES.xpPerActivity[kind], kind);
            assert.strictEqual(recordActivity(first, kind, T0 + RULES.cooldownMs[kind]).state.xp, first.xp, kind);
            assert.strictEqual(recordActivity(first, kind, T0 + 1 + RULES.cooldownMs[kind]).state.xp,
                first.xp + RULES.xpPerActivity[kind], kind);
        }
    });

    test('cooldowns are independent per activity', () => {
        const saved = recordActivity(hatched({ lastActivityAt: T0 }), 'save', T0 + 1).state;
        const committed = recordActivity(saved, 'commit', T0 + 2).state;
        assert.strictEqual(committed.xp, saved.xp + RULES.xpPerActivity.commit);
    });

    test('starving pets gain no XP', () => {
        const state = hatched({ fullness: 0 });
        const update = recordActivity(state, 'commit', T0 + 1);
        assert.strictEqual(update.state.xp, state.xp);
    });

    test('exhausted pets gain reduced XP and say so once', () => {
        const tired = hatched({ energy: RULES.xpPerActivity.prompt * RULES.energyCostPerXp });
        const drained = recordActivity(tired, 'prompt', T0 + 1);
        assert.strictEqual(drained.state.energy, 0);
        assert.deepStrictEqual(drained.events, [{ kind: 'exhausted' }]);

        const again = recordActivity(drained.state, 'prompt', T0 + 2);
        assert.strictEqual(again.state.xp, drained.state.xp + RULES.xpPerActivity.prompt * RULES.exhaustedXpMultiplier);
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

    test('a Child with enough XP waits for a choice instead of evolving', () => {
        const child = hatched({ xp: xpForLevel(RULES.evolveAtLevel.child) - 1, lastActivityAt: T0 });
        const ready = recordActivity(child, 'save', T0 + 1);
        assert.strictEqual(ready.state.stage, 'child');
        assert.ok(isReadyToChoose(ready.state));
        assert.deepStrictEqual(ready.events, [{ kind: 'leveledUp', level: RULES.evolveAtLevel.child }, { kind: 'readyToChoose' }]);
        assert.strictEqual(tick(ready.state, T0 + MINUTE).state.stage, 'child');
        assert.deepStrictEqual(recordActivity(ready.state, 'prompt', T0 + 2).events, []);
    });

    test('the chosen branch picks the Adult form', () => {
        const ready = hatched({ xp: xpForLevel(RULES.evolveAtLevel.child) });
        assert.strictEqual(species(chooseBranch(ready, 'good').state), LINES[0].good[0]);
        const dark = chooseBranch(ready, 'bad');
        assert.strictEqual(species(dark.state), LINES[0].bad[0]);
        assert.deepStrictEqual(dark.events, [{ kind: 'evolved', from: LINES[0].child, to: LINES[0].bad[0], stage: 'adult' }]);
    });

    test('choosing is ignored until the Child is ready, and while starving', () => {
        const early = hatched({ xp: xpForLevel(RULES.evolveAtLevel.child) - 1 });
        assert.strictEqual(chooseBranch(early, 'good').state, early);
        const starving = hatched({ xp: xpForLevel(RULES.evolveAtLevel.child), fullness: 0 });
        assert.strictEqual(chooseBranch(starving, 'good').state, starving);
    });

    test('branch is kept through later stages', () => {
        const adult = hatched({ stage: 'adult', branch: 'bad', xp: xpForLevel(RULES.evolveAtLevel.adult), lastActivityAt: T0 });
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

    test('parseState treats cooldowns missing from older saves as never used', () => {
        const { lastSaveXpAt: _save, lastCommitXpAt: _commit, ...old } = hatched();
        const parsed = parseState(old)!;
        assert.strictEqual(parsed.lastSaveXpAt, 0);
        assert.strictEqual(parsed.lastCommitXpAt, 0);
    });

    test('parseState drops removed care-mistake fields and maps the old Numemon branch', () => {
        const old = { ...hatched({ stage: 'adult' }), branch: 'neglected', careMistakes: 7, starvingMs: 5 };
        const parsed = parseState(old)!;
        assert.strictEqual(parsed.branch, 'bad');
        assert.ok(!('careMistakes' in parsed) && !('starvingMs' in parsed));
    });
});
