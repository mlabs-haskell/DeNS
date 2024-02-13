// Some utility functions for testing the database.
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
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
 * 3. Run `postgres -D . -k . -p 5432 -c listen-addresses=` to actually start a
 *    new pg db (see [2], [3], [4])
 * References:
 *  [1]: https://www.postgresql.org/docs/current/app-initdb.html
 *  [2]: https://www.postgresql.org/docs/current/app-pg-ctl.html
 *  [3]: https://www.postgresql.org/docs/current/app-postgres.html
 *  [4]: https://www.postgresql.org/docs/current/runtime-config-connection.html
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

  const postgresAbortController = new AbortController();

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
      signal: postgresAbortController.signal,
      killSignal: "SIGTERM", // See [3] for how postgres handles this
    });

    // Ignore if we abort postgres with our `postgresAbortController`
    postgres.on("error", (err) => {
      if (err.name === "AbortError") {
        return;
      } else {
        throw err;
      }
    });

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
          `pg_isready found postgres to not be ready trying again after ${RETRY_TIME_MULTIPLIER}ms`,
        );
      }

      if (i >= MAX_RETRIES) {
        throw new Error(`pg_isready never found postgres to be ready`);
      }
      // RUN THE TEST HERE
      await assertion(pgCwd, port);
    } finally {
      // always kill postgres
      postgresAbortController.abort();

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
