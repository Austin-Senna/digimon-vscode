import * as vscode from 'vscode';
import { PetController } from './PetController';
import { watchCommits } from './git';

/** Documents that represent the user's own code, not output channels, settings UIs, or git diffs. */
const TRACKED_SCHEMES = new Set(['file', 'untitled', 'vscode-notebook-cell', 'vscode-remote']);

export function trackActivity(controller: PetController): vscode.Disposable {
    const disposables: vscode.Disposable[] = [
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.contentChanges.length > 0 && TRACKED_SCHEMES.has(event.document.uri.scheme)) {
                controller.recordActivity('edit');
            }
        }),
        vscode.workspace.onDidSaveTextDocument(document => {
            if (TRACKED_SCHEMES.has(document.uri.scheme)) {
                controller.recordActivity('save');
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
