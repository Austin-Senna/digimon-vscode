// Screen backgrounds. Each id has a matching `[data-screen]` rule in media/styles.css, and package.json lists the
// same ids as the setting's enum; a unit test keeps all three in sync.

export interface Preset {
    readonly id: string;
    readonly label: string;
}

export const SCREENS: readonly Preset[] = [
    { id: 'lcd', label: 'Dark LCD' },
    { id: 'classic', label: 'Classic LCD' },
    { id: 'night', label: 'Night sky' },
    { id: 'sky', label: 'Day sky' },
    { id: 'sunset', label: 'Sunset' },
    { id: 'meadow', label: 'Meadow' },
];

export const DEFAULT_APPEARANCE = { screen: 'lcd' } as const;

export interface Appearance {
    readonly screen: string;
}

/** Settings value, falling back to the default for anything unknown (e.g. hand-edited settings.json). */
export function resolveAppearance(screen: unknown): Appearance {
    return { screen: SCREENS.some(preset => preset.id === screen) ? screen as string : DEFAULT_APPEARANCE.screen };
}
