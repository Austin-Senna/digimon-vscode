export type Stage = 'digitama' | 'babyI' | 'babyII' | 'child' | 'adult' | 'perfect' | 'ultimate';

export const STAGES: readonly Stage[] = ['digitama', 'babyI', 'babyII', 'child', 'adult', 'perfect', 'ultimate'];

export const STAGE_LABELS: Record<Stage, string> = {
    digitama: 'Digitama',
    babyI: 'Baby I',
    babyII: 'Baby II',
    child: 'Child',
    adult: 'Adult',
    perfect: 'Perfect',
    ultimate: 'Ultimate',
};

const STAGE_FOLDERS: Record<Stage, string> = {
    digitama: 'Digitama',
    babyI: 'Baby I',
    babyII: 'Baby II',
    child: 'Child',
    adult: 'Adult',
    perfect: 'Perfect',
    ultimate: 'Ultimate-Super Ultimate',
};

/** Which late-game path a pet takes, chosen by the player when its Child evolves. */
export type Branch = 'good' | 'bad';

export const BRANCHES: readonly Branch[] = ['good', 'bad'];

/** Adult, Perfect, Ultimate. */
type LateForms = readonly [string, string, string];

export interface EvolutionLine {
    readonly id: string;
    readonly digitama: string;
    readonly babyI: string;
    readonly babyII: string;
    readonly child: string;
    readonly good: LateForms;
    readonly bad: LateForms;
}

/**
 * Curated evolution lines. Names are sprite file names without extension.
 * Every transition from Baby I onward is listed as an official evolution on Wikimon (audited 2026-09-29);
 * where the anime form has no sprite, another official evolution stands in (e.g. Plesiomon for Vikemon).
 */
export const LINES: readonly EvolutionLine[] = [
    {
        id: 'agumon', digitama: 'Agu_Digitama', babyI: 'Zurumon', babyII: 'Koromon', child: 'Agumon',
        good: ['Greymon', 'MetalGreymon', 'WarGreymon'],
        bad: ['Tyrannomon', 'SkullGreymon', 'BlackWarGreymon'],
    },
    {
        id: 'gabumon', digitama: 'Gabu_Digitama', babyI: 'YukimiBotamon', babyII: 'Tsunomon', child: 'Gabumon_X',
        good: ['Garurumon', 'WereGarurumon', 'MetalGarurumon'],
        bad: ['Garurumon_Black', 'WereGarurumon_Black', 'MetalGarurumon_Black'],
    },
    {
        id: 'piyomon', digitama: 'Piyo_Digitama', babyI: 'Nyokimon', babyII: 'Pyocomon', child: 'Piyomon',
        good: ['Birdramon', 'Garudamon', 'Hououmon'],
        bad: ['Saberdramon', 'Yatagaramon_2006', 'Valdurmon'],
    },
    {
        id: 'palmon', digitama: 'Pal_Digitama', babyI: 'Yuramon', babyII: 'Tanemon', child: 'Palmon',
        good: ['Togemon', 'Lilimon', 'Rosemon'],
        bad: ['Woodmon', 'Jyureimon', 'Pinochimon'],
    },
    {
        id: 'tentomon', digitama: 'Tento_Digitama', babyI: 'Bubbmon', babyII: 'Mochimon', child: 'Tentomon',
        good: ['Kabuterimon', 'AtlurKabuterimon_Red', 'HerakleKabuterimon'],
        bad: ['Kuwagamon', 'Okuwamon', 'GrandisKuwagamon'],
    },
    {
        id: 'gomamon', digitama: 'Goma_Digitama', babyI: 'Pitchmon', babyII: 'Pukamon', child: 'Gomamon',
        good: ['Ikkakumon', 'Zudomon', 'Plesiomon'],
        bad: ['Gesomon', 'MarinDevimon', 'Leviamon'],
    },
    {
        id: 'plotmon', digitama: 'Plot_Digitama', babyI: 'YukimiBotamon', babyII: 'Nyaromon', child: 'Plotmon',
        good: ['Tailmon', 'Angewomon', 'Ophanimon'],
        bad: ['BlackTailmon', 'LadyDevimon', 'Lilithmon'],
    },
    {
        id: 'terriermon', digitama: 'Terrier_Digitama', babyI: 'Zerimon', babyII: 'Gummymon', child: 'Terriermon',
        good: ['Galgomon', 'Rapidmon', 'SaintGalgomon'],
        bad: ['BlackGalgomon', 'BlackRapidmon', 'BlackSaintGalgomon'],
    },
    {
        id: 'guilmon', digitama: 'Guil_Digitama', babyI: 'Jyarimon', babyII: 'Gigimon', child: 'Guilmon',
        good: ['Growmon', 'MegaloGrowmon', 'Dukemon'],
        bad: ['BlackGrowmon', 'BlackMegaloGrowmon', 'ChaosDukemon'],
    },
    {
        id: 'v-mon', digitama: 'V_Digitama', babyI: 'Chicomon', babyII: 'Chibimon', child: 'V-mon',
        good: ['XV-mon', 'Paildramon', 'Imperialdramon_Fighter'],
        bad: ['Airdramon', 'Megadramon', 'Mugendramon'],
    },
    {
        id: 'impmon', digitama: 'Imp_Digitama', babyI: 'Kiimon', babyII: 'Yaamon', child: 'Impmon',
        good: ['Wizarmon', 'Baalmon', 'Beelzebumon'],
        bad: ['Devimon', 'Vamdemon', 'BelialVamdemon'],
    },
    {
        id: 'lalamon', digitama: 'Lala_Digitama', babyI: 'Leafmon', babyII: 'Budmon', child: 'Lalamon',
        good: ['Sunflowmon', 'Lilamon', 'Lotusmon'],
        bad: ['Woodmon', 'Blossomon', 'Rafflesimon'],
    },
    {
        id: 'lopmon', digitama: 'Lop_Digitama', babyI: 'Cocomon', babyII: 'Chocomon', child: 'Lopmon',
        good: ['Turuiemon', 'Andiramon_Data', 'Cherubimon_Virtue'],
        bad: ['BlackTailmon', 'LadyDevimon', 'Lilithmon'],
    },
];

export function findLine(id: string): EvolutionLine | undefined {
    return LINES.find(line => line.id === id);
}

/** Species name for a line at a stage. Late stages need a branch. */
export function speciesFor(line: EvolutionLine,
    stage: Stage,
    branch: Branch | null,
): string {
    switch (stage) {
        case 'digitama': return line.digitama;
        case 'babyI': return line.babyI;
        case 'babyII': return line.babyII;
        case 'child': return line.child;
    }
    const forms = branch === 'bad' ? line.bad : line.good;
    const index = stage === 'adult' ? 0 : stage === 'perfect' ? 1 : 2;
    return forms[index];
}

/** Sprite path segments relative to the extension root. */
export function spritePath(stage: Stage,
    species: string,
): string[] {
    return ['media', 'sprites', STAGE_FOLDERS[stage], `${species}.png`];
}

/** Display name: sprite names use underscores for variants, e.g. `Gabumon_X` -> `Gabumon X`. */
export function displayName(species: string): string {
    return species.replace(/_Digitama$/, ' Digitama').replace(/_/g, ' ');
}
