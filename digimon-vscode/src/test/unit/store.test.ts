import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { activeBuddy, recordGameActivity, tickGame } from '../../model/game';
import { createEgg } from '../../model/pet';
import { GameStore } from '../../store';

const T0 = 1_700_000_000_000;

suite('GameStore', () => {
    let dir: string;
    let file: string;

    setup(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digimon-store-'));
        file = path.join(dir, 'nested', 'game.json');
    });

    teardown(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('an idle window cannot overwrite progress made in another', () => {
        const busy = new GameStore(file, () => undefined);
        const idle = new GameStore(file, () => undefined);
        idle.load(T0);

        const progressed = recordGameActivity(busy.load(T0), 'commit', T0 + 1).state;
        busy.save(progressed);

        // The idle window ticks from what is on disk, not from its stale copy.
        idle.save(tickGame(idle.load(T0 + 2), T0 + 2).state);
        assert.strictEqual(activeBuddy(busy.load(T0 + 3)).xp, activeBuddy(progressed).xp);
    });

    test('reports changes written by another store', () => {
        const a = new GameStore(file, () => undefined);
        const b = new GameStore(file, () => undefined);
        a.load(T0);
        assert.strictEqual(a.changedElsewhere(), false);
        b.save(recordGameActivity(b.load(T0), 'commit', T0 + 1).state);
        assert.strictEqual(a.changedElsewhere(), true);
    });

    test('migrates a legacy globalState pet on first load', () => {
        const legacy = { ...createEgg(T0, () => 0), xp: 15 };
        const store = new GameStore(file, () => JSON.parse(JSON.stringify(legacy)));
        assert.strictEqual(activeBuddy(store.load(T0)).xp, 25, 'rescaled to the version 6 level curve');
        assert.ok(fs.existsSync(file));
    });

    test('a save from a newer version is never renamed or overwritten', () => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const future = JSON.stringify({ version: 99, somethingNew: true });
        fs.writeFileSync(file, future);
        const store = new GameStore(file, () => undefined);
        const game = store.load(T0);
        assert.strictEqual(store.newerSaveFound, true);
        store.save(recordGameActivity(game, 'commit', T0 + 1).state);
        assert.strictEqual(fs.readFileSync(file, 'utf8'), future);
        assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['game.json']);
    });

    test('sets aside an unreadable file instead of destroying it', () => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '{ not json');
        const store = new GameStore(file, () => undefined);
        assert.strictEqual(activeBuddy(store.load(T0)).stage, 'digitama');
        assert.ok(fs.existsSync(`${file}.unreadable-${T0}`));
    });
});
