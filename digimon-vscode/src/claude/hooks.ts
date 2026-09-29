// Adds and removes the Digimon hook entries in a Claude Code settings object without touching anything else.

/** Claude Code hook events the Digimon hook script understands (see claude-hook/digimon_claude/hook.py). */
export const HOOK_EVENTS = [
    'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'Notification', 'Stop', 'StopFailure',
] as const;

/** Matches the installed script and the pre-merge standalone digimon-claude checkout. */
const DIGIMON_HOOK_PATTERN = /\.claude\/digimon\/hook\.py|digimon_claude\/hook\.py/;

interface HookCommand {
    type?: string;
    command?: string;
    [key: string]: unknown;
}

interface HookGroup {
    matcher?: string;
    hooks?: HookCommand[];
    [key: string]: unknown;
}

export type ClaudeSettings = Record<string, unknown> & { hooks?: Record<string, HookGroup[]> };

export type HookInstallState = 'installed' | 'outdated' | 'missing';

export function isDigimonHook(hook: HookCommand): boolean {
    return typeof hook.command === 'string' && DIGIMON_HOOK_PATTERN.test(hook.command);
}

/** `installed` only when every event runs exactly `command`; any other Digimon hook is `outdated`. */
export function hookInstallState(settings: ClaudeSettings,
    command: string,
): HookInstallState {
    const commands = HOOK_EVENTS.map(event =>
        (settings.hooks?.[event] ?? []).flatMap(group => group.hooks ?? []).filter(isDigimonHook).map(hook => hook.command));
    if (commands.every(list => list.length === 1 && list[0] === command)) {
        return 'installed';
    }
    return commands.some(list => list.length > 0) ? 'outdated' : 'missing';
}

/** Settings with exactly one async Digimon hook per event, replacing any older ones. */
export function withDigimonHooks(settings: ClaudeSettings,
    command: string,
): ClaudeSettings {
    const hooks = stripped(settings.hooks);
    for (const event of HOOK_EVENTS) {
        hooks[event] = [...(hooks[event] ?? []), { hooks: [{ type: 'command', command, async: true }] }];
    }
    return { ...settings, hooks };
}

/** Settings with every Digimon hook removed, dropping groups and events left empty. */
export function withoutDigimonHooks(settings: ClaudeSettings): ClaudeSettings {
    const hooks = stripped(settings.hooks);
    const { hooks: _removed, ...rest } = settings;
    return Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest;
}

function stripped(hooks: Record<string, HookGroup[]> | undefined): Record<string, HookGroup[]> {
    const result: Record<string, HookGroup[]> = {};
    for (const [event, groups] of Object.entries(hooks ?? {})) {
        const kept = groups
            .map(group => ({ ...group, hooks: (group.hooks ?? []).filter(hook => !isDigimonHook(hook)) }))
            .filter(group => group.hooks.length > 0);
        if (kept.length > 0) {
            result[event] = kept;
        }
    }
    return result;
}
