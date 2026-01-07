import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class DigimonPlaygroundProvider implements vscode.WebviewViewProvider {

    constructor(private readonly _extensionUri: vscode.Uri) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        
        // 1. Get paths to resources on disk
        const stylePath = vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css');
        const scriptPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'script.js');
        const spritePath = vscode.Uri.joinPath(this._extensionUri, 'media', 'sprites', 'Adult', 'Airdramon.png'); 
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'index.html');

        // 2. Convert them to special VS Code Webview URIs
        const styleUri = webview.asWebviewUri(stylePath);
        const scriptUri = webview.asWebviewUri(scriptPath);
        const spriteUri = webview.asWebviewUri(spritePath);

        // 3. Read the HTML file from disk
        let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // 4. Replace the placeholders {{variable}} with real URIs
        htmlContent = htmlContent.replace('{{styleUri}}', styleUri.toString());
        htmlContent = htmlContent.replace('{{scriptUri}}', scriptUri.toString());
        htmlContent = htmlContent.replace('{{spriteUri}}', spriteUri.toString());

        return htmlContent;
    }
}