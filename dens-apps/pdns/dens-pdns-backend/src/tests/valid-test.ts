import * as test from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import { Postgres } from "./postgres.js";

/**
 * Getting a database up and running.
 * If the environment variable `PGHOST` is already defined, it will assume that
 * the user has provided the database setup which _must_ include setting the
 * following environment variables:
 *
 * - `PGHOST`
 * - `PGUSER`
 * - `PGPASSWORD`
 * - `PGDATABASE`
 *
 * Otherwise, this will start a fresh database automatically, and point the
 * tests to this database.
 */

let postgres: Postgres | undefined = undefined;

if (process.env["PGHOST"] === undefined) {
  postgres = await Postgres.new();
  const username = `dens`;
  const database = `dens`;
  await postgres.createUser(username);
  await postgres!.createDb(username, database);

  process.env["PGHOST"] = postgres.unixSocketDirectory;
  process.env["PGUSER"] = username;
  process.env["PGPASSWORD"] = ``;
  process.env["PGDATABASE"] = database;
}

// WARNING(jaredponn): it's important that we do this _before_ importing the
// `../lib/postgres.ts` module as that looks at the environment variables to
// see what to connect to.
import { default as pool } from "../lib/postgres.js";
import * as db from "../lib/postgres.js";

/**
 * The actual test suite
 */
await test.describe(`Basic querying tests`, async (_context) => {
  await test.test(`Database information`, async (t) => {
    if (postgres === undefined) {
      t.diagnostic(`Using provided database from the environment`);
    } else {
      t.diagnostic(`Spawned a new Postgres cluster.`);
      postgres!.databaseDirectoryInfo().split(/\r?\n/).map((line) =>
        t.diagnostic(line)
      );

      t.diagnostic(`Running the dens-query-postgres-schema...`);

      if (process.env["DENS_QUERY_POSTGRES_SCHEMA"] === undefined) {
        throw new Error(
          `Environment variable \`DENS_QUERY_POSTGRES_SCHEMA\` is undefined. Expected it to be the filepath to the Postgres schema that dens-query uses.`,
        );
      }

      const sql = await fs.readFile(
        process.env["DENS_QUERY_POSTGRES_SCHEMA"],
        "utf8",
      );
      await pool.query(sql);
    }
  });

  await test.test(`No RRs inserted ==> there should be no RRs to return`, async (_t) => {
    const result = await db.queryLookup(`A`, `.`, -1);
    assert.deepStrictEqual(result, []);
  });

  await test.after(async () => {
    await pool.end();
    postgres!.kill();
  });
});
