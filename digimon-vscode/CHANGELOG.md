# Change Log

## [Unreleased]

- V-Pet core loop: random Digitama, XP from edits, saves, and git commits, seven-stage evolution across 12 lines.
- Fullness, energy, sleep, and care mistakes; care mistakes pick the Adult branch.
- Pet state persists across sessions; time only passes while VS Code is open.
- Playground webview animates the live pet (walk, eat, refuse, sleep, sad, evolve flash).
- Lives in the secondary side bar: a Digivice-style screen with fullness, energy, XP, and a Feed button. New Egg command.
- Claude Code integration: sessions in this workspace earn XP, trigger reactions, and show working/waiting status (reads the digimon-claude event log).
- Evolution happens the moment XP crosses a threshold instead of on the next 30s tick.
- Evolution lines audited against Wikimon; fixed Agumon, Gabumon, Piyomon, Impmon, and Lalamon links; added Lopmon.
- Merged the digimon-claude hook into `claude-hook/`; Connect/Disconnect Claude Code commands manage `~/.claude/settings.json` hooks.
- Hook log is owner-only; hook runs as `python3 -I -S`.
- Buddy roster (up to 6): earn an egg every 3,000 XP, switch buddies, release with confirmation. Idle buddies are frozen.
- Earned food: meat, vitamins, and sirloin from repeating XP milestones, fed from a pixel-art food tray.
- Save moved to a shared game.json so multiple VS Code windows no longer overwrite each other's progress; the old single pet is migrated.
- Removed care mistakes and the Numemon path. A Child that is ready to evolve waits for you to choose its Adult path, from the screen or **Digimon: Choose Evolution**.
- Screen backgrounds with live preview (**Digimon: Change Screen Background**).
- Segmented pixel meters and plainer captions ("7,160 XP to Perfect", "Meat in 130 XP"); the view uses the Pixelify Sans pixel font. Roster and path thumbnails animate.
- Claude XP is now time-based: 2 XP per working minute per session (replacing per-tool-call XP). "Claude needs you" is clickable and jumps to the session's terminal; the hook records its parent process for this.
