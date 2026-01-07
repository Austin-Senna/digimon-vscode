import * as vscode from 'vscode';
import { DigimonStatsProvider } from './DigimonStatsProvider';
import { DigimonPlaygroundProvider } from './DigimonPlaygroundProvider';
export function activate(context: vscode.ExtensionContext) {
	const digimonStatsProvider = new DigimonStatsProvider();

	vscode.window.createTreeView('digimonView', {
		treeDataProvider: digimonStatsProvider
	});

	let disposable = vscode.commands.registerCommand('digimon-vscode.refreshStats', () => {
		digimonStatsProvider.refresh();
	});

	const digiviceProvider = new DigimonPlaygroundProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'digimonPlayground', 
            digiviceProvider
        )
    );
}
// This method is called when your extension is deactivated
export function deactivate() {}
