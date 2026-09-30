import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { PetController } from './PetController';
import { ClaudeAnimation, ClaudeListener } from './claude/bridge';
import { ClaudeStatus } from './claude/events';
import { GameEvent, ROSTER, activeBuddy, milestoneProgress } from './model/game';
import { FOODS, FoodKind, Mood, PetState, RULES, isReadyToChoose, mood, species, xpForNextStage } from './model/pet';
import { BRANCHES, Branch, STAGE_LABELS, displayName, findLine, spritePath } from './model/species';

type Animation = ClaudeAnimation | 'eat' | 'evolve';

const MOOD_LABELS: Record<Mood, string> = {
    sleeping: 'Sleeping',
    starving: 'Starving',
    exhausted: 'Exhausted, take a break',
    hungry: 'Hungry',
    happy: 'Happy',
};

const CLAUDE_LABELS: Record<ClaudeStatus, string> = {
    idle: '',
    working: 'Claude is working',
    waiting: 'Claude needs you',
};

const EVENT_ANIMATIONS: Partial<Record<GameEvent['kind'], Animation>> = {
    ate: 'eat',
    refused: 'refuse',
    noFood: 'refuse',
    woke: 'happy',
    evolved: 'evolve',
    switched: 'happy',
};

export class DigimonPlaygroundProvider implements vscode.WebviewViewProvider, ClaudeListener, vscode.Disposable {
    private _view: vscode.WebviewView | undefined;
    private _claudeStatus: ClaudeStatus = 'idle';
    private readonly _subscription: vscode.Disposable;

    constructor(private readonly _extensionUri: vscode.Uri,
        private readonly _controller: PetController,
    ) {
        this._subscription = _controller.onDidChange(events => {
            this._postState();
            for (const event of events) {
                const animation = EVENT_ANIMATIONS[event.kind];
                if (animation) {
                    this.play(animation);
                }
            }
        });
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
            } else if (message?.type === 'switch' && typeof message.id === 'string') {
                this._controller.switchTo(message.id);
            }
        });
        webviewView.onDidDispose(() => {
            this._view = undefined;
        });
    }

    setClaudeStatus(status: ClaudeStatus): void {
        this._claudeStatus = status;
        this._postState();
    }

    play(animation: Animation): void {
        void this._view?.webview.postMessage({ type: 'play', animation });
    }

    dispose(): void {
        this._subscription.dispose();
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
            xp: Math.floor(state.xp),
            xpNext: xpForNextStage(state),
            age: formatDuration(state.ageMs),
            claudeStatus: this._claudeStatus,
            claudeLabel: CLAUDE_LABELS[this._claudeStatus],
            food: (Object.keys(FOODS) as FoodKind[]).map(kind => ({
                kind,
                name: FOODS[kind].name,
                count: game.food[kind],
                effect: foodEffect(kind),
                every: ROSTER.milestones[kind],
            })),
            nextFood: milestoneProgress(game, 'meat'),
            nextEgg: milestoneProgress(game, 'egg'),
            roster: game.buddies.map(buddy => ({
                id: buddy.id,
                name: displayName(species(buddy)),
                stage: STAGE_LABELS[buddy.stage],
                spriteUri: this._spriteUri(view.webview, buddy),
                isEgg: buddy.stage === 'digitama',
                active: buddy.id === game.activeId,
            })),
            maxBuddies: ROSTER.maxBuddies,
            pendingEggs: game.pendingEggs,
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
