/**
 * Database connection
 *
 * Note that the database connection is configured by:
 * <https://node-postgres.com/features/connecting#environment-variables>
 * which cites <https://www.postgresql.org/docs/current/libpq-envars.html>
 */

import pg from "pg";

const pool = await new pg.Pool();

export default pool;

/**
 * Queries the DNS records for the "lookup" endpoint
 */
export async function queryLookup(
  qtype: string,
  qname: string,
  zoneId: number,
): Promise<
  {
    qtype: string;
    qname: string;
    content: string;
    ttl: number;
    domain_id: number;
  }[]
> {
  // remove the trailing dot. I think we should normalize this to
  // lowercase? Not sure if PowerDNS does this for us -- I may be
  // misrecalling / conjuring a false memory.
  qname = qname.slice(0, -1).toLowerCase();

  const queryResults = await pool.query(
    `SELECT dens_rrs.type AS qtype, dens_set_utxos.name AS qname, dens_rrs.content AS content, dens_rrs.ttl AS ttl, dens_set_utxos.id AS domain_id 
         FROM dens_rrs JOIN dens_rrs_utxos ON (dens_rrs.tx_out_ref_id = dens_rrs_utxos.tx_out_ref_id AND dens_rrs.tx_out_ref_idx = dens_rrs_utxos.tx_out_ref_idx)
                       JOIN dens_set_utxos ON dens_rrs_utxos.name = dens_set_utxos.name
         WHERE dens_is_valid_name(dens_set_utxos.name)
            AND dens_rrs.type = CAST($1 AS text)
            AND dens_set_utxos.name = CAST($2 AS bytea)
            AND (CAST($3 AS bigint) = -1 OR CAST($3 AS bigint) = dens_set_utxos.id)`,
    [qtype, Buffer.from(qname), BigInt(zoneId)],
  );

  const result: {
    qtype: string;
    qname: string;
    content: string;
    ttl: number;
    domain_id: number;
  }[] = [];

  for (const row of queryResults.rows) {
    result.push(
      {
        qtype: Buffer.from(row["qtype"]).toString(),
        qname: Buffer.from(row["qname"]).toString(),
        content: Buffer.from(row["content"]).toString(),
        ttl: row["ttl"],
        domain_id: row["domain_id"],
      },
    );
  }

  return result;
}
