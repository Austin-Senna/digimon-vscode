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
