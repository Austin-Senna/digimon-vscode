import * as path from 'path';
import * as vscode from 'vscode';
import { DigimonPlaygroundProvider } from './DigimonPlaygroundProvider';
import { PetController } from './PetController';
import { trackActivity } from './activity';
import { connectClaude } from './claude/bridge';
import { registerClaudeInstall } from './claude/install';
import { GameEvent, GameState } from './model/game';
import { FOODS, FoodKind, PetState, isReadyToChoose, species } from './model/pet';
import { BRANCHES, STAGE_LABELS, displayName, findLine } from './model/species';
import { GameStore } from './store';

/** Pre-roster versions kept a single pet here; it is migrated into the save file once. */
const LEGACY_STATE_KEY = 'digimon.pet';

/** Exposed for integration tests. */
export interface DigimonApi {
	readonly state: () => PetState;
	readonly game: () => GameState;
}

export function activate(context: vscode.ExtensionContext): DigimonApi {
	const store = new GameStore(
		path.join(context.globalStorageUri.fsPath, 'game.json'),
		() => context.globalState.get(LEGACY_STATE_KEY),
	);
	const controller = new PetController(store);
	const playgroundProvider = new DigimonPlaygroundProvider(context.extensionUri, controller);

	context.subscriptions.push(
		controller,
		playgroundProvider,
		vscode.window.registerWebviewViewProvider('digimonPlayground', playgroundProvider),
		vscode.commands.registerCommand('digimon.feed', () => pickFood(controller)),
		vscode.commands.registerCommand('digimon.chooseEvolution', () => pickEvolution(controller)),
		vscode.commands.registerCommand('digimon.switchBuddy', () => pickBuddy(controller)),
		vscode.commands.registerCommand('digimon.releaseBuddy', () => release(controller)),
		vscode.commands.registerCommand('digimon.startOver', async () => {
			const choice = await vscode.window.showWarningMessage(
				'Start over with a single new Digitama?',
				{ modal: true, detail: 'Every buddy, food item, and milestone is lost for good.' },
				'Start Over',
			);
			if (choice === 'Start Over') {
				controller.startOver();
			}
		}),
		vscode.commands.registerCommand('digimon.openSaveFolder', () =>
			vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(store.file))),
		controller.onDidChange(events => events.forEach(notify)),
		trackActivity(controller),
		connectClaude(controller, playgroundProvider),
		registerClaudeInstall(context),
	);
	return { state: () => controller.state, game: () => controller.game };
}

async function pickFood(controller: PetController): Promise<void> {
	const game = controller.game;
	const items = (Object.keys(FOODS) as FoodKind[]).map(kind => ({
		label: FOODS[kind].name,
		description: `× ${game.food[kind]}`,
		food: kind,
	}));
	const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Feed your Digimon' });
	if (choice) {
		controller.feed(choice.food);
	}
}

async function pickEvolution(controller: PetController): Promise<void> {
	const pet = controller.state;
	if (!isReadyToChoose(pet)) {
		void vscode.window.showInformationMessage(pet.stage === 'child'
			? 'Your Child is not ready to digivolve yet (it needs more XP, and it cannot evolve while starving).'
			: 'Only a Child that has earned enough XP can choose its evolution.');
		return;
	}
	const line = findLine(pet.lineId)!;
	const items = BRANCHES.map(branch => {
		const forms = (branch === 'good' ? line.good : line.bad).map(displayName);
		return { label: forms[0], description: `then ${forms[1]}, then ${forms[2]}`, branch };
	});
	const choice = await vscode.window.showQuickPick(items, { placeHolder: `What should ${displayName(species(pet))} become?` });
	if (choice) {
		controller.choose(choice.branch);
	}
}

function buddyItems(game: GameState,
	includeActive: boolean,
) {
	return game.buddies
		.filter(buddy => includeActive || buddy.id !== game.activeId)
		.map(buddy => ({
			label: displayName(species(buddy)),
			description: `${STAGE_LABELS[buddy.stage]}${buddy.id === game.activeId ? ' (active)' : ''}`,
			id: buddy.id,
		}));
}

async function pickBuddy(controller: PetController): Promise<void> {
	const choice = await vscode.window.showQuickPick(buddyItems(controller.game, true), { placeHolder: 'Switch buddy' });
	if (choice) {
		controller.switchTo(choice.id);
	}
}

async function release(controller: PetController): Promise<void> {
	const items = buddyItems(controller.game, false);
	if (items.length === 0) {
		void vscode.window.showInformationMessage('Your only buddy is the active one, which cannot be released.');
		return;
	}
	const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Release a buddy (the active one cannot be released)' });
	if (!choice) {
		return;
	}
	const confirm = await vscode.window.showWarningMessage(
		`Release ${choice.label}?`,
		{ modal: true, detail: 'It is gone for good. A waiting egg, if any, takes its slot.' },
		'Release',
	);
	if (confirm === 'Release') {
		controller.release(choice.id);
	}
}

function notify(event: GameEvent): void {
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
		case 'readyToChoose':
			void vscode.window.showInformationMessage('Your Digimon is ready to digivolve! Choose its path.', 'Choose').then(choice => {
				if (choice === 'Choose') {
					void vscode.commands.executeCommand('digimon.chooseEvolution');
				}
			});
			break;
		case 'eggEarned':
			void vscode.window.showInformationMessage(event.waiting
				? 'You earned a new egg, but your roster is full. Release a buddy to make room.'
				: 'You earned a new egg! Click it in your roster to raise it.');
			break;
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
