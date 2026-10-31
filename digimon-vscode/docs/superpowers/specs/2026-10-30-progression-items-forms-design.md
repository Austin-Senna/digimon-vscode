# Faster progression, potions, frenzy, forms, and UI conveniences

Status: approved in conversation, pending doc review. Builds on release 0.1.6 (`GAME_VERSION = 6`).

## Why

Manual coding levels the pet too slowly. Only keystrokes earn XP (1 per 3 s), so reading, navigating and debugging
earn nothing, and a real hour of hand-written code lands around 400-600 XP. Meanwhile surplus eggs pile up with nothing
to do once the party is full, bits have only one use (food), and an evolved buddy can never show its earlier forms.
The goal is a pet that grows visibly from any kind of coding, with a small item economy that makes bits and spare eggs
worth something.

## Goals

1. Roughly 3x faster pet leveling from activity, with manual coding no longer second-class to Claude.
2. Softer care penalties.
3. XP potions: stockable, crafted from spare eggs or bought with bits.
4. Coding frenzy: a temporary XP boost tied to earning an egg.
5. Free devolve/re-evolve between unlocked forms, keeping level and XP.
6. A status bar entry that opens the Digimon view, plus optional auto-open.
7. Drag and drop: items onto the pet, buddies to reorder the party. An inventory UI that scales past four items.

## Non-goals and anti-goals

- No change to the level curve (`xpPerLevelUnit`, `evolveAtLevel`). Faster progression comes from income, not cheaper levels.
- The bit and egg economy must not inflate. Bits earned and egg progress per hour of activity stay at 0.1.6 rates.
  Failure mode to avoid: eggs every two hours, potions effectively free, frenzy nearly always on.
- Forms are cosmetic. No stat, XP, food or energy differences between forms.
- The Adult path chosen at Child stays locked forever. Devolving to Child does not reopen the choice.
- No browser `alert`/`confirm` dialogs in the webview. Confirmations go through the extension (`showWarningMessage`).

## Design

### 1. XP income (pet.ts `RULES`)

- Edit cooldown: 3 s → 1 s (`cooldownMs.edit`).
- `xpPerActivity` tripled for manual activity: save 15, commit 30, command 9, prompt 15. Claude work only doubles:
  claudeWork 5 per 30 s per session (2.5x). Edits stay 1 XP; the cooldown change is their 3x.
- New activity `active`: one credit per wall-clock minute in which this window saw any editor interaction while
  focused (text edits, selection/cursor changes, visible-range scroll, active-editor switch, debug session
  start/stop). Worth 10 XP. This is the "time-based" XP that pays for reading and debugging.
  - Only the focused window credits (`vscode.window.state.focused`), so multiple windows never double-count.
  - Credited through the normal `recordActivity` path with a 60 s cooldown (`lastActiveXpAt` field), which also wakes
    the pet, and counts toward the sleep timer like other activity.
- `energyCostPerXp`: 0.05 → 0.05 / 3, so the 3x income does not exhaust the pet 3x sooner.
- Energy is charged on base XP (before care penalties and frenzy), not on XP granted. Energy drain per hour of
  activity is then the same in every state: frenzy does not drain twice as fast, and a starving pet pays energy like
  any other (it now earns XP, so it does work). (Builder-check call.)

**Decoupling effort from XP.** Today `activityEffort` returns base XP, and effort drives both bits (1:1) and egg
progress. To keep the economy at 0.1.6 rates, effort gets its own per-activity table (`effortPerActivity`) holding
the 0.1.6 rates, rounded up to whole numbers: edit 1, save 5, commit 10, command 3, prompt 5, claudeWork 2,
active 0. Edits now fire up to 3x as often, so typing earns up to 3x the bits it did; accepted to keep bits and effort
whole numbers. The active minute is new, so it earns pet XP only. Effort is never affected by care penalties.

### 2. Care penalties

- Starving (fullness 0) today earns 0 XP. It now earns 50%.
- Exhausted (energy 0) stays at 50%.
- The two stack multiplicatively: starving and exhausted earns 25%.
- Starving still blocks evolution (`evolve`, `isReadyToChoose`) and form switching.
- "Hungry" (below 25 fullness) still has no penalty.
- Constant: `starvingXpMultiplier: 0.5` next to `exhaustedXpMultiplier`.

### 3. XP potions

- `GameState.potions: number` (whole count, starts at 0).
- A potion gives the active buddy a flat 1,000 XP. It skips the starving/exhausted multipliers, costs no energy, and
  frenzy does not apply. It does fire `leveledUp`, `readyToChoose` and evolution exactly like activity XP.
  It can be drunk by a Digitama (it may hatch it). Like activity XP, it evolves at most one stage per call; a potion
  that crosses several thresholds evolves one stage now and the rest on following ticks, each with its own scene.
  (Builder-check call: consistent with activity XP, and each form gets its moment.)
- Buy: 1,000 bits each (`ROSTER.potionPrice`). Buying adds to stock; it does not drink.
- Crack an egg: the oldest egg offer can be turned into 2 potions (`ROSTER.potionsPerEgg`) instead of choosing a line.
  Irreversible, so the extension confirms with a modal before cracking. Available whether or not the party is full.
- Drinking with 0 potions does nothing and emits a `noPotions` event (mirrors `cannotAfford`).
- New game functions: `buyPotion`, `drinkPotion`, `crackEgg`, each returning a `GameUpdate`.

### 4. Coding frenzy

