import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { PetController } from './PetController';
import { ClaudeAnimation, ClaudeListener } from './claude/bridge';
import { ClaudeStatus } from './claude/events';
import { Mood, PetEvent, RULES, mood, species, xpForNextStage } from './model/pet';
import { STAGE_LABELS, displayName, spritePath } from './model/species';

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

const EVENT_ANIMATIONS: Partial<Record<PetEvent['kind'], Animation>> = {
    ate: 'eat',
    refused: 'refuse',
    woke: 'happy',
    evolved: 'evolve',
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
            if (message?.type === 'ready') {
                this._postState();
            } else if (message?.type === 'feed') {
                this._controller.feed();
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
        const state = this._controller.state;
        const name = species(state);
        const sprite = vscode.Uri.joinPath(this._extensionUri, ...spritePath(state.stage, name));
        const currentMood = mood(state, Date.now());
        void view.webview.postMessage({
            type: 'state',
            name: displayName(name),
            stage: STAGE_LABELS[state.stage],
            spriteUri: view.webview.asWebviewUri(sprite).toString(),
            isEgg: state.stage === 'digitama',
            mood: currentMood,
            moodLabel: MOOD_LABELS[currentMood],
            fullness: state.fullness / RULES.maxFullness,
            energy: state.energy / RULES.maxEnergy,
            xp: Math.floor(state.xp),
            xpNext: xpForNextStage(state),
            careMistakes: state.careMistakes,
            age: formatDuration(state.ageMs),
            claudeStatus: this._claudeStatus,
            claudeLabel: CLAUDE_LABELS[this._claudeStatus],
        });
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

function formatDuration(ms: number): string {
    const minutes = Math.floor(ms / 60_000);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
