import * as childProcess from 'child_process';
import * as vscode from 'vscode';
import { isDescendant } from './events';

/**
 * The integrated terminal whose shell is an ancestor of `pid` (a Claude hook's parent process), if any.
 * Needs `ps`, so it finds nothing on Windows; callers fall back to naming the session's folder.
 */
export async function terminalRunning(pid: number): Promise<vscode.Terminal | undefined> {
    const parents = await processParents();
    if (!parents) {
        return undefined;
    }
    for (const terminal of vscode.window.terminals) {
        const shell = await terminal.processId;
        if (shell !== undefined && isDescendant(pid, shell, parents)) {
            return terminal;
        }
    }
    return undefined;
}

function processParents(): Promise<Map<number, number> | undefined> {
    if (process.platform === 'win32') {
        return Promise.resolve(undefined);
    }
    return new Promise(resolve => {
        childProcess.execFile('ps', ['-A', '-o', 'pid=,ppid='], { timeout: 2_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
                resolve(undefined);
                return;
            }
            const parents = new Map<number, number>();
            for (const line of stdout.split('\n')) {
                const [pid, ppid] = line.trim().split(/\s+/).map(Number);
                if (Number.isInteger(pid) && Number.isInteger(ppid)) {
                    parents.set(pid, ppid);
                }
            }
            resolve(parents);
        });
    });
}
