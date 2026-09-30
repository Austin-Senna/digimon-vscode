import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { PetController } from './PetController';
import { Appearance, resolveAppearance } from './appearance';
import { ClaudeAnimation, ClaudeListener } from './claude/bridge';
import { ClaudeStatus } from './claude/events';
import { GameEvent, GameState, ROSTER, activeBuddy, eggProgress, isPartyFull } from './model/game';
import { FOODS, FoodKind, Mood, PetState, RULES, isReadyToChoose, levelOf, mood, nextEvolutionLevel, species, xpForLevel } from './model/pet';
import { BRANCHES, Branch, STAGES, STAGE_LABELS, Stage, displayName, findLine, spritePath } from './model/species';

type Animation = ClaudeAnimation | 'happy' | 'eat' | 'levelUp';

const MOOD_LABELS: Record<Mood, string> = {
    sleeping: 'Sleeping',
    starving: 'Starving',
    exhausted: 'Exhausted, take a break',
    hungry: 'Hungry',
    happy: 'Happy',
};

function claudeLabel(status: ClaudeStatus,
    waiting: number,
): string {
    if (status === 'waiting') {
        return waiting > 1 ? `${waiting} Claude sessions need you` : 'Claude needs you';
    }
    return status === 'working' ? 'Claude is working' : '';
}

const EVENT_ANIMATIONS: Partial<Record<GameEvent['kind'], Animation>> = {
    ate: 'eat',
    refused: 'refuse',
    cannotAfford: 'refuse',
    woke: 'happy',
    leveledUp: 'levelUp',
    switched: 'happy',
    eggChosen: 'happy',
};

export class DigimonPlaygroundProvider implements vscode.WebviewViewProvider, ClaudeListener, vscode.Disposable {
    private _view: vscode.WebviewView | undefined;
    private _claudeStatus: ClaudeStatus = 'idle';
    private _claudeWaiting = 0;
    /** Shown instead of the saved appearance while the Customize picker is open. */
    private _preview: Appearance | undefined;
    private readonly _subscriptions: vscode.Disposable[];

