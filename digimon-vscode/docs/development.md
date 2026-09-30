# Development

```sh
npm install
npm run compile          # typecheck, lint, bundle
npm run test:unit        # model tests, plain mocha, no VS Code needed
npm test                 # full suite inside a downloaded VS Code
npm run docs:evolutions  # regenerate docs/evolution-lines.md after editing species.ts
cd claude-hook && uv run pytest  # hook script tests
```

Press `F5` in VS Code to launch an Extension Development Host.

- Game rules live in `src/model/` (`RULES` in `pet.ts`, `ROSTER` in `game.ts`) as pure functions with no `vscode` dependency.
- Evolution lines are data in `src/model/species.ts`; `npm run test:unit` checks that every sprite they reference exists.
- The webview in `media/` only animates the state the extension sends it.
- The save is `game.json` in the extension's global storage, shared by every window (**Digimon: Open Save Folder**).
- The Claude hook is `claude-hook/digimon_claude/hook.py`; its event format is in [claude-events.md](claude-events.md).

README images use absolute `raw.githubusercontent.com` URLs because `vsce` ignores `repository.directory` when it rewrites relative links, which would break them on the Marketplace.
