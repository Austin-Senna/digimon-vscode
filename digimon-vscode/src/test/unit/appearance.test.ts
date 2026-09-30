import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_APPEARANCE, SCREENS, resolveAppearance } from '../../appearance';

const EXTENSION_ROOT = path.resolve(__dirname, '..', '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8'));
const css = fs.readFileSync(path.join(EXTENSION_ROOT, 'media', 'styles.css'), 'utf8');
const settings = manifest.contributes.configuration.properties;

suite('appearance', () => {
    for (const [kind, presets] of [['screen', SCREENS]] as const) {
        test(`${kind} presets match the settings enum and default`, () => {
            const setting = settings[`digimon.appearance.${kind}`];
            assert.deepStrictEqual(setting.enum, presets.map(preset => preset.id));
            assert.deepStrictEqual(setting.enumItemLabels, presets.map(preset => preset.label));
            assert.strictEqual(setting.default, DEFAULT_APPEARANCE[kind]);
        });

        test(`every ${kind} preset has a CSS rule`, () => {
            const missing = presets.filter(preset => !css.includes(`[data-${kind}="${preset.id}"]`));
            assert.deepStrictEqual(missing, []);
        });
    }

    test('the removed shell setting is gone', () => {
        assert.strictEqual(settings['digimon.appearance.shell'], undefined);
        assert.ok(!css.includes('data-shell'));
    });

    test('unknown values fall back to defaults', () => {
        assert.deepStrictEqual(resolveAppearance(42), DEFAULT_APPEARANCE);
        assert.deepStrictEqual(resolveAppearance('night'), { screen: 'night' });
    });
});