- `GameState.frenzyUntil: number` (epoch ms, 0 = none).
- Whenever `grantEggs` grants one or more eggs, frenzy is set to `max(now, frenzyUntil) + 30 min`. Granting two at
  once adds 60 min.
- While `now < frenzyUntil`, activity XP to the pet is tripled (applied after care penalties).
- During frenzy, activity earns no egg progress at all: `effort` does not grow, so the next egg cannot arrive during
  or because of a frenzy, and frenzies cannot chain. Bits are still earned at the normal (un-tripled) rate. This
  splits today's single `effort` increment in `recordGameActivity` (and Claude crediting) into "bits always, effort
  only outside frenzy".
- Wall-clock duration. It runs out even if VS Code is closed. Builder's call: switching buddies keeps the frenzy
  (it belongs to the player, not the buddy).
- Event `frenzyStarted` → notification ("Coding frenzy! Triple XP for 30 minutes.").
- UI: frenzy indicator on the screen (for example a flame icon and time remaining near the XP meter) and in the
  status bar item.

### 5. Forms (devolve / re-evolve)

- `PetState.stage` keeps its meaning: the highest stage reached. It drives progression (`evolve`,
  `nextEvolutionLevel`, `isReadyToChoose`) exactly as today.
- New `PetState.form: Stage`: the form shown. `species()` for display and sprites uses `form`. Missing in old saves →
  `form = stage`.
- The player can set `form` to any stage from `babyI` up to `stage`. Digitama is not selectable once hatched.
  Forms above Child use the locked branch.
- Blocked while starving (the `setForm` call returns unchanged state plus a `refused`-style event).
- When the pet reaches a new `stage` (auto-evolution or choosing the Adult path), `form` jumps to the new stage and
  the normal evolution scene plays, even if it was showing a lower form. Reaching a new stage is the reward moment.
- Changing form upward plays the existing evolution scene (from current form to target). Changing downward swaps the
  sprite with a short effect, no full scene (builder's call on the effect).
- Choosing the Adult path works from any form while `stage === 'child'` and the level is reached.
- Entry points: a `digimon.changeForm` command (quick pick of unlocked forms, current one marked), and clicking the
  stage label in the webview opens the same picker.
- New game function `setForm(game, stage)`.

### 6. Status bar and auto-open

- A status bar item (left side, low priority) showing the active buddy's name and level, for example `Agumon Lv 12`,
  with a frenzy marker while active. Tooltip: mood, fullness, energy. Click opens the Digimon view container
  (`workbench.view.extension.Digimon-Buddy`). Updates on `controller.onDidChange`.
- Setting `digimon.openOnStartup` (boolean, default `false`). When true, on activation open the view without
  stealing editor focus (open, then return focus to the active editor group).

### 7. Drag and drop and the inventory

- **Inventory.** "Food" becomes "Items": a uniform grid of tiles that wraps, so more items fit later. Each tile has
  the pixel icon, name/effect in a tooltip, and a badge: price for buy-on-use foods, owned count for potions.
  - Food keeps today's behavior: click (or drop on the pet) buys one and feeds it.
  - Potion: click (or drop on the pet) drinks one if owned. Buying is a separate, explicit affordance on the tile (for
    example a small "+ 1,000" buy button) so a click never spends 1,000 bits by surprise.
- **Drag item → pet.** Dragging a food or potion tile onto the screen/pet uses it, exactly like clicking. Highlight
  the drop target during the drag. Clicking keeps working.
- **Drag buddy → reorder.** Party slots can be dragged to reorder. Order persists in `GameState.buddies` (array order)
  via a `reorder` message carrying the full id list. The extension validates that it is a permutation of current ids.
  Reordering never changes the active buddy. Click-to-switch keeps working.
- Use native HTML5 drag and drop inside the webview. It must work with mouse. Keyboard users keep the click paths.
- Toolbar: the Feed (heart) action becomes a Shop quick pick listing foods and "XP Potion (1,000 bits)". Drinking is
  also offered there when potions are owned. The "Choose New Egg" quick pick gains a "Crack into 2 potions" item.

### Save format

- `GAME_VERSION` 6 → 7. On load of v6: `potions = 0`, `frenzyUntil = 0`, each buddy `form = stage` and
  `lastActiveXpAt = 0`. No XP or effort rescale (the curve is unchanged).
- `parseState` accepts and validates `form` (must be a stage between `babyI` and `stage`, or equal to `stage` for
  Digitama). An invalid form falls back to `stage` rather than rejecting the save.

### Copy and docs

- Fix the stale "A new one arrives every 1,500 XP" message in `extension.ts` (eggs come every 5,000 effort).
- README: XP table and coding rates, starving penalty wording ("stops earning XP" is now 50%), potions, frenzy,
  forms, status bar, drag and drop. CHANGELOG entry.

## Testing

Unit tests (mocha, `src/test/unit`) for every rule above: new XP values and edit cooldown, active-minute cooldown,
effort at 0.1.6 rates in whole numbers, stacked penalties, frenzy start/extend/expiry, that it pauses effort but not bits, potion
buy/drink/crack including insufficient bits and zero stock, potion XP triggering evolution, `setForm` bounds and
starving block, form jump on new stage, reorder validation, v6 → v7 migration. Existing tests whose numbers change
are updated to the new values, not loosened.

## Left to the builder

Exact visual design of the Items grid, frenzy indicator and devolve effect (match the existing pixel LCD style); status
bar wording and priority; which editor events feed the active minute beyond the list above; module placement of new
constants; version number for the release.
