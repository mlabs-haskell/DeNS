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
        text:
          `INSERT INTO dens_set_utxos (name, currency_symbol, token_name, tx_out_ref_id, tx_out_ref_idx)
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
        text:
          `INSERT INTO tx_out_refs VALUES ($1,$2, (get_most_recent_block()).*)`,
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

    // First, we make note of the UTxO which contains the RRs
    await this.query(
      {
        // NOTE(jaredponn): we don't use the following query since we need to
        // be a bit clever on adding this to names which actually have it.
        // ```
        // text: `INSERT INTO dens_rrs_utxos VALUES($1,$2,$3,$4,$5,$6)`,
        // ```
        text: `INSERT INTO dens_rrs_utxos(name, tx_out_ref_id, tx_out_ref_idx)
               SELECT name,$3::bytea,$4::bigint
               FROM dens_set_utxos
               WHERE (currency_symbol,token_name) IN (SELECT * FROM UNNEST($1::bytea[],$2::bytea[]) as asset_classes_at_the_utxo(currency_symbol,token_name))
                    AND (encode(name, 'escape') SIMILAR TO '.|(([a-z]([-a-z0-9]*[a-z0-9])?)(.([a-z]([-a-z0-9]*[a-z0-9])?))*)')
               ON CONFLICT DO NOTHING
                    `,
        // Note that we ONLY add records which match the domains in
        // Section 3.5 of
        // <https://datatracker.ietf.org/doc/html/rfc1034> AND are
        // lower case (this is to ensure adversaries can't add
        // random RRs to someone elses things.
        //
        // For compatibility with DNS backends like PowerDNS, we must ensure:
        //      - names are NEVER terminated with a trailing `.`,
        //      - with the exception of the root zone, which must have the name of `.`
        // See <https://doc.powerdns.com/authoritative/backends/generic-sql.html#:~:text=The%20generic%20SQL%20backends%20(like,needed%20to%20cover%20all%20needs.>
        //
        values: [
          transposedAssetClassesAtTheUtxo[0].map((bs) =>
            Buffer.from(bs.buffer)
          ),
          transposedAssetClassesAtTheUtxo[1].map((bs) =>
            Buffer.from(bs.buffer)
          ),
          Buffer.from(txOutRef.txOutRefId.buffer),
          txOutRef.txOutRefIdx,
        ],
      },
    );

    // Then, we add the list of RRs
    for (const rr of rrs) {
      const { ttl } = rr;
      const content = validateDensRr(rr);

      if (content === undefined) {
        logger.info(
          `Invalid RR at ${
            JSON.stringify(
              txOutRef,
              (_, v) => typeof v === "bigint" ? v.toString() : v,
            )
          }: ${
            JSON.stringify(
              rr,
              (_, v) => typeof v === "bigint" ? v.toString() : v,
            )
          }`,
        );
        continue;
      }

      await this.query(
        {
          text:
            `INSERT INTO dens_rrs(tx_out_ref_id, tx_out_ref_idx, type, ttl, content)
                       VALUES ($1, $2, $3, $4, $5)
                            `,
          values: [
            Buffer.from(txOutRef.txOutRefId.buffer),
            txOutRef.txOutRefIdx,
            rr.rData.name,
            Number(ttl),
            content,
          ],
        },
      );
    }
  }

  async selectNamesRrs(name: Uint8Array): Promise<DensRr[]> {
    const res: QueryResult = await this.query(
      {
        text: `SELECT type, ttl, content
               FROM dens_rrs_utxos JOIN dens_rrs
                ON dens_rrs_utxos.tx_out_ref_id = dens_rrs.tx_out_ref_id
                    AND dens_rrs_utxos.tx_out_ref_idx = dens_rrs.tx_out_ref_idx
               WHERE dens_rrs_utxos.name = CAST($1 AS bytea)
               ORDER BY dens_rrs.id ASC`,
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
          `SELECT name, currency_symbol, token_name, tx_out_ref_id, tx_out_ref_idx, EXISTS (SELECT 1 FROM dens_set_utxos WHERE name=$1) AS is_already_inserted
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
          `SELECT * FROM (VALUES ((set_protocol_nft($1, $2)).*) ) AS t (pk, currency_symbol, token_name)`,
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
        `setProtocolNft: internal error returned too many rows.`,
      );
    }
  }

  async recentPoints(): Promise<Point[]> {
    const res = await this.query(
      {
        text: `SELECT block_slot, block_id FROM recent_points()`,
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
