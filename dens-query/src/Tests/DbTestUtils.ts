// Some utility functions for testing the database.
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { setTimeout } from "timers/promises";

/**
 * Runs a test with a postgres database
 *
 * @private
 * Here's what's going on:
 * 1. Go in a temporary directory
 * 2. Run `initdb -D .` to create a postgres db cluster (see [1])
 * 3. Run
 *    ```
 *    postgres -D . -k . -p 5432 -c listen-addresses=
 *    ```
 *    Note that one could alternatively run
 *    ```
 *    postgres -D . -k . -h "" -p 5432 -c listen-addresses=
 *    ```
 *    to make postgres ONLY listen on the unix socket domain
 *    (see [2], [3], [4])
 * References:
 *  [1]: https://www.postgresql.org/docs/current/app-initdb.html
 *  [2]: https://www.postgresql.org/docs/current/app-pg-ctl.html
 *  [3]: https://www.postgresql.org/docs/current/app-postgres.html
 *  [4]: https://www.postgresql.org/docs/current/runtime-config-connection.html
 *
 * TODO(jaredponn): split this function up into an `init` and `shutdown`
 * function s.t. it can be used with node's `before` and `after` test runner
 * functions
 */
export async function withPgTest(
  assertion: (host: string, port: number) => Promise<unknown>,
) {
  // 1.
  const osDefaultTmpDir = os.tmpdir();

  // `pgCwd` is the temporary directory that pg will run in (also this is the
  // `host` of the database i.e., where the UNIX socket will reside)
  const pgCwd = await fs.mkdtemp(join(osDefaultTmpDir, `pg-`));

  const port = 5432;

  try {
    // 2.
    {
      const initdb = spawn("initdb", [`-D`, `.`], {
        cwd: pgCwd,
        stdio: ["ignore", "ignore", "inherit"],
      });

      await new Promise((resolve, reject) => {
        initdb.on(`close`, (code) => {
          if (code === 0) {
            resolve(code);
          } else {
            reject(new Error(`initdb failed with exit code ${code}`));
          }
        });
      });
    }

    // 3.
    const postgres = spawn("postgres", [
      `-D`,
      `.`,
      `-k`,
      `.`,
      `-p`,
      `${port}`,
      `-c`,
      `listen-addresses=`,
    ], {
      cwd: pgCwd,
      stdio: ["ignore", "ignore", "inherit"],
    });

    postgres.on("error", (err) => {
      throw err;
    });

    try {
      // Wait until postgres is ready (do a little backoff)
      const RETRY_TIME_MULTIPLIER = 1000;

      let i = 0;
      const MAX_RETRIES = 5;

      while (i < MAX_RETRIES) {
        await setTimeout(1000 + i * RETRY_TIME_MULTIPLIER);

        // Check if the database we just spawned is ready, and tell it  a
        // database name is `postgres` (a database which actually exists)
        const pg_isready = spawn(
          "pg_isready",
          [`-h`, pgCwd, `-d`, `postgres`],
          { cwd: pgCwd, stdio: ["ignore", 2, "inherit"] },
        );
        const good = await new Promise((resolve, _reject) => {
          pg_isready.on(`close`, (code) => {
            if (code === 0) {
              resolve(true);
            } else {
              resolve(false);
            }
          });
        });

        if (good) break;

        ++i;
        console.error(
          `pg_isready found postgres to not be ready trying again after ${RETRY_TIME_MULTIPLIER}ms`,
        );
      }

      if (i >= MAX_RETRIES) {
        throw new Error(
          `pg_isready with host ${pgCwd} never found postgres to be ready`,
        );
      }
      // RUN THE TEST HERE
      await assertion(pgCwd, port);
    } finally {
      // always kill postgres
      await new Promise((resolve, reject) => {
        postgres.on("close", (code, signal) => {
          if (signal === "SIGTERM") {
            return resolve(true);
          } else if (code === 0) {
            return resolve(true);
          } else {
            reject(code);
          }
        });
        postgres.kill(`SIGTERM`); // see [3] for how postgres handles this
      });
    }
  } catch (err) {
    console.error(
      `withPgTest: Test failed. Keeping data directory: \`${pgCwd}\``,
    );
    throw err;
  }
  // Only remove the temp directory if everything succeeded (we otherwise leave
  // the temporary directory for debugging)
  await fs.rm(pgCwd, { force: true, recursive: true });
}

/**
 * Given a database from {@link withPgTest}, create a user (with the empty
 * password) and database from the provided parameters.
 *
 * @private
 * Internally, this creates a user with
 * ```
 * createuser -h <HOST> -p <PORT> -d -r <USER>
 * ```
 * where `-d` and `-r` allow the `<USER>` to create databases and roles
 * and creates the DB with
 * ```
 * createdb -h <HOST> -p <PORT> -O <USER> <DATABASE>
 * ```
 * where `-O` tells postgres that the user we just created is the owner of this
 * database.
 */
export async function pgCreateUserAndDb(
  host: string,
  port: number,
  user: string,
  database: string,
): Promise<void> {
  // Create the user
  {
    const createuser = spawn("createuser", [
      `-h`,
      host,
      `-p`,
      `${port}`,
      `-d`,
      `-r`,
      user,
    ], { stdio: ["ignore", "ignore", "inherit"] });

    // await new Promise createuser.on
    await new Promise((resolve, reject) => {
      createuser.on("close", (code) => {
        if (code === 0) {
          resolve(code);
        } else {
          reject(new Error(`createuser failed with exit code ${code}`));
        }
      });
    });
  }

  // Create the database
  {
    const createdb = spawn("createdb", [
      `-h`,
      host,
      `-p`,
      `${port}`,
      `-O`,
      user,
      database,
    ], { stdio: ["ignore", "ignore", "inherit"] });

    await new Promise((resolve, reject) => {
      createdb.on("close", (code) => {
        if (code === 0) {
          resolve(code);
        } else {
          reject(new Error(`createdb failed with exit code ${code}`));
        }
      });
    });
  }
}
