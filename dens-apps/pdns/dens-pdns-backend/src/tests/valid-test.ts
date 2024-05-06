import { postgres, serverSocketPath } from "./dev-env.js";
import { server } from "../lib/index.js";
import { default as pool } from "../lib/postgres.js";
import * as db from "../lib/postgres.js";

import { mkPdnsConf, Pdns } from "./pdns.js";

import * as test from "node:test";
import * as fs from "node:fs/promises";
import * as assert from "node:assert";
import * as dns from "node:dns/promises";

/**
 * The actual test suite
 */
await test.describe(`Basic querying tests`, async (_context) => {
  let pdns: undefined | Pdns = undefined;
  let resolver: undefined | dns.Resolver = undefined;
  resolver;

  await test.after(async () => {
    await pool.end();
    postgres!.kill();
    pdns!.kill();
    server.close();
  });

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

  await test.test(`Powerdns information`, async (t) => {
    pdns = await Pdns.new({
      pdnsConf: mkPdnsConf({
        remoteConnectionString: `unix:path=${serverSocketPath}`,
      }),
    });

    pdns!.pdnsInfo().split(/\r?\n/).map((line) => t.diagnostic(line));

    resolver = new dns.Resolver();
    resolver!.setServers([`127.0.0.1:${pdns!.localPort}`]);
  });

  await test.test(`No RRs inserted ==> there SQL query shouldn't return any RRs`, async (_t) => {
    const result = await db.queryLookup(`A`, `.`, -1);
    assert.deepStrictEqual(result, []);
  });

  await test.test(`No RRs inserted ==> DNS lookup should fail`, async (_t) => {
    try {
      await resolver!.resolve4(`taylorswift.com.`);
      throw new Error(`Bad DNS lookup`);
    } catch (err) {
      if (
        err !== null && typeof err === "object" && `code` in err &&
        err?.code === dns.REFUSED
      ) {
        return;
      }
      throw err;
    }
  });
});
