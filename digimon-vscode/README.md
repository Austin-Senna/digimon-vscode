# Digimon Buddy

A Digimon that grows while Claude Code works. It lives in VS Code's secondary side bar, next to Chat, watches your Claude Code sessions, and levels up from your coding too.

<p align="center">
<img src="https://raw.githubusercontent.com/Austin-Senna/digimon-vscode/main/digimon-vscode/docs/images/screenshot.png" alt="Greymon on the Digivice screen while Claude works, with the XP meter, fullness and energy, the food tray, and a party of three" width="320">
</p>

## It sees Claude Code

Run **Digimon: Connect Claude Code** (or accept the prompt on first start). From then on, every Claude Code session working in your workspace feeds your Digimon:

| When Claude... | Your Digimon |
| --- | --- |
| is working | earns 2 XP per minute, per session |
| gets a prompt from you | earns 3 XP |
| finishes its turn | cheers |
| has a tool call fail | refuses |
| hits an API error | looks sad |

Its screen shows "Claude is working" while a session runs. When Claude is waiting on a permission prompt or your answer, it blinks **"Claude needs you"**. Click it to jump straight to the terminal that session is running in.

**It never slows Claude down.** The hooks run in the background, so Claude Code never waits on them. Each one takes about 40 milliseconds, appends one line to a local file, and always exits cleanly.

**It only records what the pet needs:** the event type, tool name, session id, folder, and time. Never your prompts, code, or tool output.

Connecting asks first and backs up your Claude settings file. **Digimon: Disconnect Claude Code** undoes it. Requires Python 3.

## It grows

You start with a random Digitama. XP from Claude and from your own coding drives it through seven stages. Coding earns 3 XP per 30 seconds of editing, 5 per save that writes real changes (once a minute), and 10 per git commit (once every 5 minutes), so mashing save or making empty commits earns nothing extra.

<p align="center">
<img src="https://raw.githubusercontent.com/Austin-Senna/digimon-vscode/main/digimon-vscode/docs/images/evolution-line.png" alt="Agumon's line from egg to Ultimate: Agu Digitama, Zurumon, Koromon, Agumon, Greymon, MetalGreymon, WarGreymon" width="640">
</p>

It takes a few hours of work to reach Child, about a week to reach Adult, and about a month to reach Ultimate. Up to Child it evolves on its own. Then you choose its path, for Agumon either Greymon → MetalGreymon → WarGreymon or Tyrannomon → SkullGreymon → BlackWarGreymon. There are [13 lines](https://github.com/Austin-Senna/digimon-vscode/blob/main/digimon-vscode/docs/evolution-lines.md) to collect.

## Keep it fed

Every XP also earns a **bit**. Spend bits on food from the tray under its screen: meat (+25 fullness) and vitamins (+40 energy) cost 50, sirloin (refills both) costs 150. Spending bits never costs XP. A hungry Digimon stops earning XP and can't evolve until you feed it, so check on it now and then. Time only passes while VS Code is open, so a weekend away won't starve it.

## Collect a party

About every day of active coding (1,500 XP) brings a new egg. Keep up to 6 buddies and click one to make it active; the others wait, frozen, until you switch back.

## Credits and disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or sponsored by Bandai or Toei Animation. Digimon and all related names are trademarks of Bandai.

Sprites come from Tortoiseshel's Digimon sprite collection and remain the property of their respective owners; they are not covered by this project's MIT license, which applies to the source code only. The view uses the [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) font (SIL Open Font License). Rights holders who want anything removed can [open an issue](https://github.com/Austin-Senna/digimon-vscode/issues) and it will be taken down.

Want to hack on it? See [docs/development.md](https://github.com/Austin-Senna/digimon-vscode/blob/main/digimon-vscode/docs/development.md).
