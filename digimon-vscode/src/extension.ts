import * as vscode from 'vscode';
import { DigimonStatsProvider } from './DigimonStatsProvider';
import { DigiviceProvider } from './DigiviceProvider';
export function activate(context: vscode.ExtensionContext) {
	const digimonStatsProvider = new DigimonStatsProvider();

	vscode.window.createTreeView('digimonView', {
		treeDataProvider: digimonStatsProvider
	});

	let disposable = vscode.commands.registerCommand('digimon-vscode.refreshStats', () => {
		digimonStatsProvider.refresh();
	});

	const digiviceProvider = new DigiviceProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'digimonEnclosureView', 
            digiviceProvider
        )
    );
}
// This method is called when your extension is deactivated
export function deactivate() {}
