/* eslint-disable no-console */
"use strict";

import { https } from "follow-redirects";
import * as decompress from "decompress";
// @ts-ignore
import * as decompressTargz from "decompress-targz";
import * as fs from "fs";
import * as os from "os";

export class TSQLLintRuntimeHelper {
  private readonly _tsqllintVersion = "v1.11.0";
  private readonly _applicationRootDirectory: string;
  private readonly _runTime: string;
  private _tsqllintToolsPath: string;

  public constructor(applicationRootDirectory: string) {
    this._applicationRootDirectory = applicationRootDirectory;

    switch (os.type()) {
      case "Darwin":
        this._runTime = "osx-x64";
        break;
      case "Linux":
        this._runTime = "linux-x64";
        break;
      case "Windows_NT":
        switch (process.arch) {
          case "ia32":
            this._runTime = "win-x86";
            break;
          case "x64":
            this._runTime = "win-x64";
            break;
          default:
            throw new Error(`Invalid Platform: ${os.type()}, ${process.arch}`);
        }
        break;
      default:
        throw new Error(`Invalid Platform: ${os.type()}, ${process.arch}`);
    }
  }

  public async tsqllintRuntime(): Promise<string> {
    if (this._tsqllintToolsPath) {
      return this._tsqllintToolsPath;
    }

    const tsqllintInstallDirectory = `${this._applicationRootDirectory}/tsqllint`;
    if (fs.existsSync(`${tsqllintInstallDirectory}/${this._runTime}`)) {
      this._tsqllintToolsPath = tsqllintInstallDirectory;
      return this._tsqllintToolsPath;
    }

    const path = await this._downloadRuntime(tsqllintInstallDirectory);
    const installDir = await this._unzipRuntime(path, tsqllintInstallDirectory);
    console.log("Installation of TSQLLint Runtime Complete");

    return installDir;
  }

  private _downloadRuntime(installDirectory: string): Promise<string> {
    const urlBase = `https://github.com/tsqllint/tsqllint/releases/download/${this._tsqllintVersion}`;
    const downloadUrl = `${urlBase}/${this._runTime}.tgz`;
    const downloadFilePath = `${installDirectory}/${this._runTime}.tgz`;

    return new Promise((resolve, reject) => {
      console.log(`Installing TSQLLint Runtime: ${downloadUrl}`);

      if (!fs.existsSync(installDirectory)) {
        fs.mkdirSync(installDirectory);
      }

      const file = fs.createWriteStream(downloadFilePath);

      https
        .get(downloadUrl, (response) => {
          const length = Number(response.headers["content-length"]);
          response.pipe(file);
          process.stdout.write("Downloading...");

          if (!isNaN(length)) {
            process.stdout.write(" [");

            const max = 60;
            let char = 0;
            let bytes = 0;

            response.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              const fill = Math.ceil((bytes / length) * max);

              for (let i = char; i < fill; i++) {
                process.stdout.write("=");
              }

              char = fill;
            });

            response.on("end", () => process.stdout.write("]\n"));
          }

          file.on("finish", () => {
            file.close();
            resolve(downloadFilePath);
          });
        })
        .on("response", (res) => {
          if (res.statusCode === 200) {
            return resolve();
          } else {
            fs.unlinkSync(downloadFilePath);
            return reject(
              new Error(`There was a problem downloading the TSQLLint Runtime. Reload VS Code to try again`)
            );
          }
        })
        .on("error", (err: Error) => {
          fs.unlinkSync(downloadFilePath);
          reject(err);
        });
    });
  }

  private async _unzipRuntime(path: string, tsqllintInstallDirectory: string): Promise<string> {
    await decompress(path, tsqllintInstallDirectory, { plugins: [decompressTargz()] });
    this._tsqllintToolsPath = tsqllintInstallDirectory;

    return tsqllintInstallDirectory;
  }
}
