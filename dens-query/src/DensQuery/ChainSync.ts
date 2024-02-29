/**
 * Functionality for syncing with the chain via ogmios.
 *
 * @private
 * Mostly taken from: {@link https://github.com/CardanoSolutions/ogmios-ts-client-starter-kit/tree/main/src }
 */
import { createInteractionContext } from "@cardano-ogmios/client";
import type * as OgmiosClient from "@cardano-ogmios/client";
import * as OgmiosSchema from "@cardano-ogmios/schema";
import { createChainSynchronizationClient } from "@cardano-ogmios/client";

import { logger } from "./Logger.js";
import { OgmiosConfig } from "lbf-dens-db/LambdaBuffers/Dens/Config.mjs";
import * as Db from "./Db.js";
import * as PlaV1 from "plutus-ledger-api/V1.js";
import * as PlaPd from "plutus-ledger-api/PlutusData.js";
import * as Prelude from "prelude";
import * as LbrPlutusV1 from "lbr-plutus/V1.js";
import * as LbfDens from "lbf-dens/LambdaBuffers/Dens.mjs";

import * as csl from "@emurgo/cardano-serialization-lib-nodejs";

/**
 * {@link rollForwardDb} rolls the database forwards via
 *
 *  - removing the UTxOs consumed by transactions in the provided block
 *
 *  - adding UTxOS relevant to the DeNS protocol from the transaction outputs
 *  in the provided block.
 */
export async function rollForwardDb(
  protocolNft: PlaV1.AssetClass,
  db: Db.DensDb,
  { block }: { block: OgmiosSchema.Block },
): Promise<void> {
  // These block types contain useful tx information for DeNS
  if (block.type === "bft" || block.type === "praos") {
    // The new block we are inserting
    const point: Db.Point = ogmiosPointToPlaPoint(block);
    // The transactions in the block
    const txs: OgmiosSchema.Transaction[] = block.transactions !== undefined
      ? block.transactions
      : [];

    // Process all the transactions / add them in the database.
    // The steps are as follows.
    // 1. Add the current block (point)
    // 2. Remove all tx inputs from the dens UTxO set
    // 3. Add tx outputs to the dens UTxO set as required.
    await db.densWithDbClient(async (client) => {
      await client.insertPoint(point);

      for (const tx of txs) {
        const txId = Prelude.fromJust(
          PlaV1.txIdFromBytes(Uint8Array.from(Buffer.from(tx.id, "hex"))),
        );

        // 1.
        for (const txIn of tx.inputs) {
          await client.deleteTxOutRef(
            ogmiosTransactionOutputReferenceToPlaTxOutRef(txIn),
          );
        }

        // 2.
        for (let i = 0; i < tx.outputs.length; ++i) {
          const txOut: OgmiosSchema.TransactionOutput = tx.outputs[i]!;
          const txOutRef = { txOutRefId: txId, txOutRefIdx: BigInt(i) };

          // All of the actions relating to the DeNS protocol require
          // the UTxO to contain an inline datum
          if (txOut.datum === undefined) {
            continue;
          }

          const plaPlutusData = hexPlutusDataToPlaPlutusData(txOut.datum);

          // Most of the actions relating to dens require us knowing
          // the tokens at the UTxO
          const csAndTns = ogmiosValueFlattenPositiveAmounts(txOut.value);

          /**
           * Attempt to update the Protocol UTxO
           */
          const isProtocolUtxo = ((protCurrencySymbol, protTokenName) => {
            if (txOut.value[protCurrencySymbol] === undefined) {
              return false;
            }

            if (txOut.value[protCurrencySymbol]![protTokenName] === undefined) {
              return false;
            }

            return txOut.value[protCurrencySymbol]![protTokenName]! > 0n;
          })(
            Buffer.from(protocolNft[0].buffer).toString("hex"),
            Buffer.from(protocolNft[1].buffer).toString("hex"),
          );

          if (isProtocolUtxo) {
            try {
              const protocol = LbrPlutusV1.IsPlutusData[LbfDens.Protocol]
                .fromData(plaPlutusData);
              await client.insertProtocol({ txOutRef, protocol });
            } catch (err) {
              if (err instanceof PlaPd.IsPlutusDataError) {
                logger.warn(`Failed to decode Protocol's datum ${err}`);
              } else {
                throw err;
              }
            }
          }

          /**
           * Attempt to insert an RR
           */
          try {
            const recordDatum = LbrPlutusV1.IsPlutusData[LbfDens.RecordDatum]
              .fromData(plaPlutusData);
            if (recordDatum.recordReference.densPointer.name === "Just") {
              // TODO(jaredponn): we just store the rr reference
              // inline
              await client.insertDensRrsUtxo(
                csAndTns,
                {
                  // NOTE(jaredponn): the name isn't used
                  name: undefined as unknown as Uint8Array,
                  rrs: recordDatum.recordReference.densPointer.fields,
                  txOutRef,
                },
              );
            }
          } catch (err) {
            if (!(err instanceof PlaPd.IsPlutusDataError)) {
              throw err;
            }
          }

          /**
           * Attempt to insert a DeNS set element
           */
          try {
            const protocol = await client.selectProtocol();
            const setDatum = LbrPlutusV1.IsPlutusData[LbfDens.SetDatum]
              .fromData(plaPlutusData);

            const name = setDatum.key.densName;

            if (protocol !== undefined) {
              await client.insertDensSetUtxo(
                csAndTns,
                {
                  name,
                  // TODO(jaredponn): compute this properly i.e., recall that
                  // the token name should be the hash of a few things.
                  pointer: [
                    Prelude.fromJust(
                      PlaV1.currencySymbolFromBytes(
                        protocol.elementIdMintingPolicy,
                      ),
                    ),
                    PlaV1.adaToken,
                  ],
                  txOutRef,
                },
              );
            }
          } catch (err) {
            if (!(err instanceof PlaPd.IsPlutusDataError)) {
              throw err;
            }
          }
        }
        // TODO(jaredponn): we really should scan through other outputs like
        // the collateralReturn output.
        // But! The offchain code really shouldn't generate a useful DeNS
        // output as a collateralReturn output
      }
    });
  }
}

