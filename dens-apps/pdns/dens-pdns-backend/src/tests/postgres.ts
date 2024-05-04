/**
 * Convenience functions for spawning a fresh instance of Postgres for testing
 */

import * as child_process from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { poll, processFailedMessage } from "./utils.js";

/**
 * {@link Postgres} is a class for the related data of spawning a fresh
 * Postgres instance in a temporary directory which only runs on a Unix Domain Socket
 */
export class Postgres {
  unixSocketDirectory: string;
  childProcess: ChildProcess;

  /**
   * The constructor for starting a fresh postgres database
   *
   * @private TODO(jaredponn): we don't support adding any options at the
   * moment
   */
  public static async new(_options?: object): Promise<Postgres> {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), `postgres-`));

    {
      const initdb = child_process.spawn(`initdb`, [
        `--pgdata`,
        cwd,
        `--auth`,
        `trust`,
      ]);

      const initdbStdErr: string[] = [];
      const initdbStdOut: string[] = [];

      initdb.stderr.on("data", (chunk) => initdbStdErr.push(chunk));
      initdb.stdout.on("data", (chunk) => initdbStdOut.push(chunk));

      await new Promise<void>((resolve, reject) =>
        initdb.on("exit", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(
                processFailedMessage(
                  initdb,
                  initdbStdOut.join(""),
                  initdbStdErr.join(""),
                ),
              ),
            );
          }
        })
      );
    }

    const postgres = child_process.spawn(`postgres`, [
      `-h`,
      ``,
      `-k`,
      cwd,
      `-D`,
      cwd,
    ]);

    const result = new Postgres(cwd, postgres);
    process.once("exit", (_) => result.kill());

    {
      const postgresStdErr: string[] = [];
      const postgresStdOut: string[] = [];

      postgres.stderr.on("data", (chunk) => postgresStdErr.push(chunk));
      postgres.stdout.on("data", (chunk) => postgresStdOut.push(chunk));

      postgres.on("exit", (code, signal) => {
        if (
          !((code !== null && code === 0) ||
            (signal !== null && signal === "SIGTERM"))
        ) {
          throw new Error(
            processFailedMessage(
              postgres,
              postgresStdOut.join(""),
              postgresStdErr.join(""),
            ),
          );
        }
      });
    }

    // Busy loop until postgres is ready
    await poll(() =>
      new Promise<boolean | undefined>((resolve) => {
        const pgIsReady = child_process.spawn(`pg_isready`, [
          `-d`,
          `postgres`,
          `-h`,
          result.unixSocketDirectory,
        ], {});

        pgIsReady.on("close", (code) => {
          if (code === 0) {
            return resolve(true);
          } else {
            return resolve(undefined);
          }
        });
      })
    );

    return result;
  }

  public kill() {
    if (!this.childProcess.killed) {
      this.childProcess.kill();
    }
    process.off("exit", this.kill);
  }

  /**
   * A pretty string for printing off the database's directory information
   */
  public databaseDirectoryInfo(): string {
    return `Postgres working directory:\n\t${this.unixSocketDirectory}\n` +
      `To restart Postgres execute:\n\tcd ${this.unixSocketDirectory} && postgres -h '' -k ${this.unixSocketDirectory} -D ${this.unixSocketDirectory}\n` +
      `To connect to Postgres via psql execute:\n\tpsql -h ${this.unixSocketDirectory}`;
  }

  /**
   * Creates a user with the executable `createuser` with some sane defaults.
   */
  public async createUser(username: string) {
    const createUser = child_process.spawn(`createuser`, [
      `-h`,
      this.unixSocketDirectory,
      `-d`, // Allow the user to create databases
      `-r`, // Give CREATEROLE privilege
      username,
    ]);
    {
      const createUserStdErr: string[] = [];
      const createUserStdOut: string[] = [];

      createUser.stdout.on("data", createUserStdOut.push);
      createUser.stderr.on("data", createUserStdErr.push);

      await new Promise<void>((resolve, reject) => {
        createUser.on("exit", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(
                processFailedMessage(
                  createUser,
                  createUserStdOut.join(""),
                  createUserStdOut.join(""),
                ),
              ),
            );
          }
        });
      });
    }
  }

  /**
   * Creates a database with the executable `createdb` with some sane defaults.
   */
  public async createDb(owner: string, database: string) {
    const createDb = child_process.spawn(`createdb`, [
      `-h`,
      this.unixSocketDirectory,
      `-O`,
      owner,
      database,
    ]);
    {
      const createDbStdErr: string[] = [];
      const createDbStdOut: string[] = [];

      createDb.stdout.on("data", createDbStdOut.push);
      createDb.stderr.on("data", createDbStdErr.push);

      await new Promise<void>((resolve, reject) => {
        createDb.on("exit", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(
                processFailedMessage(
                  createDb,
                  createDbStdOut.join(""),
                  createDbStdOut.join(""),
                ),
              ),
            );
          }
        });
      });
    }
  }

  private constructor(unixSocketDirectory: string, childProcess: ChildProcess) {
    this.unixSocketDirectory = unixSocketDirectory;
    this.childProcess = childProcess;
  }
}
