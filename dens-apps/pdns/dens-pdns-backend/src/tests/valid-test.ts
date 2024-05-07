// Test imports
import { postgres, serverSocketPath } from "./dev-env.js";
import { mkPdnsConf, Pdns } from "./pdns.js";
import * as gen from "./gen.js";

// Project imports
import { server } from "../lib/index.js";
import { default as pool } from "../lib/postgres.js";
import * as db from "../lib/postgres.js";

// Node imports
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

  const block = gen.nextBlock();

  const taylorSwiftDotComNameUtxo = gen.freshTxOutRef();
  const taylorSwiftDotComElemIdUtxo = gen.freshTxOutRef();
  const taylorSwiftDotComName: Buffer = Buffer.from(`taylorswift.com`);
  const taylorSwiftDotComAssetClassPointer: [Buffer, Buffer] = [
    gen.freshCurrencySymbol(),
    gen.freshTokenName(),
  ];
  const taylorSwiftDotComARr: {
    qtype: string;
    qname: string;
    content: string;
    ttl: number;
  } = {
    qtype: `A`,
    qname: taylorSwiftDotComName.toString(),
    content: `45.60.107.223`,
    ttl: 3000,
  };
  const taylorSwiftDotComSoaRr: {
    qtype: string;
    qname: string;
    content: string;
    ttl: number;
  } = {
    qtype: `SOA`,
    qname: taylorSwiftDotComName.toString(),
    content:
      `ns-1139.awsdns-14.org. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400`,
    ttl: 3000,
  };

  await test.test(`Adding data`, async (t) => {
    t.diagnostic(`Adding block..`);
    await pool.query(
      `INSERT INTO blocks(block_slot, block_id) VALUES($1, $2)`,
      [block.blockSlot, block.blockId],
    );
    t.diagnostic(`Adding tx out refs..`);
    await pool.query(
      `INSERT INTO tx_out_refs(tx_out_ref_id, tx_out_ref_idx, block_slot, block_id) VALUES($1, $2, $3, $4)`,
      [
        taylorSwiftDotComNameUtxo.txOutRefId,
        taylorSwiftDotComNameUtxo.txOutRefIdx,
        block.blockSlot,
        block.blockId,
      ],
    );
    await pool.query(
      `INSERT INTO tx_out_refs(tx_out_ref_id, tx_out_ref_idx, block_slot, block_id) VALUES($1, $2, $3, $4)`,
      [
        taylorSwiftDotComElemIdUtxo.txOutRefId,
        taylorSwiftDotComElemIdUtxo.txOutRefIdx,
        block.blockSlot,
        block.blockId,
      ],
    );

    t.diagnostic(`Adding set element taylorswift.com..`);
    await pool.query(
      `INSERT INTO dens_set_utxos(name, pointer, tx_out_ref_id, tx_out_ref_idx) VALUES($1, CAST(ROW($2, $3) AS asset_class), $4, $5)`,
      [
        taylorSwiftDotComName,
        taylorSwiftDotComAssetClassPointer[0],
        taylorSwiftDotComAssetClassPointer[1],
        taylorSwiftDotComNameUtxo.txOutRefId,
        taylorSwiftDotComNameUtxo.txOutRefIdx,
      ],
    );

    t.diagnostic(`Adding the ElemID for taylorswift.com.`);
    await pool.query(
      `INSERT INTO dens_elem_ids(tx_out_ref_id, tx_out_ref_idx, asset_class) VALUES($1, $2, CAST(ROW($3, $4) AS asset_class))`,
      [
        taylorSwiftDotComElemIdUtxo.txOutRefId,
        taylorSwiftDotComElemIdUtxo.txOutRefIdx,
        taylorSwiftDotComAssetClassPointer[0],
        taylorSwiftDotComAssetClassPointer[1],
      ],
    );

    t.diagnostic(`Adding A record and SOA record for taylorswift.com`);
    await pool.query(
      `INSERT INTO dens_rrs(type, ttl, content, dens_elem_id) ` +
        `SELECT $1, $2, $3, id FROM dens_elem_ids WHERE tx_out_ref_id = $4 AND tx_out_ref_idx = $5`,
      [
        taylorSwiftDotComARr.qtype,
        taylorSwiftDotComARr.ttl,
        taylorSwiftDotComARr.content,
        taylorSwiftDotComElemIdUtxo.txOutRefId,
        taylorSwiftDotComElemIdUtxo.txOutRefIdx,
      ],
    );
    await pool.query(
      `INSERT INTO dens_rrs(type, ttl, content, dens_elem_id) ` +
        `SELECT $1, $2, $3, id FROM dens_elem_ids WHERE tx_out_ref_id = $4 AND tx_out_ref_idx = $5`,
      [
        taylorSwiftDotComSoaRr.qtype,
        taylorSwiftDotComSoaRr.ttl,
        taylorSwiftDotComSoaRr.content,
        taylorSwiftDotComElemIdUtxo.txOutRefId,
        taylorSwiftDotComElemIdUtxo.txOutRefIdx,
      ],
    );
  });

  await test.test(`Looking up the SOA RR should return the same SOA RR`, async (_t) => {
    const result = await db.queryLookup(`SOA`, `taylorswift.com`, -1);
    assert.deepStrictEqual(
      result.map((row) => (delete (row as Partial<typeof row>).domain_id, row)),
      [taylorSwiftDotComSoaRr],
    );
  });

  await test.test(`Looking up A RR for taylorswift.com should work`, async (_t) => {
    const result = await resolver!.resolve4(`taylorswift.com`);
    assert.deepStrictEqual(result, [taylorSwiftDotComARr.content]);
  });
});
