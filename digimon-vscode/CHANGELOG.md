# Change Log

## [0.1.3] - 2026-09-29

- Rebalanced XP so it rewards steady work instead of mashing keys: 3 XP per 30 seconds of editing, 5 per save that writes changes (at most once a minute), 10 per git commit (at most once every 5 minutes). Claude's rates are unchanged.
- Evolution is paced for real use: Child after a few hours, Adult after about a week, Ultimate after about a month. A new egg arrives about once a day (every 1,500 XP).

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
