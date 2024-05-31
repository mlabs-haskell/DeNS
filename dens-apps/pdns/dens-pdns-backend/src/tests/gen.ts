/**
 * This module provides helper functions for randomly generating some data.
 *
 * Unfortunately, before someone can even insert a DNS record to be served by
 * PowerDNS, the schema requires a bunch of extra garbage from the foreign key
 * constraints.
 */

import * as crypto from "node:crypto";

let slot: bigint = 1n;

/**
 * Generates a block (point) s.t. a sequence of calls will have slot numbers
 * which are strictly increasing
 */
export function nextBlock(): { blockId: Buffer; blockSlot: bigint } {
  const blockId = crypto.randomBytes(32);
  return { blockId, blockSlot: slot += BigInt(crypto.randomInt(1, 16)) };
}

/**
 * Generates a fresh transaction output
 */
export function freshTxOutRef(): { txOutRefId: Buffer; txOutRefIdx: bigint } {
  const txOutRefId = crypto.randomBytes(32);
  const txOutRefIdx = BigInt(crypto.randomInt(0, 32));
  return { txOutRefId, txOutRefIdx };
}
/**
 * Generates a fresh currency symbol
 */
export function freshCurrencySymbol(): Buffer {
  const currencySymbol = crypto.randomBytes(28);
  return currencySymbol;
}

/**
 * Generates a fresh token name
 */
export function freshTokenName(): Buffer {
  const tokenName = crypto.randomBytes(32);
  return tokenName;
}
