import * as vscode from 'vscode';
import { PetController } from './PetController';
import { watchCommits } from './git';

/** Documents that represent the user's own code, not output channels, settings UIs, or git diffs. */
const TRACKED_SCHEMES = new Set(['file', 'untitled', 'vscode-notebook-cell', 'vscode-remote']);

export function trackActivity(controller: PetController): vscode.Disposable {
    // Only saves that write real changes count; saving an unchanged file over and over earns nothing.
    const savingChanges = new Set<string>();
    const disposables: vscode.Disposable[] = [
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.contentChanges.length > 0 && TRACKED_SCHEMES.has(event.document.uri.scheme)) {
                controller.recordActivity('edit');
            }
        }),
        vscode.workspace.onWillSaveTextDocument(event => {
            if (event.document.isDirty && TRACKED_SCHEMES.has(event.document.uri.scheme)) {
                savingChanges.add(event.document.uri.toString());
            }
        }),
        vscode.workspace.onDidSaveTextDocument(document => {
            if (savingChanges.delete(document.uri.toString())) {
                controller.recordActivity('save');
            }
        }),
        // Needs shell integration, which VS Code enables for bash, zsh, fish, and PowerShell by default.
        // Only this window's terminals report here, so no other window can credit the same command.
        // Credited on start: by the end event, zsh can report the command line as empty (confidence 0).
        vscode.window.onDidStartTerminalShellExecution(event => {
            if (event.execution.commandLine.value.trim() !== '') {
                controller.recordActivity('command');
            }
        }),
    ];

    let disposed = false;
    watchCommits(() => controller.recordActivity('commit')).then(
        watcher => disposed ? watcher.dispose() : disposables.push(watcher),
        error => console.error('Digimon: git commit tracking unavailable', error),
    );

    return new vscode.Disposable(() => {
        disposed = true;
        disposables.forEach(disposable => disposable.dispose());
    });
}
