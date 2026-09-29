import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ClaudeSettings, hookInstallState, withDigimonHooks, withoutDigimonHooks } from './hooks';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
/** Stable copy of the bundled hook; the extension's own folder changes on every update. */
const INSTALLED_HOOK = path.join(CLAUDE_DIR, 'digimon', 'hook.py');
/** Written with `$HOME` so the settings file stays portable across machines that sync it. */
// -I ignores PYTHON* env vars and the user site dir, so nothing can inject code into the hook; -S skips site import (faster start).
export const HOOK_COMMAND = 'python3 -I -S "$HOME/.claude/digimon/hook.py"';
const DONT_ASK_KEY = 'digimon.claude.dontAskToConnect';

export function registerClaudeInstall(context: vscode.ExtensionContext): vscode.Disposable {
    // Tests run against the real home directory; never touch ~/.claude from them.
    if (context.extensionMode !== vscode.ExtensionMode.Test) {
        syncHookScript(context.extensionUri);
        void offerToConnect(context);
    }
    return vscode.Disposable.from(
        vscode.commands.registerCommand('digimon.connectClaude', () => connect(context.extensionUri)),
        vscode.commands.registerCommand('digimon.disconnectClaude', disconnect),
    );
}

/** Keep ~/.claude/digimon/hook.py identical to the version bundled with this extension. */
function syncHookScript(extensionUri: vscode.Uri): void {
    try {
        const bundled = fs.readFileSync(vscode.Uri.joinPath(extensionUri, 'claude-hook', 'digimon_claude', 'hook.py').fsPath);
        const installed = fs.existsSync(INSTALLED_HOOK) ? fs.readFileSync(INSTALLED_HOOK) : undefined;
        if (!installed?.equals(bundled)) {
            fs.mkdirSync(path.dirname(INSTALLED_HOOK), { recursive: true });
            fs.writeFileSync(INSTALLED_HOOK, bundled);
        }
    } catch (error) {
        console.error('Digimon: could not install the Claude hook script', error);
    }
}

async function offerToConnect(context: vscode.ExtensionContext): Promise<void> {
    if (!vscode.workspace.getConfiguration('digimon.claude').get<boolean>('enabled', true)
        || context.globalState.get<boolean>(DONT_ASK_KEY)
        || !fs.existsSync(CLAUDE_DIR)) {
        return;
    }
    const settings = readSettings();
    const state = settings ? hookInstallState(settings, HOOK_COMMAND) : 'missing';
    if (state === 'installed') {
        return;
    }
    const message = state === 'outdated'
        ? 'Your Claude Code Digimon hooks point at an old location. Update them?'
        : 'Let your Claude Code sessions feed your Digimon? This adds hooks to ~/.claude/settings.json.';
    const action = state === 'outdated' ? 'Update Hooks' : 'Connect';
    const choice = await vscode.window.showInformationMessage(message, action, "Don't Ask Again");
    if (choice === action) {
        await connect(context.extensionUri);
    } else if (choice === "Don't Ask Again") {
        await context.globalState.update(DONT_ASK_KEY, true);
    }
}

async function connect(extensionUri: vscode.Uri): Promise<void> {
    syncHookScript(extensionUri);
    const settings = readSettings();
    if (!settings) {
        return;
    }
    if (hookInstallState(settings, HOOK_COMMAND) === 'installed') {
        void vscode.window.showInformationMessage('Claude Code is already connected to your Digimon.');
        return;
    }
    const confirm = await vscode.window.showWarningMessage(
        'Add Digimon hooks to ~/.claude/settings.json?',
        {
            modal: true,
            detail: `Nine async hooks will run ${HOOK_COMMAND}, which logs Claude activity to ~/.claude/digimon/events.jsonl. `
                + 'Other settings and hooks are kept, and a backup is saved as settings.json.digimon-backup. Requires python3.',
        },
        'Connect',
    );
    if (confirm !== 'Connect') {
        return;
    }
    if (writeSettings(withDigimonHooks(settings, HOOK_COMMAND))) {
        void vscode.window.showInformationMessage('Claude Code connected. New Claude sessions will feed your Digimon.');
    }
}

async function disconnect(): Promise<void> {
    const settings = readSettings();
    if (!settings) {
        return;
    }
    if (hookInstallState(settings, HOOK_COMMAND) === 'missing') {
        void vscode.window.showInformationMessage('No Digimon hooks found in ~/.claude/settings.json.');
        return;
    }
    if (writeSettings(withoutDigimonHooks(settings))) {
        void vscode.window.showInformationMessage('Digimon hooks removed from Claude Code.');
    }
}

/** Parsed settings, `{}` when the file does not exist, or undefined (after telling the user) when it is unreadable. */
function readSettings(): ClaudeSettings | undefined {
    let text: string;
    try {
        text = fs.readFileSync(SETTINGS_PATH, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {};
        }
        void vscode.window.showErrorMessage(`Could not read ${SETTINGS_PATH}: ${(error as Error).message}`);
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed as ClaudeSettings;
        }
    } catch {
        // Fall through to the error below.
    }
    void vscode.window.showErrorMessage(`${SETTINGS_PATH} is not a JSON object, so the Digimon hooks were not changed. Fix the file and try again.`);
    return undefined;
}

/** Back up, then replace atomically so a crash never leaves Claude with a half-written settings file. */
function writeSettings(settings: ClaudeSettings): boolean {
    try {
        fs.mkdirSync(CLAUDE_DIR, { recursive: true });
        // Write through a symlink (e.g. a dotfiles repo) instead of replacing the link with a plain file.
        const target = fs.existsSync(SETTINGS_PATH) ? fs.realpathSync(SETTINGS_PATH) : SETTINGS_PATH;
        let mode = 0o600;
        if (fs.existsSync(target)) {
            fs.copyFileSync(target, `${SETTINGS_PATH}.digimon-backup`);
            mode = fs.statSync(target).mode & 0o777;
        }
        const temp = `${target}.digimon-tmp`;
        fs.writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n', { mode });
        fs.renameSync(temp, target);
        return true;
    } catch (error) {
        void vscode.window.showErrorMessage(`Could not update ${SETTINGS_PATH}: ${(error as Error).message}`);
        return false;
    }
}
