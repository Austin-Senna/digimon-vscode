import * as vscode from 'vscode';
import { DigimonPlaygroundProvider } from './DigimonPlaygroundProvider';
import { PetController } from './PetController';
import { trackActivity } from './activity';
import { connectClaude } from './claude/bridge';
import { registerClaudeInstall } from './claude/install';
import { PetEvent, PetState } from './model/pet';
import { STAGE_LABELS, displayName } from './model/species';

/** Exposed for integration tests. */
export interface DigimonApi {
	readonly state: () => PetState;
}

export function activate(context: vscode.ExtensionContext): DigimonApi {
	const controller = new PetController(context.globalState);
	const playgroundProvider = new DigimonPlaygroundProvider(context.extensionUri, controller);

	context.subscriptions.push(
		controller,
		playgroundProvider,
		vscode.window.registerWebviewViewProvider('digimonPlayground', playgroundProvider),
		vscode.commands.registerCommand('digimon.feed', () => controller.feed()),
		vscode.commands.registerCommand('digimon.newEgg', async () => {
			const choice = await vscode.window.showWarningMessage(
				'Start over with a new Digitama? Your current Digimon will be gone for good.',
				{ modal: true },
				'New Egg',
			);
			if (choice === 'New Egg') {
				controller.newEgg();
			}
		}),
		controller.onDidChange(events => events.forEach(notify)),
		trackActivity(controller),
		connectClaude(controller, playgroundProvider),
		registerClaudeInstall(context),
	);
	return { state: () => controller.state };
}

function notify(event: PetEvent): void {
	if (!vscode.workspace.getConfiguration('digimon').get<boolean>('notifications', true)) {
		return;
	}
	switch (event.kind) {
		case 'evolved': {
			const verb = event.stage === 'babyI' ? 'hatched into' : 'digivolved into';
			void vscode.window.showInformationMessage(
				`${displayName(event.from)} ${verb} ${displayName(event.to)} (${STAGE_LABELS[event.stage]})!`,
			);
			break;
		}
		case 'starving':
			void vscode.window.showWarningMessage('Your Digimon is starving.', 'Feed').then(choice => {
				if (choice === 'Feed') {
					void vscode.commands.executeCommand('digimon.feed');
				}
			});
			break;
		case 'exhausted':
			void vscode.window.showInformationMessage('Your Digimon is exhausted. It earns half XP until you both take a break.');
			break;
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
