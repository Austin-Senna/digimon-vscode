# Faster Progression, Potions, Frenzy, Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triple-ish pet XP income without inflating bits/eggs, add XP potions, a frenzy tied to egg drops, free form switching, a status bar entry, and drag and drop in the webview.

**Architecture:** All rules live in the pure model (`src/model/pet.ts` per buddy, `src/model/game.ts` per player) and are unit tested with mocha. `PetController` exposes one method per action; `DigimonPlaygroundProvider` and `extension.ts` translate webview messages and commands into those methods. The save moves to `GAME_VERSION = 7`.

**Tech Stack:** TypeScript, VS Code extension API (^1.107), plain JS webview (`media/script.js`), mocha `tdd` UI.

**Spec:** `docs/superpowers/specs/2026-10-30-progression-items-forms-design.md`

## Global Constraints

- Level curve unchanged: `xpPerLevelUnit: 25`, `evolveAtLevel` unchanged.
- Bits and egg progress per hour of activity stay at 0.1.6 rates (see `effortPerActivity`, Task 1).
- Forms are cosmetic only; the Adult branch chosen at Child is locked forever.
- No `alert`/`confirm`/`prompt` in the webview. Confirmations use `vscode.window.showWarningMessage(..., { modal: true }, ...)` in the extension.
- Webview messages are validated in the provider; nothing trusts the webview.
- Match the repo's multi-line parameter style (`function f(a: A,` / `    b: B,` / `): R`).
- Never use em dashes in user-facing copy.
- Commands: `npm run test:unit` (unit), `npm run compile` (types + lint + bundle), `npm test` (integration).
- Work on a feature branch `feat/progression-items-forms`, not `main`.

## Review Focus

1. The `digimon.feed` to `digimon.shop` rename leaves no dangling reference: the starving notification's Feed button, the toolbar menu, and any test that executes the command all open the Shop. Pinned by the `npm test` integration run in Task 9 and a grep for `digimon.feed` returning nothing in Task 7.
2. A v6 save with buddies mid-line loads as v7 with `form === stage`: same sprites, no evolution scene, no XP change. Pinned in Task 2 (game) and Task 4 (pet).
3. A pet showing a devolved form crosses an evolution level: it jumps to the new stage and the scene starts from the form it was showing, not from `stage - 1`. Pinned in Task 4.
4. Another window consumes the egg offer or releases a buddy between the user's click and the action (crack confirm modal, drag reorder). The action is a no-op, never a crash or a phantom potion. Pinned in Tasks 3 and 5.
5. A potion on a Child already waiting to choose, or on a starving pet, adds XP but does not evolve. Pinned in Task 3.

---

### Task 1: XP income, effort table, penalties (pet model)

**Files:**
- Modify: `src/model/pet.ts` (`RULES`, `ActivityKind`, `CooldownKind`, `COOLDOWN_FIELDS`, `PetState`, `createEgg`, `recordActivity`, `activityEffort`, `OPTIONAL_NUMBER_FIELDS`)
- Test: `src/test/unit/pet.test.ts`

**Interfaces:**
- Produces:
  - `ActivityKind` gains `'active'`; `CooldownKind` gains `'active'`; `PetState.lastActiveXpAt: number`.
  - `RULES.xpPerActivity = { edit: 1, save: 15, commit: 30, command: 9, prompt: 15, claudeWork: 5, active: 10 }`
  - `RULES.effortPerActivity = { edit: 1, save: 5, commit: 10, command: 3, prompt: 5, claudeWork: 2, active: 0 }`
  - `RULES.cooldownMs = { edit: 1 s, save: 30 s, commit: 60 s, command: 10 s, active: 60 s }`
  - `RULES.starvingXpMultiplier = 0.5`, `RULES.exhaustedXpMultiplier = 0.5`, `RULES.energyCostPerXp = 0.05 / 3`
  - `recordActivity(state: PetState, kind: ActivityKind, now: number, xpMultiplier = 1): Update`
  - `activityEffort(state, kind, now): number` now returns `effortPerActivity[kind]` (0 on cooldown).

- [ ] **Step 1: Create the branch**

Run: `git checkout -b feat/progression-items-forms`

- [ ] **Step 2: Write the failing tests**

Replace `'starving pets gain no XP'` (the rule changed by the spec; this is not a weakening) and add:

