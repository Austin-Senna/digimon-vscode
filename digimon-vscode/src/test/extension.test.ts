import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { DigimonApi } from '../extension';

async function activateExtension(): Promise<DigimonApi> {
	const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'digimon-vscode');
	assert.ok(extension, 'extension is installed');
	return extension.activate() as Promise<DigimonApi>;
}

suite('Extension Test Suite', () => {
	test('activates and registers its commands', async () => {
		await activateExtension();
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('digimon.feed'));
		assert.ok(commands.includes('digimon.newEgg'));
	});

	test('feeding a fresh egg is harmless', async () => {
		await vscode.commands.executeCommand('digimon.feed');
	});

	test('Claude prompts in this workspace earn XP; other workspaces do not', async function () {
		this.timeout(10_000);
		const api = await activateExtension();
		const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspace, 'test runs with a workspace folder');

		const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'digimon-events-')), 'events.jsonl');
		fs.writeFileSync(log, '');
		const config = vscode.workspace.getConfiguration('digimon.claude');
		await config.update('eventsPath', log, vscode.ConfigurationTarget.Global);
		try {
			const line = (cwd: string) => JSON.stringify({ v: 1, t: Date.now(), session: 's', event: 'prompt', subagent: false, cwd }) + '\n';
			const before = api.state().xp;

			fs.appendFileSync(log, line('/somewhere/else'));
			fs.appendFileSync(log, line(path.join(workspace, 'src')));
			for (let i = 0; i < 50 && api.state().xp === before; i++) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			assert.strictEqual(api.state().xp, before + 3);
		} finally {
			await config.update('eventsPath', undefined, vscode.ConfigurationTarget.Global);
		}
	});
});
