/*
 * NOTE(jaredponn): Mostly taken from: {@ link
 * https://github.com/CardanoSolutions/ogmios-ts-client-starter-kit/tree/main/src}
 */
import { createInteractionContext } from "@cardano-ogmios/client";
import type * as OgmiosClient from "@cardano-ogmios/client";
import * as OgmiosSchema from "@cardano-ogmios/schema";
import { createChainSynchronizationClient } from "@cardano-ogmios/client";

import { config } from "./Config.js";
import { logger } from "./Logger.js";
import * as Db from "./Db.js";
import * as PlaV1 from "plutus-ledger-api/V1.js";
import * as PlaPd from "plutus-ledger-api/PlutusData.js";
import * as Prelude from "prelude";
import * as LbrPlutusV1 from "lbr-plutus/V1.js";
import * as LbfDens from "lbf-dens/LambdaBuffers/Dens.mjs";

import * as CardanoCore from "@cardano-sdk/core";

export function createContext(
  host: string,
  port: number,
): Promise<OgmiosClient.InteractionContext> {
  return createInteractionContext(
    (err) => logger.error(`Ogmios connection error: ${err}`),
    () => logger.info("Ogmios connection closed"),
    { connection: { host: host, port: port } },
  );
}

export function ogmiosTransactionOutputReferenceToPlaTxOutRef(
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

export function ogmiosPointToPlaPoint(
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

export function hexPlutusDataToPlaPlutusData(
  hexString: string,
): PlaPd.PlutusData {
  const corePlutusData: CardanoCore.Cardano.PlutusData = CardanoCore
    .Serialization.PlutusData.fromCbor(hexString).toCore();

  function corePlutusDataToPlaPlutusData(
    c: CardanoCore.Cardano.PlutusData,
  ): PlaPd.PlutusData {
    if (typeof c === "bigint") {
      return { name: "Integer", fields: c };
    } else if (c instanceof Uint8Array) {
      return { name: "Bytes", fields: c };
    } else if (c.items !== undefined) {
      return {
        name: "List",
        fields: c.items.map(corePlutusDataToPlaPlutusData),
      };
    } else if (c.data !== undefined) {
      const fields: [PlaPd.PlutusData, PlaPd.PlutusData][] = [];
      for (const [k, v] of c.data) {
        fields.push([
          corePlutusDataToPlaPlutusData(k),
          corePlutusDataToPlaPlutusData(v),
        ]);
      }
      return { name: "Map", fields };
    } else if (c.fields !== undefined) {
      return {
        name: "Constr",
        fields: [c.constructor, c.fields.map(corePlutusDataToPlaPlutusData)],
      };
    } else {
      throw new Error(`Bad plutus data ${c}`);
    }
  }

  return corePlutusDataToPlaPlutusData(corePlutusData);
}

export function ogmiosValueFlattenPositiveAmounts(
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

export async function rollForwardDb(
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
          client.deleteTxOutRef(
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
            Buffer.from(config.protocolNft[0].buffer).toString("hex"),
            Buffer.from(config.protocolNft[1].buffer).toString("hex"),
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

export async function runChainSync() {
  const context = await createContext(
    config.ogmios.host,
    Number(config.ogmios.port),
  );
  const db = Db.db;
  const client = await createChainSynchronizationClient(context, {
    rollForward: async (
      { block }: {
        block: OgmiosSchema.Block;
        tip: OgmiosSchema.Tip | OgmiosSchema.Origin;
      },
      nextBlock: () => void,
    ) => {
      await rollForwardDb(db, { block });
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
