import * as vscode from 'vscode';
import { creditClaudeEvent } from './claude/credit';
import { ClaudeEvent } from './claude/events';
import { GameState, GameEvent, GameUpdate, activeBuddy, chooseEgg, chooseGameBranch, feedGame, recordGameActivity, releaseBuddy, switchBuddy, tickGame, createGame } from './model/game';
import { ActivityKind, FoodKind, PetState } from './model/pet';
import { Branch } from './model/species';
import { GameStore } from './store';

const TICK_INTERVAL_MS = 30_000;
/** How often to look for changes other windows made, so this window's UI stays current. */
const SYNC_INTERVAL_MS = 2_000;

/** Applies player actions and time to the shared game and broadcasts changes. */
export class PetController implements vscode.Disposable {
    private readonly _timers: ReturnType<typeof setInterval>[];
    private _warnedAboutNewerSave = false;
    private readonly _onDidChange = new vscode.EventEmitter<GameEvent[]>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private readonly _store: GameStore) {
        this._store.load(Date.now());
        this._timers = [
            setInterval(() => this.tick(), TICK_INTERVAL_MS),
            setInterval(() => {
                if (this._store.changedElsewhere()) {
                    this._onDidChange.fire([]);
                }
            }, SYNC_INTERVAL_MS),
        ];
    }

    get game(): GameState {
        return this._store.load(Date.now());
    }

    /** The active buddy. */
    get state(): PetState {
        return activeBuddy(this.game);
    }

    tick(): void {
        this._apply(now => tickGame(this._store.load(now), now));
    }

    recordActivity(kind: ActivityKind): void {
        this._apply(now => recordGameActivity(this._store.load(now), kind, now));
    }

    /** Credit a Claude event; safe to call from every window, since each event is credited once. */
    recordClaudeEvent(event: ClaudeEvent): void {
        this._apply(now => creditClaudeEvent(this._store.load(now), event, now));
    }

    feed(food: FoodKind): void {
        this._apply(now => feedGame(this._store.load(now), food));
    }

    choose(branch: Branch): void {
        this._apply(now => chooseGameBranch(this._store.load(now), branch));
    }

    switchTo(id: string): void {
        this._apply(now => switchBuddy(this._store.load(now), id, now));
    }

    release(id: string): void {
        this._apply(now => releaseBuddy(this._store.load(now), id));
    }

    chooseEgg(lineId: string): void {
        this._apply(now => chooseEgg(this._store.load(now), lineId, now));
    }

    startOver(): void {
        this._apply(now => ({ state: createGame(now), events: [] }), true);
    }

    dispose(): void {
        this._timers.forEach(clearInterval);
        this._onDidChange.dispose();
    }

    /** Another window runs a newer version; ask this one to reload instead of letting it touch the save. */
    private _warnIfNewerSave(): void {
        if (!this._store.newerSaveFound || this._warnedAboutNewerSave) {
            return;
        }
        this._warnedAboutNewerSave = true;
        void vscode.window.showWarningMessage(
            'Your Digimon was saved by a newer version of Digimon Buddy. Reload this window to keep playing; nothing here will be saved until then.',
            'Reload Window',
        ).then(choice => {
            if (choice === 'Reload Window') {
                void vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
    }

    private _apply(change: (now: number) => GameUpdate,
        force = false,
    ): void {
        const now = Date.now();
        const before = this._store.load(now);
        this._warnIfNewerSave();
        const update = change(now);
        if (!force && update.state === before && update.events.length === 0) {
            return;
        }
        if (force || update.state !== before) {
            this._store.save(update.state);
        }
        this._onDidChange.fire(update.events);
    }
}
