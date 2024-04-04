/**
 * This file includes tests which check that a simplified model of some
 * interactions agree with what the database is doing.
 *
 * In particular, we are testing the strict infimum calculation.
 *
 * TODO(jaredponn): we really can do full property based testing of all aspects
 * of the system, but this would require significantly beefing up the data
 * structures in prelude.
 *
 * Most of the code is heavily based off the documentation in [1].
 *
 * As a commutative diagram, we're testing if
 *
 * ```
 *  Model ---command---> Model'
 *   |                    |
 *  eq                    eq
 *   |                    |
 *  Db    ---command---> Db'
 * ```
 * References:
 * [1]: https://fast-check.dev/docs/advanced/model-based-testing/
 */

import { it } from "node:test";
import * as assert from "node:assert/strict";
import * as DbTestUtils from "./DbTestUtils.js";
import * as Samples from "./Samples.js";
import * as Db from "../DensQuery/Db.js";
import * as PlaV1 from "plutus-ledger-api/V1.js";

import * as Prelude from "prelude";
import * as PMap from "prelude/Map.js";

import * as fc from "fast-check";

// This is needed to print `bigint`s for the debugging messages.

// deno-lint-ignore no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Set some default global settings for fast-check
// Remarks:
//  - We keep the tests low (because spinning up a DB is expensive)
//
//  - We immediately end on failure because it'll take too long for fast-check
//    to shrink and find a small counter example.
fc.configureGlobal({ numRuns: 5, endOnFailure: true });

type Model = {
  densSetRows: PMap.Map<Uint8Array, Db.DensSetUtxo>;
};

/**
 * A command for {@link insertDensSetUtxo}
 */
class InsertDensSetUtxoCommand implements fc.AsyncCommand<Model, Db.DensDb> {
  #densSetRow: Db.DensSetUtxo;
  #point: Db.Point;

  constructor(point: Db.Point, densSetRow: Db.DensSetUtxo) {
    this.#densSetRow = densSetRow;
    this.#point = point;
  }

  // Only insert if this is not already an element
  check(m: Readonly<Model>): boolean {
    return PMap.lookup(Prelude.ordBytes, this.#densSetRow.name, m.densSetRows)
      .name !== "Nothing";
  }

  async run(m: Model, r: Db.DensDb): Promise<void> {
    PMap.insert(
      Prelude.ordBytes,
      this.#densSetRow.name,
      this.#densSetRow,
      m.densSetRows,
    );

    await r.densWithDbClient(async (client) => {
      const selectedProtocol = await client.selectProtocol();
      if (selectedProtocol === undefined) {
        throw new Error(`Protocol is undefined`);
      }

      await client.insertPoint(this.#point);
      await client.insertTxOutRef(this.#densSetRow.txOutRef);
      await client.insertDensSetUtxo(
        [[
          Prelude.fromJust(
            PlaV1.currencySymbolFromBytes(
              selectedProtocol.setElemMintingPolicy,
            ),
          ),
          PlaV1.adaToken,
        ]],
        this.#densSetRow,
      );
    });
  }

  toString() {
    return `insertDensSetUtxo(${JSON.stringify(this.#densSetRow)})`;
  }
}

/**
 * A command for {@link strictInfimumDensSetUtxo}
 */
class StrictInfimumDensSetUtxoCommand implements fc.Command<Model, Db.DensDb> {
  #name: Uint8Array;
  constructor(name: Uint8Array) {
    this.#name = name;
  }

  check(_m: Readonly<Model>): boolean {
    return true;
  }

  async run(m: Model, r: Db.DensDb): Promise<void> {
    const mV = PMap.lookupLT(Prelude.ordBytes, this.#name, m.densSetRows);

    await r.densWithDbClient(async (client) => {
      const rV = await client.selectStrictInfimumDensSetUtxo(this.#name);

      assert.deepStrictEqual(rV, mV.name === "Just" ? mV.fields : undefined);
    });
  }

  toString() {
    return `strictInfimumDensSetUtxo(${JSON.stringify(this.#name)})`;
  }
}

it(`Database model tests`, async () => {
  await DbTestUtils.withPgTest(async (host, port) => {
    const db: Db.DensDb = new Db.DensDb({
      host: host,
      port: BigInt(port),
      user: "dens",
      database: `dens`,
      password: ``,
    });
    try {
      await DbTestUtils.pgCreateUserAndDb(host, port, `dens`, `dens`);

      const allCommands = [
        fc.tuple(Samples.fcPoint(), Samples.fcDensSetUtxo()).map((
          [point, densSetRow],
        ) => new InsertDensSetUtxoCommand(point, densSetRow)),
        Samples.fcName().map((name) =>
          new StrictInfimumDensSetUtxoCommand(name)
        ),
      ];

      await fc.assert(
        fc.asyncProperty(
          fc.commands(allCommands, { maxCommands: 4096, size: "max" }),
          async (cmds) => {
            async function s() {
              const model: Model = { densSetRows: new PMap.Map() };

              const real = db;

              await real.query("DROP OWNED BY dens CASCADE");
              await db.densInit(`./api/postgres/dens.sql`);

              // Add the protocol UTxO
              await real.densWithDbClient(async (client) => {
                const freshPoint = Samples.fcGenerate(Samples.fcPoint());
                const protocolUtxo = Samples.fcGenerate(Samples.fcTxOutRef());

                await client.insertPoint(freshPoint);
                await client.insertTxOutRef(
                  protocolUtxo,
                );

                await client.insertProtocol(
                  { txOutRef: protocolUtxo, protocol: Samples.sampleProtocol },
                );
              });

              return { model, real };
            }

            await fc.asyncModelRun(s, cmds);
          },
        ),
      );
    } finally {
      await db.end();
    }
  });
});
