import * as fs from 'fs';
import * as path from 'path';
import { GAME_VERSION, GameState, createGame, migrateFromPet, parseGame } from './model/game';
import { parseState } from './model/pet';

/**
 * The game lives in one JSON file shared by every VS Code window. Each change re-reads it first and replaces it
 * atomically, so an idle window can never overwrite progress made in another.
 */
export class GameStore {
    private _cache: { game: GameState; stats: fs.Stats } | undefined;
    /** In-memory stand-in used while the file on disk belongs to a newer version of the extension. */
    private _newerFallback: GameState | undefined;

    constructor(readonly file: string,
        /** Pre-roster (v1) pet from globalState, migrated the first time the file is created. */
        private readonly _legacyPet: () => unknown,
    ) {}

    /**
     * True while the save was written by a newer version of the extension (another window already updated).
     * That file is never modified; this window stops saving until it reloads into the newer version.
     */
    get newerSaveFound(): boolean {
        return this._newerFallback !== undefined;
    }

    /** Current game, re-reading the file only when another writer changed it. */
    load(now: number): GameState {
        const stats = statOrUndefined(this.file);
        if (this._cache && stats && sameFile(stats, this._cache.stats)) {
            return this._cache.game;
        }
        if (stats) {
            const raw = readJson(this.file);
            if (isFromNewerVersion(raw)) {
                this._newerFallback ??= this._cache?.game ?? createGame(now);
                return this._newerFallback;
            }
            this._newerFallback = undefined;
            const game = parseGame(raw);
            if (game) {
                this._remember(game);
                return game;
            }
            // Corrupt: keep it for inspection rather than silently destroying it.
            fs.renameSync(this.file, `${this.file}.unreadable-${now}`);
        }
        const legacy = parseState(this._legacyPet());
        const game = legacy ? migrateFromPet(legacy, now) : createGame(now);
        this.save(game);
        return game;
    }

    save(game: GameState): void {
        if (this._newerFallback) {
            return;
        }
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const temp = `${this.file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(game));
        // Stat before renaming: a rename keeps the inode, and another window could replace the file right after.
        const stats = fs.statSync(temp);
        fs.renameSync(temp, this.file);
        this._cache = { game, stats };
    }

    /** True when another window has written since this store last read or wrote. */
    changedElsewhere(): boolean {
        const stats = statOrUndefined(this.file);
        return !!this._cache && !!stats && !sameFile(stats, this._cache.stats);
    }

    private _remember(game: GameState): void {
        this._cache = { game, stats: fs.statSync(this.file) };
    }
}

/** Every save is a rename, so a new inode reliably means a new write even within one mtime tick. */
function sameFile(a: fs.Stats,
    b: fs.Stats,
): boolean {
    return a.ino === b.ino && a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function isFromNewerVersion(raw: unknown): boolean {
    const version = (raw as { version?: unknown } | null)?.version;
    return typeof version === 'number' && version > GAME_VERSION;
}

function statOrUndefined(file: string): fs.Stats | undefined {
    try {
        return fs.statSync(file);
    } catch {
        return undefined;
    }
}

function readJson(file: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return undefined;
    }
}
