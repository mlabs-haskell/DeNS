/**
 * Functionality for interacting with the database
 */
import pg from "pg";
import type { QueryConfig, QueryResult } from "pg";
import { DbConfig } from "lbf-dens-db/LambdaBuffers/Dens/Config.mjs";
import { logger } from "./Logger.js";
import * as net from "node:net";
import * as fs from "node:fs/promises";
import {
  DensProtocolUtxo,
  DensRr,
  DensRrsUtxo,
  DensSetUtxo,
  Point,
  Protocol,
} from "lbf-dens-db/LambdaBuffers/Dens/Db.mjs";
import {
  CurrencySymbol,
  TokenName,
  TxId,
  TxOutRef,
} from "plutus-ledger-api/V1.js";
import * as PlaV1 from "plutus-ledger-api/V1.js";
import * as Prelude from "prelude";

// Reexport things from LB
export { DensProtocolUtxo, DensRrsUtxo, DensSetUtxo, Point, Protocol };

/**
 * {@link DensDb} is the (pooled) connection to the db whose member functions
 * provide queries to the db
 */
export class DensDb {
  #pool: pg.Pool;
  constructor(connectionOptions: DbConfig) {
    const cOpts = connectionOptions;

    let host: string = ``;
    let port: number | undefined = undefined;

    switch (cOpts.socket.name) {
      case `InternetDomain`:
        host = cOpts.socket.fields.host;
        port = Number(cOpts.socket.fields.port);
        break;
      case `UnixDomain`:
        host = cOpts.socket.fields.path;
        break;
    }

    this.#pool = new pg.Pool(
      {
        host: host,
        port: port,
        user: cOpts.user,
        database: cOpts.database,
        password: cOpts.password,
      },
    );
  }

  /**
   * Low level wrapper around the underlying DB's library query function
   * @internal
   */
  async query(queryTextOrConfig: string | QueryConfig): Promise<QueryResult> {
    logger.profile(`${queryTextOrConfig}`, { level: "debug" });

    const result = await this.#pool.query(queryTextOrConfig);

    logger.profile(`${queryTextOrConfig}`, { level: "debug" });

    return result;
  }

  /**
   * {@link densInit} initializes the tables on the DB.
   * See `./dens-query/api/postgres/dens.sql` for details
   */
  async densInit(initSqlFile: string): Promise<void> {
    const initSql: string = await fs.readFile(initSqlFile, {
      encoding: "utf8",
      flag: "r",
    });

    logger.info(
      `Executing ${initSqlFile} to initialize the database...`,
    );

    await this.query(initSql);

    return;
  }

  /**
   * {@link densWithDbClient} enters a SQL transaction which
   *
   * 1. Begins a transaction
   *
   * 2. Runs the queries provided by the client
   * @private
   * See {@link https://node-postgres.com/features/transactions}
   */
  async densWithDbClient<A>(
    f: (client: DensDbClient) => Promise<A>,
  ): Promise<A> {
    const client = await this.#pool.connect();
    const densClient = new DensDbClient(client);
    try {
      await densClient.query(`BEGIN`);
      const result = await f(densClient);
      await densClient.query(`COMMIT`);
      return result;
    } catch (e) {
      await densClient.query(`ROLLBACK`);
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * {@link end} cleans up the connection
   */
  async end(): Promise<void> {
    await this.#pool.end();
  }
}

/**
 * {@link DensDbClient} is a specific connection to the underlying database. In
 * particular, SQL transactions should all occur with the same client.
 */
export class DensDbClient {
  #client: pg.ClientBase;

  constructor(client: pg.ClientBase) {
    this.#client = client;
  }

  /**
   * Low level wrapper around the underlying DB's library query function
   * @internal
   * @private
   * WARNING(jaredponn): duplicated code from {@link DensDb}
   */
  async query(queryTextOrConfig: string | QueryConfig): Promise<QueryResult> {
    logger.profile(`${queryTextOrConfig}`, { level: "debug" });

    const result = await this.#client.query(queryTextOrConfig);

    logger.profile(`${queryTextOrConfig}`, { level: "debug" });

    return result;
  }

  /**
   * {@link upsertDensSetUtxo} inserts (or updates the tx out refs of the name
   * if it already exists) a {@link DensSetUtxo} in the database.
   */
  async upsertDensSetUtxo(
    { name, pointer, txOutRef }: DensSetUtxo,
  ) {
    const [currencySymbol, tokenName] = pointer;
    await this.query(
      {
        text: `MERGE INTO dens_set_utxos ` +
          `USING (VALUES(NULL)) AS foo ON name = $1 ` +
          `WHEN MATCHED THEN UPDATE SET pointer = CAST(ROW($2, $3) AS asset_class), ` +
          `tx_out_ref_id = $4, ` +
          `tx_out_ref_idx = $5 ` +
          `WHEN NOT MATCHED THEN INSERT(name, pointer, tx_out_ref_id, tx_out_ref_idx) ` +
          `VALUES ($1, CAST(ROW($2, $3) AS asset_class), $4, $5)`,

        // NOTE(jaredponn): Why don't we use upsert?
        // We don't use a query as follows:
        // ```
        // `INSERT INTO dens_set_utxos (name, pointer, tx_out_ref_id, tx_out_ref_idx) ` +
        // `VALUES ($1, CAST(ROW($2, $3) AS asset_class), $4, $5) ` +
        // `ON CONFLICT (name) DO UPDATE SET tx_out_ref_id = EXCLUDED.tx_out_ref_id, tx_out_ref_idx = EXCLUDED.tx_out_ref_idx`,
        // ```
        // because it doesn't play nicely with undo logging i.e., in an
        // "upsert", both the insert and update trigger
        // would be fired which would "double delete" the key.
        // We could fix this by checking if the row exists before adding the
        // delete when adding the undo log, but then we'd
        // lose concurrency guarantees
        values: [
          name,
          Buffer.from(currencySymbol),
          Buffer.from(tokenName),
          txOutRef.txOutRefId,
          txOutRef.txOutRefIdx,
        ],
      },
    );
  }

  async insertPoint({ blockId, slot }: Point): Promise<void> {
    await this.query(
      {
        text: `INSERT INTO blocks VALUES($1, $2)`,
        values: [slot, blockId],
      },
    );
  }

  // NOTE(jaredponn): this is deprecated
  async selectPointExists({ blockId, slot }: Point): Promise<boolean> {
    const res = await this.query(
      {
        text: `SELECT true FROM blocks WHERE block_slot = $1 AND block_id = $2`,
        values: [slot, blockId],
      },
    );

    return res.rows.length === 1;
  }

  async insertTxOutRef(
    { txOutRefId, txOutRefIdx }: TxOutRef,
  ): Promise<void> {
    await this.query(
      {
        text: `MERGE INTO tx_out_refs ` +
          `USING (VALUES (NULL)) AS foo ON tx_out_ref_id = $1 AND tx_out_ref_idx = $2 ` +
          `WHEN NOT MATCHED THEN INSERT(tx_out_ref_id, tx_out_ref_idx, block_slot, block_id) ` +
          `VALUES($1, $2, (get_most_recent_block()).*)`,
        // NOTE(jaredponn): See NOTE(jaredponn): Why don't we use upsert?
        // ```
        // `INSERT INTO tx_out_refs VALUES ($1,$2, (get_most_recent_block()).*) ` +
        // `ON CONFLICT DO NOTHING`,
        // ```
        values: [txOutRefId, txOutRefIdx],
      },
    );
  }

  async deleteTxOutRef({ txOutRefId, txOutRefIdx }: TxOutRef): Promise<void> {
    await this.query(
      {
        text:
          `DELETE FROM tx_out_refs WHERE tx_out_ref_id = $1 AND tx_out_ref_idx = $2`,
        values: [txOutRefId, txOutRefIdx],
      },
    );
  }

  async selectProtocolNft(): Promise<PlaV1.AssetClass> {
    const res: QueryResult = await this.query(
      {
        text:
          `SELECT (asset_class).currency_symbol AS currency_symbol, (asset_class).token_name AS token_name ` +
          `FROM dens_protocol_nft ` +
          `LIMIT 1`,
        values: [],
      },
    );
    if (res.rows.length !== 1) {
      throw new Error(`Protocol NFT has not been set yet`);
    }

    return [
      Prelude.fromJust(
        PlaV1.currencySymbolFromBytes(res.rows[0]!.currency_symbol),
      ),
      Prelude.fromJust(PlaV1.tokenNameFromBytes(res.rows[0]!.token_name)),
    ] as PlaV1.AssetClass;
  }

  async selectProtocol(): Promise<DensProtocolUtxo | undefined> {
    const res: QueryResult = await this.query(
      {
        text:
          `SELECT element_id_minting_policy, set_elem_minting_policy, set_validator, records_validator, tx_out_ref_id, tx_out_ref_idx
                   FROM dens_protocol_utxos`,
        values: [],
      },
    );

    if (res.rows.length === 1) {
      const row = res.rows[0];
      const protocol = {
        elementIdMintingPolicy: Prelude.fromJust(
          PlaV1.scriptHashFromBytes(
            Uint8Array.from(row.element_id_minting_policy),
          ),
        ),
        setElemMintingPolicy: Prelude.fromJust(
          PlaV1.scriptHashFromBytes(
            Uint8Array.from(row.set_elem_minting_policy),
          ),
        ),
        setValidator: Prelude.fromJust(
          PlaV1.scriptHashFromBytes(Uint8Array.from(row.set_validator)),
        ),
        recordsValidator: Prelude.fromJust(
          PlaV1.scriptHashFromBytes(Uint8Array.from(row.records_validator)),
        ),
      };
      return {
        protocol: protocol,
        txOutRef: {
          txOutRefId: Uint8Array.from(row.tx_out_ref_id) as unknown as TxId,
          txOutRefIdx: BigInt(row.tx_out_ref_idx),
        },
      };
    } else if (res.rows.length === 0) {
      return undefined;
    } else {
      throw new Error(
        `selectProtocol: internal error returned too many rows. There is strictly more than one UTxO with the protocol NFT`,
      );
    }
  }

  async insertProtocol(
    { txOutRef, protocol }: DensProtocolUtxo,
  ): Promise<void> {
    await this.query(
      {
        text: `INSERT INTO dens_protocol_utxos VALUES($1,$2,$3,$4,$5,$6)`,
        values: [
          protocol.elementIdMintingPolicy,
          protocol.setElemMintingPolicy,
          protocol.setValidator,
          protocol.recordsValidator,
          txOutRef.txOutRefId,
          txOutRef.txOutRefIdx,
        ],
      },
    );
  }

  /**
   * Inserts the dens elmeent UTxO
   */
  async insertDensElemIdUtxo(
    mintedToken: PlaV1.AssetClass,
    txOutRef: TxOutRef,
  ) {
    await this.query(
      {
        text:
          `INSERT INTO dens_elem_ids(tx_out_ref_id, tx_out_ref_idx, asset_class) ` +
          `VALUES ($1, $2, CAST(ROW($3, $4) AS asset_class))`,
        values: [
          Buffer.from(txOutRef.txOutRefId.buffer),
          txOutRef.txOutRefIdx,
          Buffer.from(mintedToken[0]),
          Buffer.from(mintedToken[1]),
        ],
      },
    );
  }

  /**
   * Deletes the transaction outputs which contain the
   */
  async deleteDensElemIdTxOutRef(txOutRef: TxOutRef) {
    await this.query(
      {
        text: `DELETE FROM dens_elem_ids ` +
          `WHERE tx_out_ref_id = $1 AND tx_out_ref_idx = $2`,
        values: [Buffer.from(txOutRef.txOutRefId.buffer), txOutRef.txOutRefIdx],
      },
    );
  }

  /** Tests if the result is a valid name
   */
  async densIsValidName(name: Uint8Array): Promise<boolean> {
    const result = await this.query(
      {
        text: `SELECT dens_is_valid_name($1)`,
        values: [Buffer.from(name)],
      },
    );

    return result.rows[0]!;
  }

  async insertDensRr(
    outputWithDensElemId: {
      elemTxOutRef: TxOutRef;
      elemAssetClass: PlaV1.AssetClass;
    },
    rr: DensRr,
  ) {
    const { elemTxOutRef, elemAssetClass } = outputWithDensElemId;
    const { ttl } = rr;
    const content = validateDensRr(rr);

    if (content === undefined) {
      logger.info(
        `Invalid RR from the tx with output with dens elem id ${
          JSON.stringify(elemAssetClass)
        } identifed by ${
          JSON.stringify(
            elemTxOutRef,
            (_, v) => typeof v === "bigint" ? v.toString() : v,
          )
        }: ${
          JSON.stringify(
            rr,
            (_, v) => typeof v === "bigint" ? v.toString() : v,
          )
        }`,
      );
      return;
    }
    await this.query(
      {
        text: `INSERT INTO dens_rrs(type, ttl, content, dens_elem_id) ` +
          `SELECT $1, $2, $3, dens_elem_ids.id ` +
          `FROM dens_elem_ids JOIN dens_set_utxos ON dens_elem_ids.asset_class = dens_set_utxos.pointer ` +
          `WHERE dens_elem_ids.tx_out_ref_id = $4 AND dens_elem_ids.tx_out_ref_idx = $5 AND dens_elem_ids.asset_class = CAST(ROW($6, $7) AS asset_class) ` +
          `AND dens_is_valid_name(dens_set_utxos.name)`,
        values: [
          rr.rData.name,
          Number(ttl),
          content,
          Buffer.from(elemTxOutRef.txOutRefId.buffer),
          elemTxOutRef.txOutRefIdx,
          elemAssetClass[0],
          elemAssetClass[1],
        ],
      },
    );
  }

  async selectNamesRrs(name: Uint8Array): Promise<DensRr[]> {
    const res: QueryResult = await this.query(
      {
        text: `SELECT type, ttl, content ` +
          `FROM dens_elem_ids JOIN dens_rrs ON dens_elem_ids.id = dens_rrs.dens_elem_id JOIN dens_set_utxos ON dens_set_utxos.pointer = dens_elem_ids.asset_class ` +
          `WHERE dens_set_utxos.name = CAST($1 AS bytea) ` +
          `ORDER BY dens_rrs.id ASC`,
        values: [Buffer.from(name.buffer)],
      },
    );

    return res.rows.map((row) => {
      switch (row.type) {
        case `A`:
          return {
            ttl: BigInt(row.ttl),
            rData: {
              name: row.type,
              fields: Uint8Array.from(Buffer.from(row.content)),
            },
          };
        case `AAAA`:
          return {
            ttl: BigInt(row.ttl),
            rData: {
              name: row.type,
              fields: Uint8Array.from(Buffer.from(row.content)),
            },
          };
        case `SOA`:
          return {
            ttl: BigInt(row.ttl),
            rData: {
              name: row.type,
              fields: Uint8Array.from(Buffer.from(row.content)),
            },
          };
        default:
          throw new Error(`Invalid RR type in database: ${row.type}`);
      }
    });
  }

  /**
   * {@link selectStrictInfimumDensSetUtxo} finds the greatest lower bound of the
   * given row which is *strictly* smaller than the provided row of the
   * elements already in the set.
   */
  async selectStrictInfimumDensSetUtxo(
    name: Uint8Array,
  ): Promise<DensSetUtxo & { isAlreadyInserted: boolean } | undefined> {
    const res: QueryResult = await this.query(
      {
        text:
          `SELECT name, (pointer).currency_symbol, (pointer).token_name, tx_out_ref_id, tx_out_ref_idx, EXISTS (SELECT 1 FROM dens_set_utxos WHERE name=$1) AS is_already_inserted
           FROM dens_set_utxos
           WHERE name < $1
           ORDER BY name DESC
           LIMIT 1`,
        values: [name],
      },
    );

    if (res.rows.length === 1) {
      const row = res.rows[0];
      return {
        name: Uint8Array.from(row.name),
        pointer: [
          Uint8Array.from(row.currency_symbol) as unknown as CurrencySymbol,
          Uint8Array.from(row.token_name) as unknown as TokenName,
        ],
        txOutRef: {
          txOutRefId: Uint8Array.from(row.tx_out_ref_id) as unknown as TxId,
          txOutRefIdx: BigInt(row.tx_out_ref_idx),
        },
        isAlreadyInserted: row.is_already_inserted as unknown as boolean,
      };
    } else if (res.rows.length === 0) {
      return undefined;
    } else {
      throw new Error(
        `selectStrictInfimumDensSetUtxo: internal error returned too many rows.`,
      );
    }
  }

  async rollBackTo({ slot, blockId }: Point): Promise<void> {
    blockId;
    await this.query(
      {
        text: `SELECT undo_log_rollback_to($1, $2)`,
        values: [slot, blockId],
      },
    );
    return;
  }

  async rollBackToOrigin(): Promise<void> {
    // Put a block which doesn't exist, s.t. it'll undo everything.
    await this.rollBackTo({ slot: -1n, blockId: Uint8Array.from([]) });
    return;
  }

  /**
   * Sets the protocol NFT -- see the postgres function for details.
   */
  async setProtocolNft(
    assetClass: PlaV1.AssetClass,
  ): Promise<PlaV1.AssetClass> {
    const [currencySymbol, tokenName] = assetClass;
    const res = await this.query(
      {
        text:
          `SELECT (t.asset_class).currency_symbol AS currency_symbol, (t.asset_class).token_name AS token_name 
           FROM (VALUES ((dens_set_protocol_nft($1, $2)).*) ) AS t (pk, asset_class)`,
        values: [currencySymbol, tokenName],
      },
    );

    if (res.rows.length === 1) {
      const row = res.rows[0];
      return [
        Uint8Array.from(row.currency_symbol) as unknown as CurrencySymbol,
        Uint8Array.from(row.token_name) as unknown as TokenName,
      ];
    } else {
      throw new Error(
        `setProtocolNft: didn't return exactly one row.`,
      );
    }
  }

  /**
   * Syncs the current protocol NFT with the protocol NFT in the database --
   * see the postgres function for details.
   */
  async syncProtocolNft(
    assetClass: PlaV1.AssetClass,
  ): Promise<PlaV1.AssetClass> {
    const [currencySymbol, tokenName] = assetClass;
    const res = await this.query(
      {
        text:
          `SELECT * FROM (VALUES ((dens_sync_protocol_nft($1, $2)).*) ) AS t (pk, currency_symbol, token_name)`,
        values: [currencySymbol, tokenName],
      },
    );

    if (res.rows.length === 1) {
      const row = res.rows[0];
      return [
        Uint8Array.from(row.currency_symbol) as unknown as CurrencySymbol,
        Uint8Array.from(row.token_name) as unknown as TokenName,
      ];
    } else {
      throw new Error(
        `syncProtocolNft: internal error didn't return exactly one row.`,
      );
    }
  }

  async recentPoints(): Promise<Point[]> {
    const res = await this.query(
      {
        text: `SELECT block_slot, block_id FROM dens_recent_points()`,
        values: [],
      },
    );

    return res.rows.map((row) => {
      return {
        blockId: Uint8Array.from(row.block_id),
        slot: BigInt(row.block_slot),
      };
    });
  }
}

/**
 * {@link transposeAssetClasses} will transpose (matrix transpose) an array of
 * {@link PlaV1.AssetClass}es
 */
export function transposeAssetClasses(
  assetClasses: PlaV1.AssetClass[],
): [PlaV1.CurrencySymbol[], PlaV1.TokenName[]] {
  const cs: CurrencySymbol[] = [];
  const tns: TokenName[] = [];

  for (const [c, t] of assetClasses) {
    cs.push(c);
    tns.push(t);
  }

  return [cs, tns];
}

/**
 * Some simple validation rules to ensure that the RRs are "valid" in a
 * reasonable sense for backends like PowerDNS.
 *
 * Returns the content, or undefined if it isn't valid.
 */
export function validateDensRr(rr: DensRr): string | undefined {
  // See 4.1.3 of <https://www.ietf.org/rfc/rfc1035.txt>
  if (!(0 <= rr.ttl && rr.ttl <= (2 ^ 32 - 1))) {
    return undefined;
  }

  const rdata = rr.rData;
  switch (rdata.name) {
    case `A`: {
      const ipv4 = Buffer.from(Uint8Array.from(rdata.fields)).toString();

      if (!net.isIPv4(ipv4)) {
        return undefined;
      }
      return ipv4;
    }
    case `AAAA`: {
      const ipv6 = Buffer.from(Uint8Array.from(rdata.fields)).toString();
      if (!net.isIPv6(ipv6)) {
        return undefined;
      }
      return ipv6;
    }

    case `SOA`: {
      // TODO(jaredponn): write a quick regex to validate this.
      const soa = Buffer.from(Uint8Array.from(rdata.fields)).toString();
      return soa;
    }
  }
}
