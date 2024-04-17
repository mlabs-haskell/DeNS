/**
 * Functionality for syncing with the chain via ogmios.
 *
 * @private
 * Mostly taken from: {@link https://ogmios.dev/mini-protocols/local-chain-sync/ }
 */
import * as OgmiosSchema from "@cardano-ogmios/schema";

import { logger } from "./Logger.js";
import { OgmiosConfig } from "lbf-dens-db/LambdaBuffers/Dens/Config.mjs";
import * as Db from "./Db.js";
import * as PlaV1 from "plutus-ledger-api/V1.js";
import * as PlaPd from "plutus-ledger-api/PlutusData.js";
import * as Prelude from "prelude";
import * as LbrPlutusV1 from "lbr-plutus/V1.js";
import * as LbfDens from "lbf-dens/LambdaBuffers/Dens.mjs";
import * as csl from "@emurgo/cardano-serialization-lib-nodejs";
import { WebSocket } from "ws";

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
            const protocolUtxo = await client.selectProtocol();
            const setDatum = LbrPlutusV1.IsPlutusData[LbfDens.SetDatum]
              .fromData(plaPlutusData);

            const name = setDatum.key.densName;

            if (protocolUtxo !== undefined) {
              const { protocol } = protocolUtxo;
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
      await client.rollBackToOrigin();
    } else {
      await client.rollBackTo(ogmiosPointToPlaPoint(point));
    }
  });
}

/**
 * Extends {@link WebSocket} to provide convenient functionality to isolate the
 * JSON RPC queries that ogmios expects.
 *
 * @private
 * Why don't we just use the client library provided by Ogmios? It's a bit
 * opinionated with how we will interact with Ogmios e.g. looking at the diagram in
 * {@link https://ogmios.dev/mini-protocols/local-chain-sync/}, once we're in
 * the "Initialized" state, their library makes it easy to call "nextBlock",
 * but it's not so easy to call "findIntersection".
 * We want to be able to dynamically change the intersection. Plus, it's
 * actually not that difficult to write this ourselves :).
 */
export class ChainSync extends WebSocket {
  /**
   * Unwraps {@link OgmiosConfig} s.t. {@link WebSocket}'s constructor can be
   * called
   */
  constructor(ogmiosConfig: OgmiosConfig) {
    super(ogmiosConfig.host, { port: Number(ogmiosConfig.port) });
  }

  /**
   * @internal
   * TODO(jaredponn): perhaps we should use LB's JSON mechanisms
   */
  rpc(method: string, params: unknown, id: unknown): void {
    super.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
  }

  /**
   * {@link https://ogmios.dev/mini-protocols/local-chain-sync/#finding-an-intersection}
   */
  findIntersection(points: (OgmiosSchema.Point | "origin")[], id?: unknown) {
    points.push("origin");
    this.rpc("findIntersection", { points }, id);
  }

  /**
   * {@link https://ogmios.dev/mini-protocols/local-chain-sync/#requesting-next-blocks}
   */
  nextBlock(id?: unknown) {
    this.rpc("nextBlock", {}, id);
  }

  static isFindIntersectionResponse(
    response: object,
  ): response is OgmiosSchema.Ogmios["FindIntersectionResponse"] {
    return "method" in response && response["method"] === "findIntersection";
  }

  static isNextBlockResponse(
    response: object,
  ): response is OgmiosSchema.Ogmios["NextBlockResponse"] {
    return "method" in response && response["method"] === "nextBlock";
  }
}

/**
 * {@link runChainSync} is the main function which synchronises with the chain.
 * More precisely,
 *
 *  1. We create a Websocket connection to Ogmios
 *  2. Loop the following forever
 *     2.1 Reset the database to the provided protocolNft (note this
 *     essentially polls to allow dynamically updating which DeNS protocol we
 *     follow)
 *     2.2 Find an intersection with the current database and ogmios
 *     2.3 Gets 100 of the next blocks.
 *
 * @private
 * It would be preferable to set up Postgres' `LISTEN`/`NOTIFY` so we don't
 * have this awkward polling situation. This needs more thought
 */
