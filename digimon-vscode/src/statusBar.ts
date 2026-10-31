import * as vscode from 'vscode';
import { PetController } from './PetController';
import { activeBuddy } from './model/game';
import { RULES, species } from './model/pet';
import { displayName } from './model/species';
import { statusText } from './statusText';

/** Opens the Digimon view, so it is one click away even in a window where the sidebar is closed. */
export const OPEN_VIEW_COMMAND = 'workbench.view.extension.Digimon-Buddy';

/** Refresh often enough for the frenzy countdown, which changes with no game event. */
const REFRESH_MS = 30_000;

export function createStatusBar(controller: PetController): vscode.Disposable {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100);
    item.name = 'Digimon Buddy';
    item.command = OPEN_VIEW_COMMAND;
    const refresh = () => {
        const game = controller.game;
        const buddy = activeBuddy(game);
        item.text = statusText(game, Date.now());
        const fullness = Math.round(buddy.fullness / RULES.maxFullness * 100);
        const energy = Math.round(buddy.energy / RULES.maxEnergy * 100);
        item.tooltip = `${displayName(species(buddy))}: ${fullness}% full, ${energy}% energy. Click to open.`;
    };
    refresh();
    item.show();
    const timer = setInterval(refresh, REFRESH_MS);
    const subscription = controller.onDidChange(refresh);
    return new vscode.Disposable(() => {
        clearInterval(timer);
        subscription.dispose();
        item.dispose();
    });
}
