/**
 * Functionality for interacting with the database
 */
import pg from "pg";
import type { QueryConfig, QueryResult } from "pg";
import { DbConfig } from "lbf-dens-db/LambdaBuffers/Dens/Config.mjs";
import { logger } from "./Logger.js";
import * as fs from "node:fs/promises";
import {
  DensProtocolUtxo,
  DensRrsUtxo,
  DensSetUtxo,
  Point,
} from "lbf-dens-db/LambdaBuffers/Dens/Db.mjs";
import { Protocol } from "lbf-dens/LambdaBuffers/Dens.mjs";
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
    this.#pool = new pg.Pool(
      {
        host: cOpts.host,
        port: Number(cOpts.port),
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
  async densWithDbClient(
    f: (client: DensDbClient) => Promise<void>,
  ): Promise<void> {
    const client = await this.#pool.connect();
    const densClient = new DensDbClient(client);
    try {
      await densClient.query(`BEGIN`);
      await f(densClient);
      await densClient.query(`COMMIT`);
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
 * @private
 * TODO(jaredponn): it'd be faster to build one giant SQL query and submit that
 */
class DensDbClient {
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
   * {@link insertDensSetUtxo} inserts (or updates if it already exists) a
   * {@link DensSetUtxo} in the database.
   */
  async insertDensSetUtxo(
    assetClassesAtTheUtxo: PlaV1.AssetClass[],
    { name, pointer, txOutRef }: DensSetUtxo,
  ) {
    const [currencySymbol, tokenName] = pointer;
    const transposedAssetClassesAtTheUtxo: [CurrencySymbol[], TokenName[]] =
      transposeAssetClasses(assetClassesAtTheUtxo);
    await this.query(
      {
        // TODO(jaredponn): there's an easy optimization to not include the
        // token names
        text: `INSERT INTO dens_set_utxos 
                    (SELECT $3::bytea, $4::bytea, $5::bytea, $6::bytea, $7::bigint
                     FROM dens_protocol_utxos
                     WHERE set_elem_minting_policy IN 
                        ( SELECT currency_symbol 
                          FROM UNNEST($1::bytea[],$2::bytea[]) as asset_classes_at_the_utxo(currency_symbol,token_name)
                        )
                     LIMIT 1
                    )`,
        values: [
          transposedAssetClassesAtTheUtxo[0].map((bs) =>
            Buffer.from(bs.buffer)
          ),
          transposedAssetClassesAtTheUtxo[1].map((bs) =>
            Buffer.from(bs.buffer)
          ),
          name,
          currencySymbol,
          tokenName,
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

  async insertTxOutRef(
    { blockId, slot }: Point,
    { txOutRefId, txOutRefIdx }: TxOutRef,
  ): Promise<void> {
    await this.query(
      {
        text: `INSERT INTO tx_out_refs VALUES($1,$2,$3,$4)`,
        values: [txOutRefId, txOutRefIdx, slot, blockId],
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

  async selectProtocol(): Promise<Protocol | undefined> {
    const res: QueryResult = await this.query(
      {
        text:
          `SELECT element_id_minting_policy, set_elem_minting_policy, set_validator, records_validator
                   FROM dens_protocol_utxos`,
        values: [],
      },
    );

    if (res.rows.length === 1) {
      const row = res.rows[0];
      return {
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
   * Given all `assetClassesAtTheUtxo` at the UTxO, finds all `name`s which
   * have an asset class in `assetClassesAtTheUtxo`, and adds the `name` +
   * provided `rrs` + `txOutRef` to the table.
   *
   * Note that this ignores the `name` in {@link DensRrsUtxo}
   */
  async insertDensRrsUtxo(
    assetClassesAtTheUtxo: PlaV1.AssetClass[],
    { rrs, txOutRef }: DensRrsUtxo,
  ): Promise<void> {
    const transposedAssetClassesAtTheUtxo: [CurrencySymbol[], TokenName[]] =
      transposeAssetClasses(assetClassesAtTheUtxo);

    await this.query(
      {
        // NOTE(jaredponn): we don't use the following query since we need to
        // be a bit clever on adding this to names which actually have it.
        // ```
        // text: `INSERT INTO dens_rrs_utxos VALUES($1,$2,$3,$4,$5,$6)`,
        // ```
        text: `INSERT INTO dens_rrs_utxos 
               SELECT name,$3::bytea,$4::bytea,$5::bigint
               FROM dens_set_utxos
               WHERE (currency_symbol,token_name)
                    IN (SELECT * 
                        FROM UNNEST($1::bytea[],$2::bytea[]) as asset_classes_at_the_utxo(currency_symbol,token_name))`,
        values: [
          transposedAssetClassesAtTheUtxo[0].map((bs) =>
            Buffer.from(bs.buffer)
          ),
          transposedAssetClassesAtTheUtxo[1].map((bs) =>
            Buffer.from(bs.buffer)
          ),
          Buffer.from(rrs.buffer),
          Buffer.from(txOutRef.txOutRefId.buffer),
          txOutRef.txOutRefIdx,
        ],
      },
    );
  }

  async selectNamesRrs(name: Uint8Array): Promise<Uint8Array[]> {
    const res: QueryResult = await this.query(
      {
        text: `SELECT rrs 
               FROM dens_rrs_utxos
               WHERE dens_rrs_utxos.name = $1::bytea`,
        values: [Buffer.from(name.buffer)],
      },
    );

    return res.rows.map((row) => Uint8Array.from(row.rrs));
  }

  /**
   * {@link selectStrictInfimumDensSetUtxo} finds the greatest lower bound of the
   * given row which is *strictly* smaller than the provided row of the
   * elements already in the set.
   */
  async selectStrictInfimumDensSetUtxo(
    name: Uint8Array,
  ): Promise<DensSetUtxo | undefined> {
    const res: QueryResult = await this.query(
      {
        text:
          `SELECT name, currency_symbol, token_name, tx_out_ref_id, tx_out_ref_idx
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
      };
    } else if (res.rows.length === 0) {
      return undefined;
    } else {
      throw new Error(
        `selectStrictInfimumDensSetUtxo: internal error returned too many rows.`,
      );
    }
  }

  async deletePointsStrictlyAfter({ slot, blockId }: Point): Promise<void> {
    blockId;
    await this.query(
      {
        text: `DELETE FROM blocks
           WHERE $1 < block_slot`,
        values: [slot],
      },
    );
    return;
  }

  async deleteAllPoints(): Promise<void> {
    await this.query(
      {
        text: `DELETE FROM blocks`,
        values: [],
      },
    );
    return;
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