/**
 * {@link rollBackwardDb} rolls the database backwards to the provided point i.e.,
 *
 *  - if the point is the origin, then we delete the entire database
 *
 *  - otherwise, we delete all blocks strictly after the provided point
 */
export async function rollBackwardDb(
  db: Db.DensDb,
  { point }: { point: OgmiosSchema.Point | OgmiosSchema.Origin },
): Promise<void> {
  await db.densWithDbClient(async (client) => {
    if (point === "origin") {
      await client.deleteAllPoints;
    } else {
      await client.deletePointsStrictlyAfter(ogmiosPointToPlaPoint(point));
    }
  });
}

/**
 * {@link runChainSync} is the main function which synchronises with the chain.
 */
export async function runChainSync(
  protocolNft: PlaV1.AssetClass,
  ogmiosConfig: OgmiosConfig,
  db: Db.DensDb,
) {
  const context = await createContext(
    ogmiosConfig.host,
    Number(ogmiosConfig.port),
  );
  const client = await createChainSynchronizationClient(context, {
    rollForward: async (
      { block }: {
        block: OgmiosSchema.Block;
        tip: OgmiosSchema.Tip | OgmiosSchema.Origin;
      },
      nextBlock: () => void,
    ) => {
      await rollForwardDb(protocolNft, db, { block });
      nextBlock();
    },
    rollBackward: async (
      { point }: {
        point: OgmiosSchema.Point | OgmiosSchema.Origin;
        tip: OgmiosSchema.Tip | OgmiosSchema.Origin;
      },
      nextBlock: () => void,
    ) => {
      await rollBackwardDb(db, { point });
      nextBlock();
    },
  });

  // TODO(jaredponn): put the most recent points as an argument to `resume`.
  // Need to add rank query to prelude-typescript for testing.
  // Right now, it'll always resync from the beginning of time even if it's
  // cached perfectly fine.
  await client.resume();
}

/**
 * @internal
 */
function createContext(
  host: string,
  port: number,
): Promise<OgmiosClient.InteractionContext> {
  return createInteractionContext(
    (err) => logger.error(`Ogmios connection error: ${err}`),
    () => logger.info("Ogmios connection closed"),
    { connection: { host: host, port: port } },
  );
}

