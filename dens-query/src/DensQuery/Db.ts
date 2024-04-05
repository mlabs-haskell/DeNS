import pg from "pg";
import type { Pool, QueryConfig, QueryResult } from "pg";
import { config } from "./Config.js";
import { logger } from "./Logger.js";
import * as fs from "node:fs/promises";
import type {
  CurrencySymbol,
  TokenName,
  TxId,
  TxOutRef,
} from "plutus-ledger-api/V1.js";

export interface DensSetRow {
  name: Uint8Array;
  slot: bigint;
  currency_symbol: CurrencySymbol;
  token_name: TokenName;
  tx_out_ref: TxOutRef;
}

/**
 * {@link DensDb} is the (pooled) connection to the db
 */
export class DensDb {
  #pool: Pool;

  constructor(connectionOptions?: typeof config.db.connectionOptions) {
    if (connectionOptions === undefined) {
      this.#pool = new pg.Pool(config.db.connectionOptions);
    } else {
      this.#pool = new pg.Pool(connectionOptions);
    }
  }

  /**
   * Low level wrapper around the underlying DB's library query function
   * @internal
   */
  async query(text: string | QueryConfig): Promise<QueryResult> {
    logger.profile(`${text}`, { level: "debug" });

    const result = await this.#pool.query(text);

    logger.profile(`${text}`, { level: "debug" });

    return result;
  }

  /**
   * {@link init} initializes the tables on the DB.
   * See `./dens-query/api/postgres/dens.sql` for details
   */
  async init(): Promise<void> {
    const initSql: string = await fs.readFile(config.db.initSqlFile, {
      encoding: "utf8",
      flag: "r",
    });

    logger.info(
      `Executing ${config.db.initSqlFile} to initialize the database...`,
    );

    await this.query(initSql);

    return;
  }

  /**
   * {@link insertDensSetRow} inserts a dens set element in the database
   */
  async insertDensSetRow(
    { name, slot, currency_symbol, token_name, tx_out_ref }: DensSetRow,
  ) {
    await this.query(
      {
        // TODO(jaredponn): on collisions, is this the behavior that we want?
        text: `INSERT INTO dens_set VALUES($1, $2, $3, $4, $5, $6)
               ON CONFLICT (name) DO UPDATE SET
                    name = excluded.name,
                    slot = excluded.slot,
                    currency_symbol = excluded.currency_symbol,
                    token_name = excluded.token_name,
                    tx_out_ref_id = excluded.tx_out_ref_id,
                    tx_out_ref_idx = excluded.tx_out_ref_idx`,
        values: [
          name,
          slot,
          currency_symbol,
          token_name,
          tx_out_ref.txOutRefId,
          tx_out_ref.txOutRefIdx,
        ],
      },
    );
  }

  // /**
  //  * {@link strictInfimumDensSetRow} finds the greatest lower bound of the
  //  * given row which is *strictly* smaller than the provided row of the
  //  * elements already in the set.
  //  */
  async strictInfimumDensSetRow(
    name: Uint8Array,
  ): Promise<DensSetRow | undefined> {
    // TODO(jaredponn) return the element if it exists
    const res: QueryResult = await this.query(
      {
        text:
          `SELECT name, slot, currency_symbol, token_name, tx_out_ref_id, tx_out_ref_idx
             FROM dens_set
             WHERE name < $1
             ORDER BY name DESC
             LIMIT 1
             `,
        values: [name],
      },
    );

    if (res.rows.length === 1) {
      const row = res.rows[0];
      return {
        name: Uint8Array.from(row.name),
        slot: BigInt(row.slot),
        currency_symbol: Uint8Array.from(
          row.currency_symbol,
        ) as unknown as CurrencySymbol,
        token_name: Uint8Array.from(row.token_name) as unknown as TokenName,
        tx_out_ref: {
          txOutRefId: Uint8Array.from(row.tx_out_ref_id) as unknown as TxId,
          txOutRefIdx: BigInt(row.tx_out_ref_idx),
        },
      };
    } else if (res.rows.length === 0) {
      return undefined;
    } else {
      throw new Error(
        `strictInfimumDensSetRow: internal error returned too many rows.`,
      );
    }
  }

  /**
   * {@link end} cleans up the connection
   */
  async end(): Promise<void> {
    await this.#pool.end();
    return;
  }
}

/**
 * Database connection
 */
export const db: DensDb = new DensDb();
