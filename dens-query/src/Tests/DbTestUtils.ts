// Some utility functions for testing the database.
import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import process from "node:process";
import { join } from "node:path";
import { setTimeout } from "timers/promises";

import * as fc from "fast-check";
import * as PlaV1 from "plutus-ledger-api/V1.js";
import type {
  CurrencySymbol,
  TokenName,
  TxOutRef,
} from "plutus-ledger-api/V1.js";
import * as Db from "../DensQuery/Db.js";

/**
 * Runs a test with a postgres database
 *
 * @private
 * Here's what's going on:
 * 1. Go in a temporary directory
 * 2. Run `initdb -D .` to create a postgres db cluster (see [1])
 * 3. Run `pg_ctl -D . -l logfile.txt -o '-k . -p 5432 --listen-addresses="" ' start` to
 *    actually start a new pg db (see [2] and [3])
 * 4. Run `pg_ctl -D . stop` to kill the database
 * References:
 *  [1]: https://www.postgresql.org/docs/current/app-initdb.html
 *  [2]: https://www.postgresql.org/docs/current/app-pg-ctl.html
 *  [3]: https://www.postgresql.org/docs/current/runtime-config-connection.html
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

  // `pg_ctl_stop` is the process to kill postgres
  let pg_ctl_stop: null | ChildProcess = null;

  /**
   * {@link spawnPgCtlStop} does 4.
   */
  async function spawnPgCtlStop() {
    if (pg_ctl_stop !== null) {
      return;
    }

    pg_ctl_stop = spawn("pg_ctl", [`-D`, `.`, `stop`], { cwd: pgCwd });

    pg_ctl_stop!.stderr!.on(`data`, (err) => {
      console.error(err.toString());
    });

    await new Promise((resolve, reject) => {
      pg_ctl_stop!.on(`close`, (code) => {
        if (code === 0) {
          resolve(code);
        } else {
          reject(new Error(`pg_ctl stop failed with exit code ${code}`));
        }
      });
    });

    return;
  }

  async function sigIntSpawnPgCtlStopListener() {
    await spawnPgCtlStop();
    process.exit(1);
  }

  try {
    // 2.
    {
      const initdb = spawn("initdb", [`-D`, `.`], { cwd: pgCwd });

      // log stderr
      initdb.stderr.on(`data`, (err) => {
        console.error(err.toString());
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

    // NOTE(jaredponn): we'd like to unconditionally cleanup the db instance we
    // just opened up EVEN if we close form a signal -- hence the following.
    // In particular, we do the cleanup when giving SIGINT (and unfortunately
    // ignore the other signals!)
    //
    // Also, why are we setting this up _before_ we actually initialize the db?
    // This is because of some atomicity of sending signals e.g. if we put this
    // after, there's nothing really stopping the signal being sent AFTER the
    // db is initialized but BEFORE the signal handler is registered. Note that
    // this permits "freeing" before allocating, but `pg_ctl` is smart enough
    // to not mess up too horribly if this is the case.
    //
    // TODO(jaredponn): actually I think this is completely broken and doesn't
    // work, and nodejs completely ignores these handlers when given SIGINT
    // (contrary to the documentation)? This needs more investigation..
    //
    // Also, this "unconditional cleanup" task isn't that easy to do in NodeJS
    // in general -- see the discussion here:
    // https://github.com/orgs/nodejs/discussions/29480

    process.on("SIGINT", sigIntSpawnPgCtlStopListener);

    // 3.
    {
      // TODO(jaredponn): we don't include the logfile here.. maybe we
      // should -- it would be helpful for debugging.
      const pg_ctl_start = spawn("pg_ctl", [
        `-D`,
        `.`,
        `-o`,
        `-k . -p ${port} --listen-addresses=`,
        `-l logfile.txt`,
        `start`,
      ], { cwd: pgCwd });

      pg_ctl_start.stderr.on(`data`, (err) => {
        console.error(err.toString());
      });
    }

    try {
      // Wait until postgres is ready (do a little backoff)
      const RETRY_TIME_MULTIPLIER = 1000;

      let i = 0;
      const MAX_RETRIES = 5;

      while (i < MAX_RETRIES) {
        await setTimeout(1000 + i * RETRY_TIME_MULTIPLIER);

        const pg_isready = spawn("pg_isready", [`-h`, pgCwd], { cwd: pgCwd });

        pg_isready.stdout.on(`data`, (buf) => {
          console.error(`pg_isready: ${buf.toString()}`);
        });

        pg_isready.stderr.on(`data`, (buf) => {
          console.error(`pg_isready: ${buf.toString()}`);
        });

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
          `pg_isready found pg_ctl to not be ready trying again after ${RETRY_TIME_MULTIPLIER}ms`,
        );
      }

      if (i >= MAX_RETRIES) {
        throw new Error(`pg_isready never found pg_ctl to be ready`);
      }

      // RUN THE TEST HERE
      await assertion(pgCwd, port);
    } finally {
      // 3. always kill postgres
      await spawnPgCtlStop();

      process.off("SIGINT", sigIntSpawnPgCtlStopListener);
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
 * createdb -h <HOST> -p <PORT> -O <NAME> <DATABASE>
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
    ]);

    createuser.stderr.on(`data`, (err) => {
      console.error(err.toString());
    });

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
    ]);

    createdb.stderr.on(`data`, (err) => {
      console.error(err.toString());
    });

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

