// Digivice looks. Each id has matching `[data-shell]` / `[data-screen]` rules in media/styles.css,
// and package.json lists the same ids as the settings' enums; a unit test keeps all three in sync.

export interface Preset {
    readonly id: string;
    readonly label: string;
}

export const SHELLS: readonly Preset[] = [
    { id: 'silver', label: 'Silver' },
    { id: 'orange', label: 'Orange' },
    { id: 'blue', label: 'Blue' },
    { id: 'pink', label: 'Pink' },
    { id: 'purple', label: 'Purple' },
    { id: 'green', label: 'Green' },
    { id: 'yellow', label: 'Yellow' },
    { id: 'black', label: 'Black' },
    { id: 'none', label: 'No shell' },
];

export const SCREENS: readonly Preset[] = [
    { id: 'lcd', label: 'Dark LCD' },
    { id: 'classic', label: 'Classic LCD' },
    { id: 'night', label: 'Night sky' },
    { id: 'sky', label: 'Day sky' },
    { id: 'sunset', label: 'Sunset' },
    { id: 'meadow', label: 'Meadow' },
];

export const DEFAULT_APPEARANCE = { shell: 'silver', screen: 'lcd' } as const;

export interface Appearance {
    readonly shell: string;
    readonly screen: string;
}

/** Settings values, falling back to defaults for anything unknown (e.g. hand-edited settings.json). */
export function resolveAppearance(shell: unknown,
    screen: unknown,
): Appearance {
    return {
        shell: SHELLS.some(preset => preset.id === shell) ? shell as string : DEFAULT_APPEARANCE.shell,
        screen: SCREENS.some(preset => preset.id === screen) ? screen as string : DEFAULT_APPEARANCE.screen,
    };
}
