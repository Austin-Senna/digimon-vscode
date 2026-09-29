import * as vscode from 'vscode';
import { ActivityKind, PetEvent, PetState, Update, createEgg, feed, parseState, recordActivity, tick } from './model/pet';

const STATE_KEY = 'digimon.pet';
const TICK_INTERVAL_MS = 30_000;

/** Owns the live pet: persists it, advances time, and broadcasts changes. */
export class PetController implements vscode.Disposable {
    private _state: PetState;
    private readonly _timer: ReturnType<typeof setInterval>;
    private readonly _onDidChange = new vscode.EventEmitter<PetEvent[]>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private readonly _memento: vscode.Memento) {
        const now = Date.now();
        const saved = parseState(_memento.get(STATE_KEY));
        // Time spent with VS Code closed does not count, so resume the clock from now.
        this._state = saved ? { ...saved, lastTickAt: now } : createEgg(now);
        if (!saved) {
            void this._save();
        }
        this._timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    }

    get state(): PetState {
        return this._state;
    }

    tick(): void {
        this._apply(tick(this._state, Date.now()));
    }

    recordActivity(kind: ActivityKind): void {
        this._apply(recordActivity(this._state, kind, Date.now()));
    }

    feed(): void {
        this._apply(feed(this._state));
    }

    newEgg(): void {
        this._apply({ state: createEgg(Date.now()), events: [] }, true);
    }

    dispose(): void {
        clearInterval(this._timer);
        this._onDidChange.dispose();
    }

    private _apply(update: Update,
        force = false,
    ): void {
        if (!force && update.state === this._state && update.events.length === 0) {
            return;
        }
        this._state = update.state;
        void this._save();
        this._onDidChange.fire(update.events);
    }

    private _save(): Thenable<void> {
        return this._memento.update(STATE_KEY, this._state);
    }
}
