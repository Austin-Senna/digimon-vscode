# Digimon Buddy

A Digimon that grows while Claude Code works. It lives in VS Code's secondary side bar, next to Chat, watches your Claude Code sessions, and levels up from your coding too.

<p align="center">
<img src="https://raw.githubusercontent.com/Austin-Senna/digimon-vscode/main/digimon-vscode/docs/images/screenshot.png" alt="Greymon on the Digivice screen while Claude works, with the XP meter, fullness and energy, the food tray, and a party of three" width="320">
</p>

## It sees Claude Code

Run **Digimon: Connect Claude Code** (or accept the prompt on first start). From then on, every Claude Code session feeds your Digimon, whether it runs in VS Code or another terminal:

| When Claude... | Your Digimon |
| --- | --- |
| is working | earns 2 XP per 30 seconds, per session |
| gets a prompt from you | earns 5 XP |
| finishes its turn | cheers |
| has a tool call fail | refuses |
| hits an API error | looks sad |

Its screen shows "Claude is working" while a session runs. When Claude is waiting on a permission prompt or your answer, it blinks **"Claude needs you"**. Click it to jump straight to the terminal that session is running in.

**It never slows Claude down.** The hooks run in the background, so Claude Code never waits on them. Each one takes about 40 milliseconds, appends one line to a local file, and always exits cleanly.

**It only records what the pet needs:** the event type, tool name, session id, folder, and time. Never your prompts, code, or tool output.

Each session is credited once, however many VS Code windows you have open. To count only sessions working in the current window's folders, set `digimon.claude.scope` to `workspace`.

Connecting asks first and backs up your Claude settings file. **Digimon: Disconnect Claude Code** undoes it. Requires Python 3.

## It grows

You start with a random Digitama. XP from Claude and from your own coding drives it through seven stages. Coding earns 1 XP per 3 seconds of editing, 5 per save that writes real changes (once every 30 seconds), 10 per git commit (once a minute), and 3 per command you run in a VS Code terminal (once every 10 seconds), so mashing save, making empty commits, or spamming `ls` earns nothing extra.

<p align="center">
<img src="https://raw.githubusercontent.com/Austin-Senna/digimon-vscode/main/digimon-vscode/docs/images/evolution-line.png" alt="Agumon's line from egg to Ultimate: Agu Digitama, Zurumon, Koromon, Agumon, Greymon, MetalGreymon, WarGreymon" width="640">
</p>

XP raises its **level**, and it evolves at set levels: Child at Lv 10 (a couple of hours of work), Adult at Lv 25 (about four days), Ultimate at Lv 50 (about two weeks). Levels keep going after Ultimate. Up to Child it evolves on its own, with a glowing evolution scene each time. At Lv 25 you choose its path, for Agumon either Greymon → MetalGreymon → WarGreymon or Tyrannomon → SkullGreymon → BlackWarGreymon. There are [13 lines](https://github.com/Austin-Senna/digimon-vscode/blob/main/digimon-vscode/docs/evolution-lines.md) to collect.

## Keep it fed

Every XP also earns a **bit**. Spend bits on food from the tray under its screen: meat (+25 fullness) and vitamins (+40 energy) cost 100, sirloin (refills both) costs 300. Spending bits never costs XP. A hungry Digimon stops earning XP and can't evolve until you feed it, so check on it now and then. It only gets hungry while you're around: time stops when VS Code is closed, and after 5 minutes without any activity it falls asleep and stops getting hungry until you're back.

## Collect a party

About every day of active coding (5,000 XP) earns a new egg: you pick one of two from lines you don't have yet. Keep up to 6 buddies and click one to make it active; the others wait, frozen, until you switch back.

## Credits and disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or sponsored by Bandai or Toei Animation. Digimon and all related names are trademarks of Bandai.

Sprites come from Tortoiseshel's Digimon sprite collection and remain the property of their respective owners; they are not covered by this project's MIT license, which applies to the source code only. The view uses the [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) font (SIL Open Font License). Rights holders who want anything removed can [open an issue](https://github.com/Austin-Senna/digimon-vscode/issues) and it will be taken down.

Want to hack on it? See [docs/development.md](https://github.com/Austin-Senna/digimon-vscode/blob/main/digimon-vscode/docs/development.md).
