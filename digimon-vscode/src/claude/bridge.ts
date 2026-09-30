import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { PetController } from '../PetController';
import { ClaudeEvent, ClaudeStatus, SessionTracker, isWithin, parseEventLine } from './events';
import { LineTailer } from './tailer';
import { terminalRunning } from './terminal';

export type ClaudeAnimation = 'happy' | 'refuse' | 'sad';

export interface ClaudeListener {
    /** `waiting` is how many sessions in scope are blocked on the user. */
    setClaudeStatus(status: ClaudeStatus, waiting: number): void;
    play(animation: ClaudeAnimation): void;
}

const ANIMATIONS: Partial<Record<ClaudeEvent['event'], ClaudeAnimation>> = {
    stop: 'happy',
    tool_failed: 'refuse',
    error: 'sad',
};
const STATUS_REFRESH_MS = 15_000;

/**
 * Feeds Claude Code sessions into the pet: every session, or with `digimon.claude.scope` set to `workspace`,
 * only those working in this window's folders. Events come from the Claude hook (claude-hook/) via an
 * append-only JSONL log.
 */
export function connectClaude(controller: PetController,
    listener: ClaudeListener,
): vscode.Disposable {
    let session: ReturnType<typeof start>;
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
        vscode.commands.registerCommand('digimon.focusClaude', () => focusWaiting(session?.tracker)),
        new vscode.Disposable(() => session?.dispose()),
    );
}

function start(controller: PetController,
    listener: ClaudeListener,
): (vscode.Disposable & { tracker: SessionTracker }) | undefined {
    const config = vscode.workspace.getConfiguration('digimon.claude');
    if (!config.get<boolean>('enabled', true)) {
        listener.setClaudeStatus('idle', 0);
        return undefined;
    }
    const everywhere = config.get<'all' | 'workspace'>('scope', 'all') === 'all';
    const inScope = (cwd: string) => everywhere || isWithin(cwd, (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
    const tracker = new SessionTracker();
    let shown = '';
    const refresh = () => {
        const now = Date.now();
        const waiting = tracker.sessions(now).filter(session => session.status === 'waiting').length;
        const status = tracker.status(now);
        if (`${status}:${waiting}` !== shown) {
            shown = `${status}:${waiting}`;
            listener.setClaudeStatus(status, waiting);
        }
    };

    const tailer = new LineTailer(expandHome(config.get<string>('eventsPath', '~/.claude/digimon/events.jsonl')), text => {
        const event = parseEventLine(text);
        if (!event || !inScope(event.cwd)) {
            return;
        }
        tracker.apply(event);
        refresh();
        // Every window credits through the shared save, which pays for each event once however many windows see it.
        controller.recordClaudeEvent(event);
        const animation = ANIMATIONS[event.event];
        if (animation) {
            listener.play(animation);
        }
    });
    const timer = setInterval(refresh, STATUS_REFRESH_MS);
    refresh();

    return Object.assign(new vscode.Disposable(() => {
        clearInterval(timer);
        tailer.dispose();
        listener.setClaudeStatus('idle', 0);
    }), { tracker });
}

/** Jump to the terminal running the most recent session that is waiting on the user. */
async function focusWaiting(tracker: SessionTracker | undefined): Promise<void> {
    const waiting = tracker?.sessions(Date.now()).find(session => session.status === 'waiting');
    if (!waiting) {
        void vscode.window.showInformationMessage('No Claude session is waiting on you.');
        return;
    }
    const terminal = waiting.ppid === undefined ? undefined : await terminalRunning(waiting.ppid);
    if (terminal) {
        terminal.show();
        return;
    }
    void vscode.window.showInformationMessage(
        `Claude is waiting in ${path.basename(waiting.cwd) || waiting.cwd}, outside this window's terminals (for example the Claude panel or another terminal app).`);
}

function expandHome(file: string): string {
    return file === '~' || file.startsWith('~/') ? path.join(os.homedir(), file.slice(1)) : file;
}
