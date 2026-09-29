import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { renderEvolutionLines } from '../../model/evolutionDoc';
import { LINES, NEGLECTED_FORMS, STAGES, displayName, speciesFor, spritePath } from '../../model/species';

const EXTENSION_ROOT = path.resolve(__dirname, '..', '..', '..');

suite('species', () => {
    test('line ids are unique', () => {
        const ids = LINES.map(line => line.id);
        assert.strictEqual(new Set(ids).size, ids.length);
    });

    test('every species in every line has a sprite at its stage', () => {
        const missing: string[] = [];
        for (const line of LINES) {
            for (const branch of ['good', 'bad', 'neglected'] as const) {
                for (const stage of STAGES) {
                    const name = speciesFor(line, stage, branch);
                    const file = path.join(EXTENSION_ROOT, ...spritePath(stage, name));
                    if (!fs.existsSync(file)) {
                        missing.push(`${line.id}/${stage}/${name}`);
                    }
                }
            }
        }
        assert.deepStrictEqual(missing, []);
    });

    test('neglected branch ignores the line', () => {
        const [first, second] = LINES;
        assert.strictEqual(speciesFor(first, 'adult', 'neglected'), NEGLECTED_FORMS[0]);
        assert.strictEqual(speciesFor(second, 'ultimate', 'neglected'), NEGLECTED_FORMS[2]);
    });

    test('docs/evolution-lines.md matches the code (run `npm run docs:evolutions`)', () => {
        const doc = fs.readFileSync(path.join(EXTENSION_ROOT, 'docs', 'evolution-lines.md'), 'utf8');
        assert.strictEqual(doc, renderEvolutionLines());
    });

    test('displayName formats variants and eggs', () => {
        assert.strictEqual(displayName('Gabumon_X'), 'Gabumon X');
        assert.strictEqual(displayName('Agu_Digitama'), 'Agu Digitama');
        assert.strictEqual(displayName('Agumon'), 'Agumon');
    });
});