/**
 * @internal
 */
function ogmiosTransactionOutputReferenceToPlaTxOutRef(
  txOutRef: Readonly<OgmiosSchema.TransactionOutputReference>,
): PlaV1.TxOutRef {
  return {
    txOutRefId: Prelude.fromJust(
      PlaV1.txIdFromBytes(
        Uint8Array.from(Buffer.from(txOutRef.transaction.id, "hex")),
      ),
    ),
    txOutRefIdx: BigInt(txOutRef.index),
  };
}

/**
 * @internal
 */
function ogmiosPointToPlaPoint(
  ogmiosPoint: OgmiosSchema.Point,
): Db.Point {
  const slot: number = ogmiosPoint.slot;
  const blockId: string = ogmiosPoint.id; // Ogmios returns this as hex encoded

  const point: Db.Point = {
    blockId: Uint8Array.from(Buffer.from(blockId, "hex")),
    slot: BigInt(slot),
  };
  return point;
}

/**
 * @internal
 */
export function hexPlutusDataToPlaPlutusData(str: string) {
  const cslPd = csl.PlutusData.from_hex(str);
  return cslPlutusDataToPlaPlutusData(cslPd);
}
/**
 * @internal
 */
export function cslPlutusDataToPlaPlutusData(
  plutusData: csl.PlutusData,
): PlaPd.PlutusData {
  const constr = plutusData.as_constr_plutus_data();
  const map = plutusData.as_map();
  const list = plutusData.as_list();
  const integer = plutusData.as_integer();
  const bytes = plutusData.as_bytes();

  if (constr !== undefined) {
    const alternative = constr.alternative();
    const data = constr.data();

    return {
      name: "Constr",
      fields: [BigInt(alternative.to_str()), cslPlutusListToPlaPdList(data)],
    };
  }

  if (map !== undefined) {
    const keys = map.keys();
    const result: [PlaPd.PlutusData, PlaPd.PlutusData][] = [];

    for (let i = 0; i < keys.len(); ++i) {
      const k = keys.get(i);
      result.push([
        cslPlutusDataToPlaPlutusData(k),
        cslPlutusDataToPlaPlutusData(map.get(k)!),
      ]);
    }

    return { name: `Map`, fields: result };
  }

  if (list !== undefined) {
    return { name: `List`, fields: cslPlutusListToPlaPdList(list) };
  }

  if (integer !== undefined) {
    return { name: `Integer`, fields: BigInt(integer.to_str()) };
  }

  if (bytes !== undefined) {
    return { name: `Bytes`, fields: bytes };
  }

  throw new Error(
    "Internal error when converting cardano-serialization-lib PlutusData to plutus-ledger-api PlutusData",
  );
}

/**
 * @internal
 */
function cslPlutusListToPlaPdList(list: csl.PlutusList): PlaPd.PlutusData[] {
  const result = [];
  for (let i = 0; i < list.len(); ++i) {
    result.push(cslPlutusDataToPlaPlutusData(list.get(i)));
  }
  return result;
}

/**
 * @internal
 */
function ogmiosValueFlattenPositiveAmounts(
  ogmiosValue: Readonly<OgmiosSchema.Value>,
): PlaV1.AssetClass[] {
  // Rename the ada / lovelace currency symbol / token name to what it
  // actually should be

  const flattened: PlaV1.AssetClass[] = [];

  if (ogmiosValue.ada.lovelace > 0n) {
    flattened.push([PlaV1.adaSymbol, PlaV1.adaToken]);
  }

  for (const [cur, tnsamounts] of Object.entries(ogmiosValue)) {
    if (cur === "ada") {
      continue;
    }

    const actualCur = Prelude.fromJust(
      PlaV1.currencySymbolFromBytes(Uint8Array.from(Buffer.from(cur, "hex"))),
    );

    for (const [tn, amount] of Object.entries(tnsamounts)) {
      if (amount > 0n) {
        flattened.push([
          actualCur,
          Prelude.fromJust(
            PlaV1.tokenNameFromBytes(Uint8Array.from(Buffer.from(tn, "hex"))),
          ),
        ]);
      }
    }
  }

  return flattened;
}
