import * as vscode from 'vscode';

// 1. The Provider (The Waiter)
export class DigimonStatsProvider implements vscode.TreeDataProvider<DigimonStat> {

  private _onDidChangeTreeData: vscode.EventEmitter<DigimonStat | undefined | null | void> = new vscode.EventEmitter<DigimonStat | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<DigimonStat | undefined | null | void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DigimonStat): vscode.TreeItem {
    return element;
  }

  // The simplified "getChildren"
  getChildren(element?: DigimonStat): Thenable<DigimonStat[]> {
    if (element) {
      return Promise.resolve([]);
    }

    // If no element, return the ROOT items (Your Stats)
    return Promise.resolve([
      new DigimonStat('Species', 'Agumon', vscode.TreeItemCollapsibleState.None),
      new DigimonStat('Level', 'Rookie', vscode.TreeItemCollapsibleState.None),
      new DigimonStat('Energy', '100/100', vscode.TreeItemCollapsibleState.None),
      new DigimonStat('Mood', 'Happy', vscode.TreeItemCollapsibleState.None)
    ]);
  }
}

// 2. The Data Class (The Item)
class DigimonStat extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    private value: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.description = this.value; 
  }
}