```ts
test('starving pets gain half XP', () => {
    const pet = { ...hatched(), fullness: 0, energy: 100 };
    const { state } = recordActivity(pet, 'prompt', T0);
    assert.strictEqual(state.xp - pet.xp, 15 * 0.5);
});
test('starving and exhausted stack to a quarter', () => {
    const pet = { ...hatched(), fullness: 0, energy: 0 };
    assert.strictEqual(recordActivity(pet, 'prompt', T0).state.xp - pet.xp, 15 * 0.25);
});
test('xpMultiplier scales XP after penalties', () => {
    const pet = { ...hatched(), fullness: 0, energy: 100 };
    assert.strictEqual(recordActivity(pet, 'prompt', T0, 3).state.xp - pet.xp, 15 * 0.5 * 3);
});
test('energy is charged on base XP, whatever the multipliers', () => {
    const pet = { ...hatched(), energy: 100 };
    const plain = recordActivity(pet, 'prompt', T0).state.energy;
    assert.strictEqual(recordActivity(pet, 'prompt', T0, 3).state.energy, plain);
    assert.strictEqual(recordActivity({ ...pet, fullness: 0 }, 'prompt', T0).state.energy, plain);
    assert.strictEqual(plain, 100 - 15 * RULES.energyCostPerXp);
});
test('edits earn once per second', () => {
    const pet = hatched();
    const a = recordActivity(pet, 'edit', T0 + 1_000).state;
    assert.strictEqual(recordActivity(a, 'edit', T0 + 1_500).state.xp, a.xp);
    assert.strictEqual(recordActivity(a, 'edit', T0 + 2_000).state.xp, a.xp + 1);
});
test('an active minute earns 10 XP once per minute and wakes the pet', () => {
    const pet = { ...hatched(), lastActivityAt: T0 - RULES.sleepAfterMs };
    const first = recordActivity(pet, 'active', T0);
    assert.strictEqual(first.state.xp - pet.xp, 10);
    assert.ok(first.events.some(e => e.kind === 'woke'));
    assert.strictEqual(recordActivity(first.state, 'active', T0 + 59_000).state.xp, first.state.xp);
    assert.strictEqual(recordActivity(first.state, 'active', T0 + 60_000).state.xp, first.state.xp + 10);
});
test('effort keeps 0.1.6 rates', () => {
    const pet = hatched();
    assert.strictEqual(activityEffort(pet, 'edit', T0), 1);
    assert.strictEqual(activityEffort(pet, 'claudeWork', T0), 2);
    assert.strictEqual(activityEffort(pet, 'active', T0), 0);
    assert.strictEqual(activityEffort(pet, 'save', T0), 5);
});
test('parseState reads a missing lastActiveXpAt as never used', () => { /* mirror the existing optional-cooldown test */ });
```

