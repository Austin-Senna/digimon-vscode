import { defineConfig } from '@vscode/test-cli';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// A fresh profile per run: no pet carries over between runs (so cooldowns start clear), and the extension reads
// an empty event log instead of ~/.claude/digimon/events.jsonl, where real Claude sessions would feed the test pet.
// VS Code puts an IPC socket in the user data dir; macOS caps socket paths at 103 chars, which the default
// .vscode-test/user-data exceeds in deeply nested checkouts, so it lives in the short temp dir.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digimon-test-'));
fs.mkdirSync(path.join(userDataDir, 'User'));
fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify({
	'digimon.claude.eventsPath': path.join(userDataDir, 'events.jsonl'),
}));

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Integration tests need a real workspace folder, e.g. to match Claude session cwds.
	workspaceFolder: fs.mkdtempSync(path.join(os.tmpdir(), 'digimon-workspace-')),
	launchArgs: ['--user-data-dir', userDataDir],
});
