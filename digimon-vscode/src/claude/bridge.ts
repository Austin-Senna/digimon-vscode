import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { PetController } from '../PetController';
import { ClaudeEvent, ClaudeStatus, SessionTracker, isWithin, parseEventLine } from './events';
import { LineTailer } from './tailer';

export type ClaudeAnimation = 'happy' | 'refuse' | 'sad';

export interface ClaudeListener {
    setClaudeStatus(status: ClaudeStatus): void;
    play(animation: ClaudeAnimation): void;
}

const ANIMATIONS: Partial<Record<ClaudeEvent['event'], ClaudeAnimation>> = {
    stop: 'happy',
    tool_failed: 'refuse',
    error: 'sad',
};
const STATUS_REFRESH_MS = 15_000;

/**
 * Feeds Claude Code sessions working in this window's workspace into the pet.
 * Events come from the digimon-claude hooks via an append-only JSONL log.
 */
export function connectClaude(controller: PetController,
    listener: ClaudeListener,
): vscode.Disposable {
    let session: vscode.Disposable | undefined;
    const restart = () => {
        session?.dispose();
        session = start(controller, listener);
    };
    restart();

    return vscode.Disposable.from(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('digimon.claude')) {
                restart();
            }
        }),
        new vscode.Disposable(() => session?.dispose()),
    );
}

function start(controller: PetController,
    listener: ClaudeListener,
): vscode.Disposable | undefined {
    const config = vscode.workspace.getConfiguration('digimon.claude');
    if (!config.get<boolean>('enabled', true)) {
        listener.setClaudeStatus('idle');
        return undefined;
    }
    const tracker = new SessionTracker();
    let status: ClaudeStatus = 'idle';
    const refreshStatus = () => {
        const next = tracker.status(Date.now());
        if (next !== status) {
            status = next;
            listener.setClaudeStatus(status);
        }
    };

    const tailer = new LineTailer(expandHome(config.get<string>('eventsPath', '~/.claude/digimon/events.jsonl')), text => {
        const event = parseEventLine(text);
        const folders = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
        if (!event || !isWithin(event.cwd, folders)) {
            return;
        }
        tracker.apply(event);
        refreshStatus();
        if (event.event === 'prompt') {
            controller.recordActivity('prompt');
        } else if (event.event === 'tool_done') {
            controller.recordActivity('agentTool');
        }
        const animation = ANIMATIONS[event.event];
        if (animation) {
            listener.play(animation);
        }
    });
    const timer = setInterval(refreshStatus, STATUS_REFRESH_MS);

    return new vscode.Disposable(() => {
        clearInterval(timer);
        tailer.dispose();
        listener.setClaudeStatus('idle');
    });
}

function expandHome(file: string): string {
    return file === '~' || file.startsWith('~/') ? path.join(os.homedir(), file.slice(1)) : file;
}
