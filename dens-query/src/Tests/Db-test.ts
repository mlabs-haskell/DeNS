// This file includes tests which go back and forth from the backing db
// postgres to dens-query
import { it } from "node:test";
import * as assert from "node:assert/strict";
import * as DbTestUtils from "./DbTestUtils.js";
import * as Samples from "./Samples.js";
import * as Prelude from "prelude";
import * as Db from "../DensQuery/Db.js";
import * as PlaV1 from "plutus-ledger-api/V1.js";

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
    const user = `dens`;
    const database = `dens`;
    await DbTestUtils.pgCreateUserAndDb(host, port, user, database);

    /*
     * Create the database
     */
    const db: Db.DensDb = new Db.DensDb({
      host,
      port: BigInt(port),
      database,
      user,
      password: ``,
    });

    /*
     * Running the tests
     */
    try {
      await it(`Database initialization`, async () => {
        await db.densInit(`./api/postgres/dens.sql`);
      });

      await db.densWithDbClient(async (client) => {
        const freshPoint = Samples.fcGenerate(Samples.fcPoint());
        await it(`Adding a point (block)`, async () => {
          await client.insertPoint(freshPoint);
        });

        await it(`Adding and deleting a UTxO `, async () => {
          const myUtxo = Samples.fcGenerate(Samples.fcTxOutRef());
          await client.insertTxOutRef(
            freshPoint,
            myUtxo,
          );
          await client.deleteTxOutRef(
            myUtxo,
          );
        });

        const protocolUtxo = Samples.fcGenerate(Samples.fcTxOutRef());
        await it(`Adding a UTxO `, async () => {
          await client.insertTxOutRef(
            freshPoint,
            protocolUtxo,
          );
        });

        const protocol = Samples.sampleProtocol;
        await it(`Inserting the Protocol NFT UTxO`, async () => {
          await client.insertProtocol(
            { txOutRef: protocolUtxo, protocol },
          );
        });

        await it(`Select the Protocol NFT UTxO`, async () => {
          const selectedProtocol = await client.selectProtocol();
          assert.deepStrictEqual(
            selectedProtocol,
            protocol,
            `Selected protocol doesn't match the inserted protocol`,
          );
        });

        const emptySetElem = {
          name: Uint8Array.from([]),
          pointer: Samples.fcGenerate(Samples.fcAssetClass()),
          txOutRef: Samples.fcGenerate(Samples.fcTxOutRef()),
        };
        await it(`Inserting the empty DeNS set UTxO ${emptySetElem.name}`, async () => {
          await client.insertTxOutRef(
            freshPoint,
            emptySetElem.txOutRef,
          );

          await client.insertDensSetUtxo(
            [[
              Prelude.fromJust(
                PlaV1.currencySymbolFromBytes(protocol.setElemMintingPolicy),
              ),
              PlaV1.adaToken,
            ]],
            emptySetElem,
          );
        });

        const taylorSwiftDotComSetElem = {
          name: Samples.sampleNameTaylorSwiftDotCom,
          pointer: Samples.fcGenerate(Samples.fcAssetClass()),
          txOutRef: Samples.fcGenerate(Samples.fcTxOutRef()),
        };
        await it(`Inserting the taylorswift.com DeNS set UTxO ${taylorSwiftDotComSetElem.name}`, async () => {
          await client.insertTxOutRef(
            freshPoint,
            taylorSwiftDotComSetElem.txOutRef,
          );

          await client.insertDensSetUtxo(
            [[
              Prelude.fromJust(
                PlaV1.currencySymbolFromBytes(protocol.setElemMintingPolicy),
              ),
              PlaV1.adaToken,
            ]],
            taylorSwiftDotComSetElem,
          );
        });

        await it(`Select strict infimum for ${taylorSwiftDotComSetElem.name}`, async () => {
          const res = await client.selectStrictInfimumDensSetUtxo(
            taylorSwiftDotComSetElem.name,
          );
          assert.deepStrictEqual(
            emptySetElem.name,
            res?.name,
            `Expected empty element`,
          );
        });

        const googleDotComSetElem = {
          name: Samples.sampleNameGoogleDotCom,
          pointer: Samples.fcGenerate(Samples.fcAssetClass()),
          txOutRef: Samples.fcGenerate(Samples.fcTxOutRef()),
        };
        await it(`Inserting the google.com DeNS set UTxO ${googleDotComSetElem.name}`, async () => {
          await client.insertTxOutRef(
            freshPoint,
            googleDotComSetElem.txOutRef,
          );

          await client.insertDensSetUtxo(
            [[
              Prelude.fromJust(
                PlaV1.currencySymbolFromBytes(protocol.setElemMintingPolicy),
              ),
              PlaV1.adaToken,
            ]],
            googleDotComSetElem,
          );
        });

        await it(`Select strict infimum for ${taylorSwiftDotComSetElem.name}`, async () => {
          const res = await client.selectStrictInfimumDensSetUtxo(
            taylorSwiftDotComSetElem.name,
          );
          assert.deepStrictEqual(
            res?.name,
            googleDotComSetElem.name,
            `Expected google.com element`,
          );
        });

        const taylorSwiftDotComRrsUtxo1 = Samples.fcGenerate(
          Samples.fcTxOutRef(),
        );
        const taylorSwiftDotComRrsUtxo2 = Samples.fcGenerate(
          Samples.fcTxOutRef(),
        );
        await it(`Adding rrs to taylorswift.com`, async () => {
          // Insert the first RR
          await client.insertTxOutRef(freshPoint, taylorSwiftDotComRrsUtxo1);

          const taylorSwiftRrs1 = {
            name: taylorSwiftDotComSetElem.name,
            rrs: Samples.fcGenerate(Samples.fcRrs()),
            txOutRef: taylorSwiftDotComRrsUtxo1,
          };
          await client.insertDensRrsUtxo(
            [taylorSwiftDotComSetElem.pointer],
            taylorSwiftRrs1,
          );
          const res1 = await client.selectNamesRrs(
            taylorSwiftDotComSetElem.name,
          );
          assert.deepStrictEqual(res1, [taylorSwiftRrs1.rrs]);

          // Insert the second RR

          await client.insertTxOutRef(freshPoint, taylorSwiftDotComRrsUtxo2);

          const taylorSwiftRrs2 = {
            name: taylorSwiftDotComSetElem.name,
            rrs: Samples.fcGenerate(Samples.fcRrs()),
            txOutRef: taylorSwiftDotComRrsUtxo2,
          };
          await client.insertDensRrsUtxo(
            [taylorSwiftDotComSetElem.pointer],
            taylorSwiftRrs2,
          );
          const res2 = await client.selectNamesRrs(
            taylorSwiftDotComSetElem.name,
          );
          assert.deepStrictEqual(
            res2.sort(),
            [taylorSwiftRrs1.rrs, taylorSwiftRrs2.rrs].sort(),
          );
        });

        await it(`Adding another point (block)`, async () => {
          await client.insertPoint(Samples.fcGenerate(Samples.fcPoint()));
        });

        await it(`Deleting all points strictly after the first block`, async () => {
          await client.deletePointsStrictlyAfter(freshPoint);
        });

        await it(`Select strict infimum for ${taylorSwiftDotComSetElem.name}`, async () => {
          const res = await client.selectStrictInfimumDensSetUtxo(
            taylorSwiftDotComSetElem.name,
          );
          assert.deepStrictEqual(
            res?.name,
            googleDotComSetElem.name,
            `Expected google.com element`,
          );
        });

        await it(`Deleting all points`, async () => {
          await client.deleteAllPoints();
        });
      });
    } finally {
      await db.end();
    }
  });
});