/**
 * Hardcoded sample data
 */
export const sampleName: Uint8Array = (() => {
  return Uint8Array.from([
    116,
    97,
    121,
    108,
    111,
    114,
    115,
    119,
    105,
    102,
    116,
    46,
    99,
    111,
    109,
  ]);
})();

/**
 * Hardcoded sample data
 */
export const sampleSlot = 69n;

/**
 * Hardcoded sample data
 */
export const sampleCurrencySymbol: CurrencySymbol = (() => {
  const arr = [];
  for (let i = 0; i < 28; ++i) {
    arr.push(i);
  }
  const mcs = PlaV1.currencySymbolFromBytes(Uint8Array.from(arr));
  if (mcs.name === `Just`) {
    return mcs.fields;
  } else {
    throw new Error(`Invalid sampleCurrencySymbol`);
  }
})();

/**
 * Hardcoded sample data
 */
export const sampleTokenName: TokenName = (() => {
  const arr = [];
  for (let i = 0; i < 32; ++i) {
    arr.push(i);
  }
  const mtn = PlaV1.tokenNameFromBytes(Uint8Array.from(arr));
  if (mtn.name === `Just`) {
    return mtn.fields;
  } else {
    throw new Error(`Invalid sampleTokenName`);
  }
})();

/**
 * Hardcoded sample data
 */
export const sampleTxOutRef: TxOutRef = (() => {
  const arr = [];
  for (let i = 0; i < 32; ++i) {
    arr.push(i);
  }
  const mtxId = PlaV1.txIdFromBytes(Uint8Array.from(arr));
  if (mtxId.name === `Just`) {
    return { txOutRefId: mtxId.fields, txOutRefIdx: 420n };
  } else {
    throw new Error(`Invalid sampleTxOutRef`);
  }
})();

/**
 * Generator for an arbitrary domain name
 */
export function fcName(): fc.Arbitrary<Uint8Array> {
  return fc.uint8Array({ min: 0, max: 255, minLength: 0, maxLength: 255 });
}

/**
 * Generator for an arbitrary slot
 */
export function fcSlot(): fc.Arbitrary<bigint> {
  return fc.bigInt(
    { min: 0n, max: (1n << 63n) - 1n },
  );
}

/**
 * Generator for an arbitrary {@link CurrencySymbol}
 */
export function fcCurrencySymbol(): fc.Arbitrary<CurrencySymbol> {
  return fc.oneof(
    fc.constant(Uint8Array.from([])),
    fc.uint8Array({ min: 0, max: 255, minLength: 28, maxLength: 28 }),
  )
    .map((bytes) => {
      const mCurrencySymbol = PlaV1.currencySymbolFromBytes(bytes);
      if (mCurrencySymbol.name === "Just") {
        return mCurrencySymbol.fields;
      } else {
        throw new Error(`Invalid generated CurrencySymbol`);
      }
    });
}

/**
 * Generator for an arbitrary {@link TokenName}
 */
export function fcTokenName(): fc.Arbitrary<TokenName> {
  return fc.uint8Array({ min: 0, max: 255, minLength: 0, maxLength: 32 })
    .map((bytes) => {
      const mTokenName = PlaV1.tokenNameFromBytes(bytes);
      if (mTokenName.name === "Just") {
        return mTokenName.fields;
      } else {
        throw new Error(`Invalid generated TokenName`);
      }
    });
}

/**
 * Generator for an arbitrary {@link TxOutRef}
 */
export function fcTxOutRef(): fc.Arbitrary<TxOutRef> {
  return fc.record(
    {
      txOutRefId: fc.uint8Array({
        min: 0,
        max: 255,
        minLength: 32,
        maxLength: 32,
      }).map((bytes) => {
        const mTxId = PlaV1.txIdFromBytes(bytes);
        if (mTxId.name === "Just") {
          return mTxId.fields;
        } else {
          throw new Error(`Invalid generated TxId`);
        }
      }),
      txOutRefIdx: fc.bigInt(
        { min: 0n, max: (1n << 63n) - 1n },
      ),
    },
  );
}

export function fcDensSetRow(): fc.Arbitrary<Db.DensSetRow> {
  return fc.record(
    {
      name: fcName(),
      slot: fcSlot(),
      currency_symbol: fcCurrencySymbol(),
      token_name: fcTokenName(),
      tx_out_ref: fcTxOutRef(),
    },
  );
}