Use the file's existing hatched-pet helper (or add `hatched()` returning a `babyI` with full meters if none exists). Update any existing test whose expected numbers came from the old values (e.g. 5 per prompt, 3 s edit cooldown) to the new `RULES` values.

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:unit`
Expected: the new tests FAIL (wrong XP amounts, unknown kind `active`).

- [ ] **Step 4: Implement in `src/model/pet.ts`**

Set the `RULES` values above and rewrite the `RULES` doc comment's XP-per-hour figures (median coder ~3,300 XP/day per the spec). `recordActivity` no longer gates XP on `fullness > 0`; XP = base × (starving ? 0.5 : 1) × (exhausted ? 0.5 : 1) × `xpMultiplier`; energy −= base × `energyCostPerXp`. Add `lastActiveXpAt` to `PetState`, `createEgg` (0), `COOLDOWN_FIELDS`, and `OPTIONAL_NUMBER_FIELDS`.

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:unit`
Expected: all PASS, including `game.test.ts` (its `earn` helper uses prompts: 5 effort each, unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/model/pet.ts src/test/unit/pet.test.ts
git commit -m "Faster XP: 1 s edits, tripled manual XP, active minutes, softer penalties; effort keeps 0.1.6 rates"
```

---

### Task 2: Frenzy, save v7, whole-number bits (game model)

**Files:**
- Modify: `src/model/game.ts`
- Test: `src/test/unit/game.test.ts`

**Interfaces:**
- Consumes: `recordActivity(..., xpMultiplier)`, `activityEffort` (Task 1).
- Produces:
  - `GAME_VERSION = 7`; `GameState.potions: number`; `GameState.frenzyUntil: number` (epoch ms, 0 = none).
  - `ROSTER.frenzyMs = 30 * 60_000`, `ROSTER.frenzyXpMultiplier = 3`, `ROSTER.potionPrice = 1_000`, `ROSTER.potionXp = 1_000`, `ROSTER.potionsPerEgg = 2`.
  - `isFrenzy(game: GameState, now: number): boolean`
  - `GameEvent` gains `{ kind: 'frenzyStarted'; until: number }`.
  - `grantEggs(game, now, random)` (private) now takes `now`.

- [ ] **Step 1: Write the failing tests**

```ts
test('an egg drop starts a 30 minute triple-XP frenzy', () => {
    const { state, events } = earn(game(), ROSTER.effortPerEgg);
    assert.ok(events.some(e => e.kind === 'frenzyStarted'));
    assert.ok(isFrenzy(state, state.frenzyUntil - 1));
    assert.ok(!isFrenzy(state, state.frenzyUntil));
});
test('frenzy triples pet XP, pauses egg progress, keeps bits', () => {
    const base = hatchedGame(); // helper: active buddy is a babyI with full meters
    const { state } = recordGameActivity({ ...base, frenzyUntil: T0 + ROSTER.frenzyMs }, 'prompt', T0);
    assert.strictEqual(activeBuddy(state).xp - activeBuddy(base).xp, 45);
    assert.strictEqual(state.effort, base.effort);
    assert.strictEqual(state.bits, base.bits + 5);
});
test('eggs granted together stack their frenzies', () => {
    // Effort just under two eggs with none granted yet (as after a migration): one prompt grants both.
    const { state } = recordGameActivity(game({ effort: 2 * ROSTER.effortPerEgg - 5, eggsGranted: 0 }), 'prompt', T0);
    assert.strictEqual(state.eggOffers.length, 2);
    assert.strictEqual(state.frenzyUntil, T0 + 2 * ROSTER.frenzyMs);
});
test('an edit earns one whole bit', () => {
    const { state } = recordGameActivity(game({ bits: 0 }), 'edit', T0 + 1_000);
    assert.strictEqual(state.bits, 1);
    assert.strictEqual(state.effort, 1);
});
test('v6 saves load as v7 with no potions and no frenzy', () => {
    const v6 = { ...JSON.parse(JSON.stringify(game())), version: 6 };
    delete v6.potions; delete v6.frenzyUntil;
    const parsed = parseGame(v6)!;
    assert.strictEqual(parsed.version, GAME_VERSION);
    assert.strictEqual(parsed.potions, 0);
    assert.strictEqual(parsed.frenzyUntil, 0);
    assert.deepStrictEqual(parsed.buddies.map(b => b.xp), game().buddies.map(b => b.xp), 'no rescale from v6');
});
test('v7 rejects negative or fractional potions; a bad frenzyUntil reads as 0', () => { /* ... */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit`
Expected: FAIL (`isFrenzy` not exported, version 6).

- [ ] **Step 3: Implement in `src/model/game.ts`**

`recordGameActivity`: compute `frenzy = isFrenzy(game, now)`; pass `frenzy ? ROSTER.frenzyXpMultiplier : 1` to `recordActivity`; add effort to `game.effort` only when not frenzy; always add `effort * bitsPerEffort` to bits; then `grantEggs(next, now)`. `grantEggs` sets `frenzyUntil = Math.max(now, game.frenzyUntil) + due * ROSTER.frenzyMs` and pushes one `frenzyStarted`. `parseGame` accepts versions 2 through 7; for `< 7` fill `potions: 0, frenzyUntil: 0`; for 7 require `Number.isInteger(potions) && potions >= 0` (else reject, like bits) and read a non-finite `frenzyUntil` as 0. `createGame`/`withFirstBuddy` set both to 0. Update the stale v6 doc comment to describe v7.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/game.ts src/test/unit/game.test.ts
git commit -m "Coding frenzy: triple XP for 30 minutes after each egg, egg progress paused; save v7"
```

---

### Task 3: XP potions

**Files:**
- Modify: `src/model/pet.ts`, `src/model/game.ts`, `src/PetController.ts`
- Test: `src/test/unit/pet.test.ts`, `src/test/unit/game.test.ts`

**Interfaces:**
- Consumes: `ROSTER.potion*`, `GameState.potions` (Task 2).
- Produces:
  - `gainXp(state: PetState, xp: number): Update` in `pet.ts`: adds XP with no penalties, no energy cost; emits `leveledUp`, `readyToChoose`, and at most one evolution, exactly as `recordActivity` does. `recordActivity` uses the same private tail so the two cannot drift.
  - `buyPotion(game): GameUpdate` → `potionBought` or `cannotAffordPotion`.
  - `drinkPotion(game): GameUpdate` → `drankPotion` plus `gainXp` events, or `noPotions`.
  - `crackEgg(game): GameUpdate` → drops the oldest offer, `potions += 2`, `eggCracked`; no offer → same state, no events.
  - `GameEvent` gains `potionBought | cannotAffordPotion | drankPotion | noPotions | eggCracked` (all `{ kind }` only).
  - `PetController.buyPotion()`, `.drinkPotion()`, `.crackEgg()`.

- [ ] **Step 1: Write the failing tests**

```ts
test('buying a potion costs 1,000 bits and stocks it', () => {
    const { state, events } = buyPotion(game({ bits: 1_000 }));
    assert.strictEqual(state.bits, 0);
    assert.strictEqual(state.potions, 1);
    assert.deepStrictEqual(events, [{ kind: 'potionBought' }]);
});
test('cannot buy a potion without enough bits', () => {
    const before = game({ bits: 999 });
    const { state, events } = buyPotion(before);
    assert.strictEqual(state, before);
    assert.deepStrictEqual(events, [{ kind: 'cannotAffordPotion' }]);
});
test('a potion gives the active buddy a flat 1,000 XP, even exhausted, at no energy cost', () => { /* energy 0: xp +1000, energy stays 0 */ });
test('drinking with none does nothing', () => { /* state unchanged, [{ kind: 'noPotions' }] */ });
test('cracking the oldest egg gives two potions', () => { /* offers [a,b] -> [b], potions +2, works with a full party */ });
test('cracking with no egg waiting is a no-op', () => { /* same state object, [] */ });
test('a potion hatches an egg one stage at a time', () => { /* digitama +1000 -> babyI, events include evolved; tickGame then -> babyII */ });
test('a potion on a waiting Child or a starving pet does not evolve', () => { /* stage unchanged, xp +1000 */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement** `gainXp` in `pet.ts`, the three game functions in `game.ts`, and the three controller methods (each `this._apply(now => fn(this._store.load(now)))`).

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/pet.ts src/model/game.ts src/PetController.ts src/test/unit/pet.test.ts src/test/unit/game.test.ts
git commit -m "XP potions: buy for 1,000 bits or crack a spare egg into two"
```

---

### Task 4: Forms (devolve and re-evolve)

**Files:**
- Modify: `src/model/pet.ts`, `src/model/game.ts`, `src/PetController.ts`, `src/DigimonPlaygroundProvider.ts` (`_playEvolution`, `_spriteUri`, event loop)
- Test: `src/test/unit/pet.test.ts`, `src/test/unit/game.test.ts`

**Interfaces:**
- Produces:
  - `PetState.form: Stage` (shown form; `stage` stays the highest reached).
  - `species(state)` uses `form`. New `unlockedForms(state: PetState): Stage[]`: `['digitama']` for an egg, else `STAGES` from `babyI` through `stage`.
  - `setForm(state: PetState, form: Stage): Update`: refused (`{ kind: 'refused' }`) while starving or if `form` is not unlocked; same form → same state, no events; else `{ kind: 'formChanged'; from: string; fromStage: Stage; to: string; stage: Stage; up: boolean }`.
  - `PetEvent` `evolved` gains `fromStage: Stage` (the form shown before). `evolve` and `chooseBranch` set `form` to the new stage.
  - `setGameForm(game: GameState, form: Stage): GameUpdate`; `PetController.setForm(form: Stage)`.
  - `parseState`: missing `form` → `stage`; a `form` outside `unlockedForms` → `stage` (never rejects the save).

- [ ] **Step 1: Write the failing tests**

```ts
test('an Ultimate can show any form from Baby I up, keeping level and XP', () => {
    const top = ultimate(); // stage 'ultimate', branch 'good', form 'ultimate'
    const { state, events } = setForm(top, 'child');
    assert.strictEqual(state.form, 'child');
    assert.strictEqual(state.stage, 'ultimate');
    assert.strictEqual(state.xp, top.xp);
    assert.strictEqual(species(state), findLine(top.lineId)!.child);
    assert.strictEqual(events[0].kind, 'formChanged');
    assert.strictEqual((events[0] as { up: boolean }).up, false);
});
test('forms above the highest stage, and Digitama, are not selectable', () => { /* child: setForm 'adult' refused; babyII: setForm 'digitama' refused */ });
test('changing form is refused while starving', () => { /* fullness 0 -> refused, state unchanged */ });
test('reaching a new stage while devolved jumps to it, starting the scene from the shown form', () => {
    const perfect = { ...perfectPet(), form: 'child' as const, xp: xpForLevel(50) - 1 };
    const { state, events } = recordActivity(perfect, 'edit', T0);
    assert.strictEqual(state.stage, 'ultimate');
    assert.strictEqual(state.form, 'ultimate');
    const evolved = events.find(e => e.kind === 'evolved') as { from: string; fromStage: Stage };
    assert.strictEqual(evolved.fromStage, 'child');
    assert.strictEqual(evolved.from, findLine(perfect.lineId)!.child);
});
test('the Adult choice works from a lower form and locks the branch', () => { /* child at Lv25 showing babyII: chooseBranch('bad') -> stage/form adult, branch bad */ });
test('parseState defaults a missing or impossible form to the stage', () => { /* missing -> stage; form 'ultimate' on a child -> 'child' */ });
```

In `game.test.ts`: `'v6 buddies load with form equal to stage'`.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit`
Expected: FAIL.

- [ ] **Step 3: Implement the model** per Interfaces; `createEgg` sets `form: 'digitama'`.

- [ ] **Step 4: Wire the provider**

`_playEvolution(from, fromStage, to, stage)` builds the old sprite from `fromStage` (not `STAGES[index - 1]`); `isEgg` is `fromStage === 'digitama'`. In the event loop, `formChanged` with `up` plays the same scene; with `!up` it plays `'happy'` and the sprite swaps on the next state post (builder may add a short effect). `_spriteUri` uses `pet.form`. Run `npm run compile`: Expected: no type or lint errors.

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/model src/PetController.ts src/DigimonPlaygroundProvider.ts src/test/unit
git commit -m "Forms: switch between unlocked forms at any level; the chosen path stays locked"
```

---

### Task 5: Reorder the party

**Files:**
- Modify: `src/model/game.ts`, `src/PetController.ts`
- Test: `src/test/unit/game.test.ts`

**Interfaces:**
- Produces: `reorderBuddies(game: GameState, ids: readonly string[]): GameUpdate` (returns the same state object unless `ids` is exactly a permutation of current buddy ids); `PetController.reorder(ids: readonly string[])`.

- [ ] **Step 1: Write the failing tests**

```ts
test('reorders the party without changing the active buddy', () => {
    const two = withSecondBuddy();
    const ids = two.buddies.map(b => b.id).reverse();
    const { state } = reorderBuddies(two, ids);
    assert.deepStrictEqual(state.buddies.map(b => b.id), ids);
    assert.strictEqual(state.activeId, two.activeId);
});
test('ignores a stale, partial, or duplicated order', () => {
    const two = withSecondBuddy();
    for (const ids of [['b1'], ['b1', 'b1'], ['b1', 'b9'], ['b1', 'b2', 'b3']]) {
        assert.strictEqual(reorderBuddies(two, ids).state, two);
    }
});
```

- [ ] **Step 2: Run to verify failure**, `npm run test:unit`, Expected: FAIL.
- [ ] **Step 3: Implement** `reorderBuddies` and the controller method.
- [ ] **Step 4: Run to verify pass**, `npm run test:unit`, Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/model/game.ts src/PetController.ts src/test/unit/game.test.ts
git commit -m "Party order can be rearranged"
```

---

### Task 6: Active-minute tracking

**Files:**
- Modify: `src/activity.ts`

**Interfaces:**
- Consumes: `ActivityKind 'active'` (Task 1); `controller.recordActivity`.

- [ ] **Step 1: Implement in `trackActivity`**

A local `recordActive()` that calls `controller.recordActivity('active')` only when `vscode.window.state.focused`. Call it from: the existing tracked text-change handler (in addition to `'edit'`), `window.onDidChangeTextEditorSelection`, `window.onDidChangeTextEditorVisibleRanges`, `window.onDidChangeActiveTextEditor`, `debug.onDidStartDebugSession`, `debug.onDidTerminateDebugSession`. Throttling is the model's 60 s cooldown; do not add a second timer. For editor events, apply the same `TRACKED_SCHEMES` filter as edits.

- [ ] **Step 2: Verify**

Run: `npm run compile`, Expected: no errors. Then F5 (Extension Development Host): open a file, only move the cursor and scroll for 2 minutes without typing. Expected: XP rises by 10 about once a minute; in a second unfocused window, no extra credit.

- [ ] **Step 3: Commit**

```bash
git add src/activity.ts
git commit -m "Active coding minutes: reading, navigating and debugging earn XP"
```

---

### Task 7: Status bar, auto-open, Shop, form and crack commands, notifications

**Files:**
- Create: `src/statusText.ts` (pure, no `vscode` import), `src/statusBar.ts`
- Modify: `src/extension.ts`, `package.json`
- Test: `src/test/unit/statusText.test.ts`

**Interfaces:**
- Consumes: `isFrenzy`, `buyPotion`/`drinkPotion`/`crackEgg` via controller, `unlockedForms`, `PetController.setForm`.
- Produces:
  - `statusText(game: GameState, now: number): string`: `"<name> Lv <n>"`, plus `" $(flame) <m>m"` (minutes left, rounded up) during frenzy.
  - `createStatusBar(controller: PetController): vscode.Disposable`: left-aligned item, `command: 'workbench.view.extension.Digimon-Buddy'`, tooltip with mood, fullness and energy, refreshed on `controller.onDidChange` and every 30 s (frenzy countdown).
  - Commands: `digimon.feed` renamed to `digimon.shop` (`Shop`, same heart icon and toolbar slot; update every reference, including the `starving` notification), new `digimon.changeForm` (`Change Form`), setting `digimon.openOnStartup` (boolean, default `false`, description "Open the Digimon view when a window starts.").

- [ ] **Step 1: Write the failing tests** (`statusText.test.ts`)

```ts
test('shows name and level', () => { assert.strictEqual(statusText(agumonLv12Game, T0), 'Agumon Lv 12'); });
test('shows minutes of frenzy left, rounded up', () => {
    assert.strictEqual(statusText({ ...agumonLv12Game, frenzyUntil: T0 + 90_000 }, T0), 'Agumon Lv 12 $(flame) 2m');
});
```

- [ ] **Step 2: Run to verify failure**, `npm run test:unit`, Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `statusText.ts` and `statusBar.ts`.
- [ ] **Step 4: Wire `extension.ts`**
  - Register the status bar and `digimon.changeForm` (quick pick over `unlockedForms`, current marked `current`, showing `displayName` and stage label; calls `controller.setForm`).
  - `pickFood` becomes `shop`: the foods, then `XP Potion` (`1,000 bits, +1,000 XP`, `(not enough bits)` when short) and, when `potions > 0`, `Drink XP Potion (<n> owned)`.
  - `pickEgg`: add `Crack into 2 XP potions` to the items, shown even when the party is full; confirm with a modal ("Crack this egg? You get 2 XP potions and the egg is gone.", button `Crack`). Register a `digimon.crackEgg` command running the same confirm, for the webview to call.
  - Replace the stale "A new one arrives every 1,500 XP." with "No egg to choose yet. A new one arrives about once a day of coding."
  - `notify`: `frenzyStarted` → "Coding frenzy! Triple XP for 30 minutes."
  - On activation, if `digimon.openOnStartup`, run `workbench.view.extension.Digimon-Buddy`, then `workbench.action.focusActiveEditorGroup`.
  - `package.json`: contribute the commands and the setting; replace `digimon.feed` with `digimon.shop` in commands and menus.
- [ ] **Step 5: Verify**: `npm run test:unit` PASS; `npm run compile` clean; `grep -rn "digimon.feed" src package.json` prints nothing; F5 check: status bar shows the buddy, clicking opens the view in a window where the secondary sidebar was closed; with the setting on, a new window opens the view and the cursor stays in the editor.
- [ ] **Step 6: Commit**

```bash
git add src/statusText.ts src/statusBar.ts src/extension.ts package.json src/test/unit/statusText.test.ts
git commit -m "Status bar buddy, optional auto-open, Shop with potions, Change Form, crack eggs"
```

---

### Task 8: Webview: Items grid, potions, frenzy, forms, drag and drop

**Files:**
- Modify: `src/DigimonPlaygroundProvider.ts`, `media/index.html`, `media/script.js`, `media/styles.css`

**Interfaces:**
- Consumes: controller methods from Tasks 3 to 5; `digimon.crackEgg`, `digimon.changeForm` commands (Task 7); `isFrenzy`.
- Produces (state message fields added): `potions`, `potionPrice`, `potionXp`, `frenzyMsLeft` (0 when none), `nextEgg` (floored), `eggPaused` (true during frenzy). Inbound messages, all validated: `buyPotion`, `drinkPotion`, `crackEgg` (→ `digimon.crackEgg`), `changeForm` (→ `digimon.changeForm`), `reorder { ids: string[] }` (array of strings, else ignored), and the existing `feed` reused for drops.

- [ ] **Step 1: Provider**: add the fields and message handlers above. `EVENT_ANIMATIONS`: `cannotAffordPotion` and `noPotions` → `refuse`, `drankPotion` → `happy`, `potionBought` and `eggCracked` → `happy`.
- [ ] **Step 2: Items section** (`index.html`, `script.js`, `styles.css`): rename "Food" to "Items". Render a wrapping grid of equal tiles (pixel icon, small badge), built from `state.food` plus a potion tile with new 8x8 `POTION_ART` in the existing `FOOD_ART` style. Food tiles: badge = price, click = `feed` (unchanged). Potion tile: badge = `×<potions>`, click = `drinkPotion` (disabled at 0), and a separate small `+` buy button inside the tile = `buyPotion` (disabled when `bits < potionPrice`; title "Buy an XP potion for 1,000 bits"). Tooltips state effect and cost.
- [ ] **Step 3: Drag item to pet**: tiles are `draggable`; `dataTransfer` carries `{ item: 'food', kind }` or `{ item: 'potion' }`. The `#screen` is the drop zone (highlight class on `dragover`, cleared on `dragleave`/`drop`); drop posts the same message as the click. Disabled tiles are not draggable.
- [ ] **Step 4: Drag buddy to reorder**: occupied roster slots are `draggable`; dropping on another occupied slot moves the dragged id to that position and posts `reorder` with the full id list. Click-to-switch still works (a click that was not a drag).
- [ ] **Step 5: Frenzy, eggs, forms**: when `frenzyMsLeft > 0`, show a flame marker with minutes left by the XP meter (pixel style, `aria-label` "Coding frenzy, triple XP, N minutes left"). Egg caption becomes `Next egg: <percent>%`, or `Egg progress paused during frenzy` when `eggPaused`. Egg offer gets a third `.path` button "Crack into 2 potions" posting `crackEgg`, enabled even when the party is full. The stage label (`#stage`) becomes a button posting `changeForm` when the pet has more than one unlocked form (title "Change form").
- [ ] **Step 6: Verify** (`npm run compile`, then F5 with a test save): drag meat onto the pet feeds it; drag a potion with 0 owned is impossible; `+` buys, click drinks; drag buddy 3 onto slot 1 reorders and the active buddy is unchanged; crack shows the modal and adds 2 potions; stage label opens the form picker; frenzy marker counts down.
- [ ] **Step 7: Commit**

```bash
git add src/DigimonPlaygroundProvider.ts media/index.html media/script.js media/styles.css
git commit -m "Items grid with potions, drag items onto the pet, drag to reorder the party, frenzy and form controls"
```

---

### Task 9: Docs, changelog, release prep

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `package.json` (`version` → `0.1.7`)

- [ ] **Step 1: README**: new XP table (spec section 1 values, Claude 5 per 30 s, prompts 15), active minutes, penalties (starving and exhausted each halve XP, together a quarter; starving still blocks evolution and form changes), level pacing (Child in about a day, Adult in about 4 to 5 days, Ultimate in about 3 to 4 weeks for a median coder), potions, frenzy, forms, status bar and `digimon.openOnStartup`, drag and drop. No em dashes.
- [ ] **Step 2: CHANGELOG**: `0.1.7` entry summarizing the above, noting saves upgrade automatically.
- [ ] **Step 3: Full verification**

Run: `npm run test:unit && npm run compile && npm test`
Expected: all unit tests PASS, no type or lint errors, integration tests PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md package.json
git commit -m "Release 0.1.7: faster XP, potions, frenzy, forms, status bar, drag and drop"
```
