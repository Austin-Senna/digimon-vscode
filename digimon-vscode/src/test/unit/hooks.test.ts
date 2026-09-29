import * as assert from 'assert';
import { ClaudeSettings, HOOK_EVENTS, hookInstallState, withDigimonHooks, withoutDigimonHooks } from '../../claude/hooks';

const COMMAND = 'python3 -I -S "$HOME/.claude/digimon/hook.py"';
const LEGACY = 'python3 "$HOME/Documents/projects/personal/digimon-claude/digimon_claude/hook.py"';
const OTHER = { type: 'command', command: 'afplay /System/Library/Sounds/Glass.aiff' };

suite('claude hook settings', () => {
    test('adds one async hook per event and keeps unrelated settings', () => {
        const settings: ClaudeSettings = { model: 'opus', hooks: { Stop: [{ hooks: [OTHER] }] } };
        const result = withDigimonHooks(settings, COMMAND);
        assert.strictEqual(result.model, 'opus');
        for (const event of HOOK_EVENTS) {
            const commands = result.hooks![event].flatMap(group => group.hooks ?? []).map(hook => hook.command);
            assert.ok(commands.includes(COMMAND), event);
        }
        assert.deepStrictEqual(result.hooks!.Stop[0], { hooks: [OTHER] });
        assert.strictEqual(hookInstallState(result, COMMAND), 'installed');
    });

    test('is idempotent', () => {
        const once = withDigimonHooks({}, COMMAND);
        assert.deepStrictEqual(withDigimonHooks(once, COMMAND), once);
    });

    test('replaces legacy hooks from the standalone repo', () => {
        const legacy = withDigimonHooks({}, LEGACY);
        assert.strictEqual(hookInstallState(legacy, COMMAND), 'outdated');
        const upgraded = withDigimonHooks(legacy, COMMAND);
        assert.deepStrictEqual(upgraded, withDigimonHooks({}, COMMAND));
    });

    test('removal leaves other hooks and drops empty events', () => {
        const settings = withDigimonHooks({ theme: 'dark', hooks: { Stop: [{ hooks: [OTHER] }] } }, COMMAND);
        assert.deepStrictEqual(withoutDigimonHooks(settings), { theme: 'dark', hooks: { Stop: [{ hooks: [OTHER] }] } });
        assert.deepStrictEqual(withoutDigimonHooks(withDigimonHooks({ theme: 'dark' }, COMMAND)), { theme: 'dark' });
    });

    test('reports missing when no Digimon hooks exist', () => {
        assert.strictEqual(hookInstallState({ hooks: { Stop: [{ hooks: [OTHER] }] } }, COMMAND), 'missing');
    });
});
