import * as vscode from 'vscode';
import * as vscodelc from 'vscode-languageclient/node';

import { ClangdContext } from './clangd-context';
import * as config from './config';

export function activate(context: ClangdContext) {
  const feature = new OpenDocumentationFeature(context);
  context.client.registerFeature(feature);
}

namespace protocol {

  export interface SymbolInfo {
    name: string;
    containerName: string;
    usr: string;
    id?: string;
  }

  export interface SymbolInfoParams {
    textDocument: vscodelc.TextDocumentIdentifier;
    position: vscodelc.Position;
  }

  export namespace SymbolInfoRequest {
    export const type =
      new vscodelc.RequestType<SymbolInfoParams, SymbolInfo[], void>(
        'textDocument/symbolInfo');
  }

} // namespace protocol

class OpenDocumentationFeature implements vscodelc.StaticFeature {
  private commandRegistered = false;

  constructor(private readonly context: ClangdContext) { }

  fillClientCapabilities(_capabilities: vscodelc.ClientCapabilities) { }
  fillInitializeParams(_params: vscodelc.InitializeParams) { }

  async getSymbolsUnderCursor(): Promise<Array<string>> {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
      return [];

    const document = editor.document;
    const position = editor.selection.active;
    const request: protocol.SymbolInfoParams = {
      textDocument: { uri: document.uri.toString() },
      position: position,
    };

    const reply = await this.context.client.sendRequest(
      protocol.SymbolInfoRequest.type, request);

    let result: Array<string> = [];
    reply.forEach(symbol => {
      if (symbol.name === null || symbol.name === undefined)
        return;

      if (symbol.containerName === null || symbol.containerName === undefined) {
        result.push(symbol.name);
        return;
      }

      const needComas =
        !symbol.containerName.endsWith('::') && !symbol.name.startsWith('::');
      result.push(symbol.containerName + (needComas ? '::' : '') + symbol.name);
    });

    return result;
  }

  async openDocumentation() {
    const symbols = await this.getSymbolsUnderCursor();
    if (symbols.length === 0)
      return;

    const docs = await config.get<object>('documentation');
    for (const symbol of symbols) {
      for (const [key, value] of Object.entries(docs)) {
        let url = value as string;
        const match = symbol.match(new RegExp(key));
        if (match !== null && url.length > 0) {
          url = url.replace('{{symbol}}', symbol);
          for (let i = 0; i < match.length; ++i) {
            url = url.replace('{{match:' + i + '}}', match[i]);
          }
          vscode.env.openExternal(vscode.Uri.parse(url));
          return;
        }
      }
    }
    vscode.window.showWarningMessage('No documentation found for ' + symbols);
  }

  initialize(capabilities: vscodelc.ServerCapabilities,
    _documentSelector: vscodelc.DocumentSelector | undefined) {
    if (this.commandRegistered)
      return;
    this.commandRegistered = true;

    this.context.subscriptions.push(vscode.commands.registerCommand(
      'clangd.openDocumentation', this.openDocumentation, this));
  }
  getState(): vscodelc.FeatureState { return { kind: 'static' }; }
  dispose() { }
}