    constructor(private readonly _extensionUri: vscode.Uri,
        private readonly _controller: PetController,
    ) {
        this._subscriptions = [
            _controller.onDidChange(events => {
                this._postState();
                for (const event of events) {
                    if (event.kind === 'evolved') {
                        this._playEvolution(event.from, event.to, event.stage);
                        continue;
                    }
                    const animation = EVENT_ANIMATIONS[event.kind];
                    if (animation) {
                        this.play(animation);
                    }
                }
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('digimon.appearance')) {
                    this._postState();
                }
            }),
        ];
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(message => {
            // Messages come from our own script, but validate anyway: nothing here should trust the webview.
            if (message?.type === 'ready') {
                this._postState();
            } else if (message?.type === 'feed' && typeof message.food === 'string' && Object.hasOwn(FOODS, message.food)) {
                this._controller.feed(message.food as FoodKind);
            } else if (message?.type === 'choose' && (BRANCHES as readonly unknown[]).includes(message.branch)) {
                this._controller.choose(message.branch as Branch);
            } else if (message?.type === 'focusClaude') {
                void vscode.commands.executeCommand('digimon.focusClaude');
            } else if (message?.type === 'chooseEgg' && typeof message.lineId === 'string') {
                this._controller.chooseEgg(message.lineId);
            } else if (message?.type === 'switch' && typeof message.id === 'string') {
                this._controller.switchTo(message.id);
            }
        });
        webviewView.onDidDispose(() => {
            this._view = undefined;
        });
    }

    setClaudeStatus(status: ClaudeStatus,
        waiting: number,
    ): void {
        this._claudeStatus = status;
        this._claudeWaiting = waiting;
        this._postState();
    }

    play(animation: Animation): void {
        void this._view?.webview.postMessage({ type: 'play', animation });
    }

    /** The evolution scene needs both forms: the old sprite goes into the sphere and the new one comes out. */
    private _playEvolution(from: string,
        to: string,
        stage: Stage,
    ): void {
        const webview = this._view?.webview;
        if (!webview) {
            return;
        }
        const previous = STAGES[STAGES.indexOf(stage) - 1];
        const uri = (atStage: Stage, name: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, ...spritePath(atStage, name))).toString();
        void webview.postMessage({
            type: 'evolve',
            from: { spriteUri: uri(previous, from), isEgg: previous === 'digitama' },
            to: { spriteUri: uri(stage, to), name: displayName(to), stage: STAGE_LABELS[stage] },
        });
    }

    previewAppearance(appearance: Appearance | undefined): void {
        this._preview = appearance;
        this._postState();
    }

    dispose(): void {
        this._subscriptions.forEach(subscription => subscription.dispose());
    }

    private _postState(): void {
        const view = this._view;
        if (!view) {
            return;
        }
        const now = Date.now();
        const game = this._controller.game;
        const state = activeBuddy(game);
        const currentMood = mood(state, now);
        const ready = isReadyToChoose(state);
        void view.webview.postMessage({
            type: 'state',
            name: displayName(species(state)),
            stage: STAGE_LABELS[state.stage],
            spriteUri: this._spriteUri(view.webview, state),
            isEgg: state.stage === 'digitama',
            mood: currentMood,
            moodLabel: ready && currentMood !== 'sleeping' ? 'Ready to digivolve' : MOOD_LABELS[currentMood],
            choice: ready ? this._choice(view.webview, state) : null,
            fullness: state.fullness / RULES.maxFullness,
            energy: state.energy / RULES.maxEnergy,
            level: levelOf(state.xp),
            levelXp: Math.floor(state.xp - xpForLevel(levelOf(state.xp))),
            levelXpNeeded: xpForLevel(levelOf(state.xp) + 1) - xpForLevel(levelOf(state.xp)),
            evolveAtLevel: nextEvolutionLevel(state),
            nextStage: state.stage === 'ultimate' ? null : STAGE_LABELS[STAGES[STAGES.indexOf(state.stage) + 1]],
            appearance: this._preview ?? savedAppearance(),
            age: formatDuration(state.ageMs),
            claudeStatus: this._claudeStatus,
            claudeLabel: claudeLabel(this._claudeStatus, this._claudeWaiting),
            bits: game.bits,
            food: (Object.keys(FOODS) as FoodKind[]).map(kind => ({
                kind,
                name: FOODS[kind].name,
                price: ROSTER.foodPrices[kind],
                effect: foodEffect(kind),
            })),
            nextEgg: eggProgress(game),
            roster: game.buddies.map(buddy => ({
                id: buddy.id,
                name: displayName(species(buddy)),
                stage: STAGE_LABELS[buddy.stage],
                spriteUri: this._spriteUri(view.webview, buddy),
                isEgg: buddy.stage === 'digitama',
                active: buddy.id === game.activeId,
            })),
            maxBuddies: ROSTER.maxBuddies,
            eggOffer: this._eggOffer(view.webview, game),
            eggsWaiting: game.eggOffers.length,
            partyFull: isPartyFull(game),
        });
    }

    /** The oldest waiting egg offer, with each line's Digitama sprite to preview. */
    private _eggOffer(webview: vscode.Webview,
        game: GameState,
    ) {
        const offer = game.eggOffers[0];
        if (!offer) {
            return null;
        }
        return offer.map(lineId => {
            const line = findLine(lineId)!;
            return {
                lineId,
                name: displayName(line.child),
                spriteUri: webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, ...spritePath('digitama', line.digitama))).toString(),
            };
        });
    }

    /** Both Adult paths for a waiting Child, with the Adult sprite to preview. */
    private _choice(webview: vscode.Webview,
        state: PetState,
    ) {
        const line = findLine(state.lineId)!;
        return BRANCHES.map(branch => {
            const forms = branch === 'good' ? line.good : line.bad;
            return {
                branch,
                name: displayName(forms[0]),
                next: forms.slice(1).map(displayName),
                spriteUri: webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, ...spritePath('adult', forms[0]))).toString(),
            };
        });
    }

    private _spriteUri(webview: vscode.Webview,
        pet: PetState,
    ): string {
        return webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, ...spritePath(pet.stage, species(pet)))).toString();
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'script.js'));
        const nonce = crypto.randomBytes(16).toString('base64');
        const csp = [
            `default-src 'none'`,
            `img-src ${webview.cspSource}`,
            `style-src ${webview.cspSource}`,
            `font-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`,
        ].join('; ');

        const template = fs.readFileSync(vscode.Uri.joinPath(this._extensionUri, 'media', 'index.html').fsPath, 'utf8');
        return template
            .replace('{{csp}}', csp)
            .replace('{{styleUri}}', styleUri.toString())
            .replace('{{scriptUri}}', scriptUri.toString())
            .replace('{{nonce}}', nonce);
    }
}

export function savedAppearance(): Appearance {
    const config = vscode.workspace.getConfiguration('digimon.appearance');
    return resolveAppearance(config.get('screen'));
}

function foodEffect(kind: FoodKind): string {
    const { fullness, energy } = FOODS[kind];
    if (fullness >= RULES.maxFullness && energy >= RULES.maxEnergy) {
        return 'Refills fullness and energy';
    }
    return [fullness > 0 && `+${fullness} fullness`, energy > 0 && `+${energy} energy`].filter(Boolean).join(', ');
}

function formatDuration(ms: number): string {
    const minutes = Math.floor(ms / 60_000);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