export async function runChainSync(
  protocolNft: PlaV1.AssetClass,
  ogmiosConfig: OgmiosConfig,
  db: Db.DensDb,
) {
  const client = new ChainSync(ogmiosConfig);

  while (1) {
    protocolNft = await db.densWithDbClient((dbClient) => {
      return dbClient.setProtocolNft(protocolNft);
    });

    const recentPoints: (OgmiosSchema.Point | "origin")[] = await db
      .densWithDbClient((dbClient) => {
        return dbClient.recentPoints();
      }).then((points) => points.map(plaPointToOgmiosPoint));

    recentPoints.push("origin");

    client.findIntersection(recentPoints);

    let resolveBatch: (value?: unknown) => void;
    const task = new Promise((resolve) => resolveBatch = resolve);

    client.on("message", async (msg) => {
      const stringMsg: string = (() => {
        if (Array.isArray(msg)) {
          return msg.map((buf) => buf.toString()).join("");
        } else {
          return msg.toString();
        }
      })();
      const response = JSON.parse(stringMsg);

      if (ChainSync.isFindIntersectionResponse(response)) {
        if ("error" in response) {
          logger.log(
            "error",
            `No intersection found: ${response.error.message}`,
          );
        }
        return;
      } else if (ChainSync.isNextBlockResponse(response)) {
        --numberOfRequests;
        const result = response.result;

        switch (result.direction) {
          case "forward": {
            const block = result.block;
            await rollForwardDb(protocolNft, db, { block });
            break;
          }
          case "backward": {
            const point = result.point;
            await rollBackwardDb(db, { point });
            break;
          }
        }

        if (numberOfRequests === 0) {
          resolveBatch();
        }
      } else {
        throw new Error(`Unexpected response from Ogmios:\n\t${msg}`);
      }
    });

    let numberOfRequests = 100;
    for (let i = 0; i < numberOfRequests; ++i) {
      client.nextBlock();
    }

    await task;
  }
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
function plaPointToOgmiosPoint(
  dbPoint: Db.Point,
): OgmiosSchema.Point {
  return {
    id: Buffer.from(dbPoint.blockId).toString("hex"),
    slot: Number(dbPoint.slot),
  };
}

/**
 * @internal
 */
export function hexPlutusDataToPlaPlutusData(str: string) {
  const cslPd = csl.PlutusData.from_hex(str);
  const result = cslPlutusDataToPlaPlutusData(cslPd);
  cslPd.free();
  return result;
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
    const result: PlaPd.PlutusData = {
      name: "Constr",
      fields: [BigInt(alternative.to_str()), cslPlutusListToPlaPdList(data)],
    };

    data.free();
    alternative.free();
    constr.free();

    return result;
  }

  if (map !== undefined) {
    const keys = map.keys();
    const result: [PlaPd.PlutusData, PlaPd.PlutusData][] = [];

    for (let i = 0; i < keys.len(); ++i) {
      const k = keys.get(i);
      const v = map.get(k)!;
      result.push([
        cslPlutusDataToPlaPlutusData(k),
        cslPlutusDataToPlaPlutusData(v),
      ]);

      k.free();
      v.free();
    }

    keys.free();
    map.free();

    return { name: `Map`, fields: result };
  }

  if (list !== undefined) {
    const result: PlaPd.PlutusData = {
      name: `List`,
      fields: cslPlutusListToPlaPdList(list),
    };
    list.free();
    return result;
  }

  if (integer !== undefined) {
    const result: PlaPd.PlutusData = {
      name: `Integer`,
      fields: BigInt(integer.to_str()),
    };
    integer.free();
    return result;
  }

  if (bytes !== undefined) {
    const result: PlaPd.PlutusData = { name: `Bytes`, fields: bytes };
    return result;
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
    const v = list.get(i);
    result.push(cslPlutusDataToPlaPlutusData(v));
    v.free();
  }
  return result;
}

/**
 * @internal
 */
function plaPdListToCslPlutusList(list: PlaPd.PlutusData[]): csl.PlutusList {
  const result = csl.PlutusList.new();

  for (const elem of list) {
    const v = plaPlutusDataToCslPlutusData(elem);
    result.add(v);
    v.free();
  }

  return result;
}

/**
 * @internal
 */
export function plaPlutusDataToCslPlutusData(
  plutusData: PlaPd.PlutusData,
): csl.PlutusData {
  switch (plutusData.name) {
    case "Integer": {
      const v = csl.BigInt.from_str(plutusData.fields.toString());
      const result = csl.PlutusData.new_integer(v);
      v.free();
      return result;
    }
    case "Bytes":
      return csl.PlutusData.new_bytes(plutusData.fields);
    case "List": {
      const v = plaPdListToCslPlutusList(plutusData.fields);
      const result = csl.PlutusData.new_list(v);
      v.free();
      return result;
    }
    case "Constr": {
      const alt = csl.BigNum.from_str(plutusData.fields[0].toString());
      const args = plaPdListToCslPlutusList(plutusData.fields[1]);
      const constr = csl.ConstrPlutusData.new(alt, args);
      const result = csl.PlutusData.new_constr_plutus_data(constr);
      alt.free();
      args.free();
      constr.free();
      return result;
    }
    case "Map": {
      const plutusMap = csl.PlutusMap.new();
      for (const elem of plutusData.fields) {
        const k = plaPlutusDataToCslPlutusData(elem[0]);
        const v = plaPlutusDataToCslPlutusData(elem[1]);
        plutusMap.insert(k, v);
        k.free();
        v.free();
      }
      const result = csl.PlutusData.new_map(plutusMap);
      plutusMap.free();
      return result;
    }
  }
}
/**
 * @internal
 */
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
