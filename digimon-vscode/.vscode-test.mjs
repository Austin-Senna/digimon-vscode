import { defineConfig } from '@vscode/test-cli';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Integration tests need a real workspace folder, e.g. to match Claude session cwds.
	workspaceFolder: fs.mkdtempSync(path.join(os.tmpdir(), 'digimon-workspace-')),
	// VS Code puts an IPC socket in the user data dir; macOS caps socket paths at 103 chars,
	// which the default .vscode-test/user-data exceeds in deeply nested checkouts.
	launchArgs: ['--user-data-dir', path.join(os.tmpdir(), 'digimon-vscode-test')],
});
