import * as path from 'path';
import * as vscode from 'vscode';
import { DigimonPlaygroundProvider, savedAppearance } from './DigimonPlaygroundProvider';
import { Preset, SCREENS } from './appearance';
import { PetController } from './PetController';
import { trackActivity } from './activity';
import { connectClaude } from './claude/bridge';
import { registerClaudeInstall } from './claude/install';
import { GameEvent, GameState, ROSTER, isPartyFull } from './model/game';
import { FOODS, FoodKind, PetState, isReadyToChoose, species, speciesAt, unlockedForms } from './model/pet';
import { OPEN_VIEW_COMMAND, createStatusBar } from './statusBar';
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
		vscode.commands.registerCommand('digimon.shop', () => shop(controller)),
		vscode.commands.registerCommand('digimon.changeForm', () => pickForm(controller)),
		vscode.commands.registerCommand('digimon.crackEgg', () => confirmCrack(controller)),
		vscode.commands.registerCommand('digimon.customize', () => customize(playgroundProvider)),
		vscode.commands.registerCommand('digimon.chooseEvolution', () => pickEvolution(controller)),
		vscode.commands.registerCommand('digimon.chooseEgg', () => pickEgg(controller)),
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
		createStatusBar(controller),
	);
	if (vscode.workspace.getConfiguration('digimon').get<boolean>('openOnStartup', false)) {
		// Opening the view focuses it; hand focus straight back so the editor keeps the cursor.
		void Promise.resolve(vscode.commands.executeCommand(OPEN_VIEW_COMMAND))
			.then(() => vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'));
	}
	return { state: () => controller.state, game: () => controller.game };
}

type ShopItem = vscode.QuickPickItem & { action: () => void };

async function shop(controller: PetController): Promise<void> {
	const game = controller.game;
	const short = (price: number) => game.bits < price ? ' (not enough bits)' : '';
	const items: ShopItem[] = (Object.keys(FOODS) as FoodKind[]).map(kind => ({
		label: FOODS[kind].name,
		description: `${ROSTER.foodPrices[kind]} bits${short(ROSTER.foodPrices[kind])}`,
		action: () => controller.feed(kind),
	}));
	items.push({
		label: 'XP Potion',
		description: `${ROSTER.potionPrice.toLocaleString()} bits, +${ROSTER.potionXp.toLocaleString()} XP${short(ROSTER.potionPrice)}`,
		action: () => controller.buyPotion(),
	});
	if (game.potions > 0) {
		items.push({ label: 'Drink XP Potion', description: `${game.potions} owned`, action: () => controller.drinkPotion() });
	}
	const choice = await vscode.window.showQuickPick(items, { placeHolder: `Shop (you have ${game.bits.toLocaleString()} bits)` });
	choice?.action();
}

async function pickForm(controller: PetController): Promise<void> {
	const pet = controller.state;
	const forms = unlockedForms(pet);
	if (forms.length < 2) {
		void vscode.window.showInformationMessage('Your Digimon has no other forms yet. Each stage it reaches unlocks one.');
		return;
	}
	const items = forms.map(form => ({
		label: displayName(speciesAt(pet, form)),
		description: `${STAGE_LABELS[form]}${form === pet.form ? ' (current)' : ''}`,
		form,
	}));
	const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Change form (level and XP stay the same)' });
	if (choice) {
		controller.setForm(choice.form);
	}
}

async function confirmCrack(controller: PetController): Promise<void> {
	// Remember which egg the player is agreeing to crack: another window may take it while the modal is open.
	const offer = controller.game.eggOffers[0];
	if (!offer) {
		return;
	}
	const choice = await vscode.window.showWarningMessage(
		`Crack this egg into ${ROSTER.potionsPerEgg} XP potions?`,
		{ modal: true, detail: 'The egg is gone for good.' },
		'Crack',
	);
	if (choice === 'Crack') {
		controller.crackEgg(offer);
	}
}

/** Pick a screen background, previewing each option live; nothing is saved until one is accepted. */
async function customize(provider: DigimonPlaygroundProvider): Promise<void> {
	const saved = savedAppearance();
	const screen = await pickPreset(SCREENS, saved.screen, 'Screen background', id => provider.previewAppearance({ screen: id }));
	provider.previewAppearance(undefined);
	if (screen) {
		await vscode.workspace.getConfiguration('digimon.appearance').update('screen', screen, vscode.ConfigurationTarget.Global);
	}
}

function pickPreset(presets: readonly Preset[],
	current: string,
	title: string,
	preview: (id: string) => void,
): Promise<string | undefined> {
	return new Promise(resolve => {
		const pick = vscode.window.createQuickPick<vscode.QuickPickItem & { id: string }>();
		pick.title = title;
		pick.items = presets.map(preset => ({ label: preset.label, description: preset.id === current ? 'current' : undefined, id: preset.id }));
		pick.activeItems = pick.items.filter(item => item.id === current);
		pick.onDidChangeActive(([item]) => item && preview(item.id));
		pick.onDidAccept(() => {
			resolve(pick.selectedItems[0]?.id);
			pick.hide();
		});
		pick.onDidHide(() => {
			resolve(undefined);
			pick.dispose();
		});
		pick.show();
	});
}

async function pickEgg(controller: PetController): Promise<void> {
	const game = controller.game;
	const offer = game.eggOffers[0];
	if (!offer) {
		void vscode.window.showInformationMessage('No egg to choose yet. A new one arrives about once a day of coding.');
		return;
	}
	const crack = `Crack into ${ROSTER.potionsPerEgg} XP potions`;
	const eggs = isPartyFull(game) ? [] : offer.map(lineId => ({ label: `${displayName(findLine(lineId)!.child)} egg`, lineId }));
	const items = [...eggs, { label: crack, lineId: undefined }];
	const placeHolder = isPartyFull(game)
		? `Your party is full (${ROSTER.maxBuddies}). Release a buddy to make room, or crack the egg.`
		: 'Which egg do you want?';
	const choice = await vscode.window.showQuickPick(items, { placeHolder });
	if (choice?.lineId) {
		controller.chooseEgg(choice.lineId);
	} else if (choice) {
		await confirmCrack(controller);
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
			description: `${STAGE_LABELS[buddy.form]}${buddy.id === game.activeId ? ' (active)' : ''}`,
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
		case 'eggOffered':
			void vscode.window.showInformationMessage('You earned a new egg! Choose which one to raise.', 'Choose').then(choice => {
				if (choice === 'Choose') {
					void vscode.commands.executeCommand('digimon.chooseEgg');
				}
			});
			break;
		case 'starving':
			void vscode.window.showWarningMessage('Your Digimon is starving.', 'Feed').then(choice => {
				if (choice === 'Feed') {
					void vscode.commands.executeCommand('digimon.shop');
				}
			});
			break;
		case 'frenzyStarted':
			void vscode.window.showInformationMessage('Coding frenzy! Triple XP for 30 minutes.');
			break;
		case 'exhausted':
			void vscode.window.showInformationMessage('Your Digimon is exhausted. It earns half XP until you both take a break.');
			break;
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
