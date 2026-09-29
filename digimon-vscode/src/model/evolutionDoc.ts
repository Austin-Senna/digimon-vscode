import { RULES } from './pet';
import { LINES, NEGLECTED_FORMS, displayName } from './species';

/** Markdown for docs/evolution-lines.md. Regenerate with `npm run docs:evolutions`; a unit test keeps it in sync. */
export function renderEvolutionLines(): string {
    const good = `0-${RULES.maxMistakesForGood}`;
    const bad = `${RULES.maxMistakesForGood + 1}-${RULES.maxMistakesForBad}`;
    const neglected = `${RULES.maxMistakesForBad + 1}+`;
    const forms = (names: readonly string[]) => names.map(displayName).join(' | ');

    const sections = LINES.map(line => [
        `## ${displayName(line.child)}`,
        '',
        [line.digitama, line.babyI, line.babyII, line.child].map(displayName).join(' → '),
        '',
        '| Care mistakes | Adult | Perfect | Ultimate |',
        '| --- | --- | --- | --- |',
        `| ${good} | ${forms(line.good)} |`,
        `| ${bad} | ${forms(line.bad)} |`,
        `| ${neglected} | ${forms(NEGLECTED_FORMS)} |`,
    ].join('\n'));

    return [
        '# Evolution lines',
        '',
        '<!-- Generated from src/model/species.ts by `npm run docs:evolutions`. Do not edit by hand. -->',
        '',
        `A new egg picks one of these ${LINES.length} lines at random. Care mistakes counted when the Child evolves decide which`,
        `row it follows from Adult onward. More than ${RULES.maxMistakesForBad} mistakes sends any line down the Numemon path.`,
        '',
        'XP needed to leave each stage:',
        '',
        '| Digitama | Baby I | Baby II | Child | Adult | Perfect |',
        '| --- | --- | --- | --- | --- | --- |',
        `| ${Object.values(RULES.xpToEvolve).join(' | ')} |`,
        '',
        sections.join('\n\n'),
        '',
    ].join('\n');
}
