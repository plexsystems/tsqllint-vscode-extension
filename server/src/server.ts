"use strict";
import {
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  IConnection,
  InitializeResult,
  IPCMessageReader,
  IPCMessageWriter,
  TextDocuments,
  TextDocumentSyncKind
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as uid from "uid-safe";
import { ITsqlLintError, parseErrors } from "./parseError";
import { getCommands, registerFileErrors } from "./commands";
import { TSQLLintRuntimeHelper } from "./TSQLLintRuntimeHelper";

const applicationRoot = path.parse(process.argv[1]);

const connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
const documents = new TextDocuments(TextDocument);
documents.listen(connection);

connection.onInitialize(
  (): InitializeResult => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      codeActionProvider: true
    }
  })
);

connection.onCodeAction(getCommands);

const toolsHelper: TSQLLintRuntimeHelper = new TSQLLintRuntimeHelper(applicationRoot.dir);

const spawnChildProcess = (toolsPath: string, fileUri: string) => {
  let childProcess: ChildProcess;

  switch (os.type()) {
    case "Darwin":
      childProcess = spawn(`${toolsPath}/osx-x64/TSQLLint.Console`, [fileUri]);
      break;
    case "Linux":
      childProcess = spawn(`${toolsPath}/linux-x64/TSQLLint.Console`, [fileUri]);
      break;
    case "Windows_NT":
      switch (process.arch) {
        case "ia32":
          childProcess = spawn(`${toolsPath}/win-x86/TSQLLint.Console.exe`, [fileUri]);
          break;
        case "x64":
          childProcess = spawn(`${toolsPath}/win-x64/TSQLLint.Console.exe`, [fileUri]);
          break;
        default:
          throw new Error(`Invalid Platform: ${os.type()}, ${process.arch}`);
      }
      break;
    default:
      throw new Error(`Invalid Platform: ${os.type()}, ${process.arch}`);
  }

  return childProcess;
};

const parseChildProcessResult = (childProcess: ChildProcess, callback: (error: Error, result: string[]) => void) => {
  let result: string;
  childProcess.stdout.on("data", (data: string) => {
    result += data;
  });

  childProcess.stderr.on("data", (data: string) => {
    // eslint-disable-next-line no-console
    console.error(`stderr: ${data}`);
  });

  childProcess.on("close", () => {
    const list: string[] = result.split("\n");
    const resultsArr: string[] = [];

    list.forEach((element) => {
      const index = element.indexOf("(");
      if (index > 0) {
        resultsArr.push(element.substring(index, element.length - 1));
      }
    });

    callback(null, resultsArr);
  });
};

const lintBuffer = (fileUri: string, callback: (error: Error, result: string[]) => void): void => {
  toolsHelper
    .tsqllintRuntime()
    .then((toolsPath: string) => {
      const childProcess = spawnChildProcess(toolsPath, fileUri);
      parseChildProcessResult(childProcess, callback);
    })
    .catch((error: Error) => {
      throw error;
    });
};

const buildTempFilePath = (textDocument: TextDocument) => {
  const ext = path.extname(textDocument.uri) || ".sql";
  const name = uid.sync(18) + ext;
  return path.join(os.tmpdir(), name);
};

const validateBuffer = (textDocument: TextDocument): void => {
  const tempFilePath: string = buildTempFilePath(textDocument);
  fs.writeFileSync(tempFilePath, textDocument.getText());

  lintBuffer(tempFilePath, (error: Error, lintErrorStrings: string[]) => {
    const toDiagnostic = (lintError: ITsqlLintError): Diagnostic => {
      return {
        severity: DiagnosticSeverity.Error,
        range: lintError.range,
        message: lintError.message,
        source: `TSQLLint: ${lintError.rule}`
      };
    };

    if (error !== undefined && error !== null) {
      registerFileErrors(textDocument, []);
      throw error;
    }

    const errors = parseErrors(textDocument.getText(), lintErrorStrings);
    registerFileErrors(textDocument, errors);
    const diagnostics = errors.map(toDiagnostic);

    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });

    fs.unlinkSync(tempFilePath);
  });
};

documents.onDidChangeContent((change: { document: TextDocument }) => {
  validateBuffer(change.document);
});

connection.listen();
