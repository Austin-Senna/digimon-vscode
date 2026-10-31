# Digimon Buddy

A Digimon that grows while Claude Code works. It lives in VS Code's secondary side bar, next to Chat, watches your Claude Code sessions, and levels up from your coding too.

<p align="center">
<img src="https://raw.githubusercontent.com/Austin-Senna/digimon-vscode/main/digimon-vscode/docs/images/screenshot.png" alt="Greymon on the Digivice screen while Claude works, with the XP meter, fullness and energy, the food tray, and a party of three" width="320">
</p>

## It sees Claude Code

Run **Digimon: Connect Claude Code** (or accept the prompt on first start). From then on, every Claude Code session feeds your Digimon, whether it runs in VS Code or another terminal:

| When Claude... | Your Digimon |
| --- | --- |
| is working | earns 5 XP per 30 seconds, per session |
| gets a prompt from you | earns 15 XP |
| finishes its turn | cheers |
| has a tool call fail | refuses |
| hits an API error | looks sad |

Its screen shows "Claude is working" while a session runs. When Claude is waiting on a permission prompt or your answer, it blinks **"Claude needs you"**. Click it to jump straight to the terminal that session is running in.

**It never slows Claude down.** The hooks run in the background, so Claude Code never waits on them. Each one takes about 40 milliseconds, appends one line to a local file, and always exits cleanly.

**It only records what the pet needs:** the event type, tool name, session id, folder, and time. Never your prompts, code, or tool output.

Each session is credited once, however many VS Code windows you have open. To count only sessions working in the current window's folders, set `digimon.claude.scope` to `workspace`.

Connecting asks first and backs up your Claude settings file. **Digimon: Disconnect Claude Code** undoes it. Requires Python 3.

## It grows

You start with a random Digitama. XP from Claude and from your own coding drives it through seven stages. Coding earns 1 XP per second of editing, 15 per save that writes real changes (once every 30 seconds), 30 per git commit (once a minute), and 9 per command you run in a VS Code terminal (once every 10 seconds), so mashing save, making empty commits, or spamming `ls` earns nothing extra. Reading and debugging count too: every minute you move around, scroll, switch files, or run the debugger in the focused window earns 10 XP.

<p align="center">
<img src="https://raw.githubusercontent.com/Austin-Senna/digimon-vscode/main/digimon-vscode/docs/images/evolution-line.png" alt="Agumon's line from egg to Ultimate: Agu Digitama, Zurumon, Koromon, Agumon, Greymon, MetalGreymon, WarGreymon" width="640">
</p>

XP raises its **level**, and it evolves at set levels: Child at Lv 10 (about a day of typical coding), Adult at Lv 25 (four or five days), Ultimate at Lv 50 (three to four weeks). Levels keep going after Ultimate. Up to Child it evolves on its own, with a glowing evolution scene each time. At Lv 25 you choose its path, for Agumon either Greymon → MetalGreymon → WarGreymon or Tyrannomon → SkullGreymon → BlackWarGreymon. There are [13 lines](https://github.com/Austin-Senna/digimon-vscode/blob/main/digimon-vscode/docs/evolution-lines.md) to collect.

Once it has grown, it can show any form it has reached. Click its stage under the name (or run **Digimon: Change Form**) to devolve to Agumon or re-evolve to Greymon; its level and XP stay the same, and the path you chose stays locked.

## Keep it fed

Activity also earns **bits**: 1 per edit, 5 per save or prompt, 10 per commit, 3 per terminal command, and 2 per 30 seconds of Claude work. Spend them in the Items tray under its screen: click a food, or drag it onto your Digimon. Meat (+25 fullness) and vitamins (+40 energy) cost 100, sirloin (refills both) costs 300. Spending bits never costs XP. A starving Digimon earns half XP and can't evolve or change form until you feed it, and an exhausted one also earns half, so a starving, exhausted one earns a quarter. Check on it now and then. It only gets hungry while you're around: time stops when VS Code is closed, and after 5 minutes without any activity it falls asleep and stops getting hungry until you're back.

## Potions and frenzies

An **XP potion** gives your active Digimon 1,000 XP, whatever its mood. Buy one for 1,000 bits with the **+** on the potion in the Items tray, then click it or drag it onto your Digimon to drink it.

Each new egg also starts a **coding frenzy**: triple XP for 30 minutes. Progress toward the next egg pauses while it lasts, and the egg bar burns orange as the frenzy runs down.

## Collect a party

About every day of active coding earns a new egg: you pick one of two from lines you don't have yet, or crack it into two XP potions if you don't want it. Keep up to 6 buddies and click one to make it active; the others wait, frozen, until you switch back. Drag buddies to rearrange the party.

## Find it fast

The status bar shows your active buddy and its level, plus the minutes left in a frenzy. Click it to open the Digimon view in any window. To open the view automatically in every new window, turn on `digimon.openOnStartup`.

## Credits and disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or sponsored by Bandai or Toei Animation. Digimon and all related names are trademarks of Bandai.

Sprites come from Tortoiseshel's Digimon sprite collection and remain the property of their respective owners; they are not covered by this project's MIT license, which applies to the source code only. The view uses the [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) font (SIL Open Font License). Rights holders who want anything removed can [open an issue](https://github.com/Austin-Senna/digimon-vscode/issues) and it will be taken down.

Want to hack on it? See [docs/development.md](https://github.com/Austin-Senna/digimon-vscode/blob/main/digimon-vscode/docs/development.md).
