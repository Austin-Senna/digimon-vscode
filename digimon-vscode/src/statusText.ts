import { GameState, activeBuddy, isFrenzy } from './model/game';
import { levelOf, species } from './model/pet';
import { displayName } from './model/species';

/** Status bar label for the active buddy, with the minutes left in a coding frenzy. Uses codicon syntax. */
export function statusText(game: GameState,
    now: number,
): string {
    const buddy = activeBuddy(game);
    const label = `${displayName(species(buddy))} Lv ${levelOf(buddy.xp)}`;
    return isFrenzy(game, now) ? `${label} $(flame) ${Math.ceil((game.frenzyUntil - now) / 60_000)}m` : label;
}
