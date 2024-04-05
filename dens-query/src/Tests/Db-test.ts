// This file includes tests which go back and forth from the backing db
// postgres to dens-query
// import { describe, it } from "node:test";
import { it } from "node:test";
// import * as assert from "node:assert/strict";
import * as DbTestUtils from "./DbTestUtils.js";
import * as Db from "../DensQuery/Db.js";

import * as fc from "fast-check";

// Set some default global settings for fast-check
// Remarks:
//  - We keep the tests low (because spinning up a DB is expensive)
//
//  - We immediately end on failure because it'll take too long for fast-check
//    to shrink and find a small counter example.
fc.configureGlobal({ numRuns: 5, endOnFailure: true });

// NOTE(jaredponn): Why aren't we doing top level `describe`s?
//
// Top level `describe`s don't allow us to "await" on something before we run
// all the `it` (tests) so we can NOT:
//
// - Initialize the DB
//
// - Run all tests.
//
// So, we settle for doing a top level `it` instead.
//
// See {@link https://github.com/nodejs/node-core-test/issues/49} for details

it("Database basic tests", async () => {
  await DbTestUtils.withPgTest(async (host, port) => {
    await DbTestUtils.pgCreateUserAndDb(host, port, `dens`, `dens`);

    const db: Db.DensDb = new Db.DensDb({
      host: host,
      port: port,
      user: "dens",
      database: `dens`,
      password: undefined,
    });

    try {
      await it(`Database initialization`, async () => {
        await db.init();
      });

      await it(`Database insertion hard coded`, async () => {
        await db.insertDensSetRow(
          {
            name: DbTestUtils.sampleName,
            slot: DbTestUtils.sampleSlot,
            currency_symbol: DbTestUtils.sampleCurrencySymbol,
            token_name: DbTestUtils.sampleTokenName,
            tx_out_ref: DbTestUtils.sampleTxOutRef,
          },
        );
      });
    } finally {
      await db.end();
    }
  });
});
