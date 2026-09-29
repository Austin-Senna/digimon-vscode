import * as vscode from 'vscode';

// Minimal subset of the built-in Git extension API (extensions/git/src/api/git.d.ts in microsoft/vscode).

interface Commit {
    readonly hash: string;
    readonly parents: string[];
}

interface Repository {
    readonly state: {
        readonly HEAD: { readonly name?: string; readonly commit?: string } | undefined;
        readonly onDidChange: vscode.Event<void>;
    };
    getCommit(ref: string): Promise<Commit>;
}

interface GitAPI {
    readonly repositories: Repository[];
    readonly onDidOpenRepository: vscode.Event<Repository>;
}

interface GitExtension {
    getAPI(version: 1): GitAPI;
}

/**
 * Calls `onCommit` when HEAD advances by a new child commit on the same branch.
 * Checkouts and resets move HEAD too but do not count. A pull that fast-forwards by exactly one commit,
 * or creates a merge commit, is indistinguishable from a local commit through this API and does count.
 */
export async function watchCommits(onCommit: () => void): Promise<vscode.Disposable> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
        return new vscode.Disposable(() => undefined);
    }
    const api = (await extension.activate()).getAPI(1);
    const disposables: vscode.Disposable[] = [];

    const watch = (repository: Repository) => {
        let branch = repository.state.HEAD?.name;
        let commit = repository.state.HEAD?.commit;
        disposables.push(repository.state.onDidChange(async () => {
            const head = repository.state.HEAD;
            const previousBranch = branch;
            const previousCommit = commit;
            branch = head?.name;
            commit = head?.commit;
            if (!commit || !previousCommit || commit === previousCommit || branch !== previousBranch) {
                return;
            }
            try {
                const created = await repository.getCommit(commit);
                if (created.parents[0] === previousCommit) {
                    onCommit();
                }
            } catch {
                // The commit can disappear between the event and the lookup (e.g. amend + gc); not worth surfacing.
            }
        }));
    };

    api.repositories.forEach(watch);
    disposables.push(api.onDidOpenRepository(watch));
    return vscode.Disposable.from(...disposables);
}
