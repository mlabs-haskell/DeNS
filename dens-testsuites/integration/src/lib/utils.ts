import * as csl from "@emurgo/cardano-serialization-lib-nodejs";

/**
 * Translates the hex encoded cbor of a private key as outputted from
 * `cardano-cli` in the `cborHex` field to `cardano-serialization-lib`'s {@link
 * csl.PrivateKey}
 *
 * @example
 * As input, this should take the value of the `cborHex` key.
 * ```
 * {
 *     "type": "PaymentSigningKeyShelley_ed25519",
 *     "description": "Payment Signing Key",
 *     "cborHex": "5820cdb9d333ea48021d7c74852d6411f8c253ff266f95b23d5da1352a530b4e1bb8"
 * }
 * ```
 */
export function cborHexPrivateKey(cborHex: string): csl.PrivateKey {
  const prvKeyPlutusData = csl.PlutusData.from_hex(cborHex);
  const prvKeyBytes = prvKeyPlutusData.as_bytes();
  if (prvKeyBytes === undefined) {
    throw new Error(`Invalid secret key`);
  }
  return csl.PrivateKey.from_normal_bytes(prvKeyBytes);
}

/**
 * Translates the hex encoded cbor of a public key as outputted from
 * `cardano-cli` in the `cborHex` field to `cardano-serialization-lib`'s {@link
 * csl.PublicKey}
 *
 * @example
 * As input, this should take the value of the `cborHex` key.
 * ```
 * {
 *     "type": "PaymentSigningKeyShelley_ed25519",
 *     "description": "Payment Signing Key",
 *     "cborHex": "5820cdb9d333ea48021d7c74852d6411f8c253ff266f95b23d5da1352a530b4e1bb8"
 * }
 * ```
 */
export function cborHexPublicKey(cborHex: string): csl.PublicKey {
  const pubKeyPlutusData = csl.PlutusData.from_hex(cborHex);
  const pubKeyBytes = pubKeyPlutusData.as_bytes();
  if (pubKeyBytes === undefined) {
    throw new Error(`Invalid public key`);
  }
  return csl.PublicKey.from_bytes(pubKeyBytes);
}
