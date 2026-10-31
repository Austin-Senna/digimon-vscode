import * as assert from 'assert';
import { GameState, activeBuddy, createGame } from '../../model/game';
import { xpForLevel } from '../../model/pet';
import { statusText } from '../../statusText';

const T0 = 1_700_000_000_000;

function agumonAt(level: number,
    overrides: Partial<GameState> = {},
): GameState {
    const base = createGame(T0, () => 0);
    return { ...base, buddies: [{ ...activeBuddy(base), stage: 'child', form: 'child', xp: xpForLevel(level) }], ...overrides };
}

suite('status text', () => {
    test('shows the active buddy and its level', () => {
        assert.strictEqual(statusText(agumonAt(12), T0), 'Agumon Lv 12');
    });

    test('shows minutes of frenzy left, rounded up', () => {
        assert.strictEqual(statusText(agumonAt(12, { frenzyUntil: T0 + 90_000 }), T0), 'Agumon Lv 12 $(flame) 2m');
    });

    test('drops the frenzy once it ends', () => {
        assert.strictEqual(statusText(agumonAt(12, { frenzyUntil: T0 }), T0), 'Agumon Lv 12');
    });
});
