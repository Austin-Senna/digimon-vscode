import { RULES } from './pet';
import { LINES, displayName } from './species';

/** Markdown for docs/evolution-lines.md. Regenerate with `npm run docs:evolutions`; a unit test keeps it in sync. */
export function renderEvolutionLines(): string {
    const forms = (names: readonly string[]) => names.map(displayName).join(' → ');

    const sections = LINES.map(line => [
        `## ${displayName(line.child)}`,
        '',
        [line.digitama, line.babyI, line.babyII, line.child].map(displayName).join(' → '),
        '',
        `- **Path 1:** ${forms(line.good)}`,
        `- **Path 2:** ${forms(line.bad)}`,
    ].join('\n'));

    return [
        '# Evolution lines',
        '',
        '<!-- Generated from src/model/species.ts by `npm run docs:evolutions`. Do not edit by hand. -->',
        '',
        `There are ${LINES.length} lines. It evolves on its own up to Child. When the Child reaches its level,`,
        'it waits for you to pick one of two paths, which fixes its Adult, Perfect, and Ultimate forms.',
        '',
        'Level at which each stage evolves (levels keep going after Ultimate):',
        '',
        '| Digitama | Baby I | Baby II | Child | Adult | Perfect |',
        '| --- | --- | --- | --- | --- | --- |',
        `| ${Object.values(RULES.evolveAtLevel).map(level => `Lv ${level}`).join(' | ')} |`,
        '',
        sections.join('\n\n'),
        '',
    ].join('\n');
}
