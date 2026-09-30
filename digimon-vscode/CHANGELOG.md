# Change Log

## [0.1.4] - 2026-09-30

- Reactions float up from your Digimon as small pixel icons instead of speech bubbles: hearts after eating or when you click it, a meat when it's hungry, a sweat drop when it's worn out.
- Hunger pauses while your Digimon is asleep (5 minutes without activity), so leaving VS Code open overnight no longer starves it.

## [0.1.3] - 2026-09-29

- Rebalanced XP so it rewards steady work instead of mashing keys: 3 XP per 30 seconds of editing, 5 per save that writes changes (at most once a minute), 10 per git commit (at most once every 5 minutes). Claude's rates are unchanged.
- Levels: XP raises your Digimon's level, and it evolves at set levels (Child Lv 10, Adult Lv 25, Ultimate Lv 50). Levels keep going after Ultimate.
- An evolution scene: the screen glows blue, a sphere of light closes around your Digimon, cracks, and reveals its new form.
- Your Digimon talks back: a happy face or hearts after eating, a hungry bubble when it needs food, a sad one when it's worn out, a shout when Claude finishes or you click it, and a level-up burst.
- New eggs arrive about once a day (every 1,500 XP), and you pick one of two from lines you don't own yet.
- A Connect Claude Code button in the view's title bar until Claude is connected.

## [0.1.2] - 2026-09-29

- Fix: a VS Code window still running an older version could mistake a newer save for a corrupt one and start a fresh egg. Newer saves are now left untouched, and the outdated window asks you to reload.

## [0.1.1] - 2026-09-29

- New hatching-egg icon.
- Fix README images and formatting on the Marketplace listing.

## [0.1.0] - 2026-09-29

First release.

- A Digimon in VS Code's secondary side bar that grows while Claude Code works: 2 XP per working minute per session, 3 per prompt. It reacts to Claude finishing, failing, and erroring, and shows when a session needs you; click to jump to that session's terminal. **Digimon: Connect Claude Code** installs the hooks.
- Your own coding counts too: edits, saves, and git commits earn XP.
- 13 evolution lines through seven stages. Up to Child it evolves on its own; then you choose one of two paths to Ultimate.
- Fullness, energy, and sleep. Buy meat, vitamins, and sirloin with bits, earned 1 per XP.
- A party of up to 6 buddies, with a new egg every 3,000 XP.
