/**
 * Functionality for syncing with the chain via ogmios.
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
import * as url from "node:url";

/**
 * Action to update the protocol UTxO when rolling forward
 */
export async function rollForwardProtocolUtxo(
  client: Db.DensDbClient,
  tx: Readonly<OgmiosSchema.Transaction>,
) {
  const txId: PlaV1.TxId = ogmiosTransactionToPlaTxId(tx);
  const protocolNft = await client.selectProtocolNft();
  const isProtocolUtxo = (txOut: OgmiosSchema.TransactionOutput) => {
    const amount = txOut.value?.[Buffer.from(protocolNft[0]).toString("hex")]
      ?.[Buffer.from(protocolNft[1]).toString("hex")];

    if (amount === undefined) {
      return false;
    }
    return amount > 0n;
  };

  for (let i = 0; i < tx.outputs.length; ++i) {
    const txOut: OgmiosSchema.TransactionOutput = tx.outputs[i]!;
    const txOutRef = { txOutRefId: txId, txOutRefIdx: BigInt(i) };

    if (!isProtocolUtxo(txOut)) {
      continue;
    }

    if (txOut.datum === undefined) {
      continue;
    }

    const plaPlutusData = hexPlutusDataToPlaPlutusData(txOut.datum);

    try {
      const protocol = LbrPlutusV1.IsPlutusData[LbfDens.Protocol]
        .fromData(plaPlutusData);

      await client.insertTxOutRef(txOutRef);
      await client.insertProtocol({ txOutRef, protocol });

      logger.info(
        `Inserted protocol datum as follows\n${
          JSON.stringify(protocol, stringifyReplacer)
        }`,
      );
    } catch (err) {
      if (err instanceof PlaPd.IsPlutusDataError) {
        logger.warn(
          `Failed to decode Protocol's datum ${err}.\nDATUM:\n ${
            JSON.stringify(plaPlutusData, stringifyReplacer)
          } `,
        );
      } else {
        throw err;
      }
    }
  }
}

export async function rollForwardDeleteTxInputs(
  client: Db.DensDbClient,
  tx: Readonly<OgmiosSchema.Transaction>,
) {
  for (const txIn of tx.inputs) {
    const txOutRef = ogmiosTransactionOutputReferenceToPlaTxOutRef(txIn);
    logger.verbose(
      `Consuming TxOutRef: ${JSON.stringify(txOutRef, stringifyReplacer)}`,
    );
    await client.deleteTxOutRef(txOutRef);
  }
}

/**
 * Action to update the the DeNS set elements
 */
export async function rollForwardInsertDensSetElement(
  client: Db.DensDbClient,
  tx: OgmiosSchema.Transaction,
) {
  const txId: PlaV1.TxId = ogmiosTransactionToPlaTxId(tx);
  const densProtocolUtxo = await client.selectProtocol();
  const protocol = densProtocolUtxo?.protocol;

  logger.debug(
    `(SetElem) considering protocol ${
      JSON.stringify(protocol, stringifyReplacer)
    }.`,
  );

  if (protocol === undefined) {
    return;
  }

  /*
   * We identify whether this transaction affects the dens set by testing if
   * it mints the SetElemId token.
   */

  const hasSetElemId = (assets: Readonly<OgmiosSchema.Assets>) => {
    // TODO(jaredponn): document that this always has the empty token name
    const setElemIdCurrencySymbolHex = Buffer.from(
      protocol.setElemMintingPolicy,
    ).toString("hex");
    const setElemAmount = assets?.[setElemIdCurrencySymbolHex]?.[""];
    return setElemAmount !== undefined && setElemAmount > 0n;
  };

  {
    const minted = tx.mint;

    if (minted === undefined) {
      return;
    }

    if (!hasSetElemId(minted)) {
      return;
    }
  }

  logger.info(
    `(SetElem) Transaction id ${
      JSON.stringify(txId, stringifyReplacer)
    } is DeNS Set Element transaction because it mints ${
      JSON.stringify(protocol.setElemMintingPolicy, stringifyReplacer)
    }`,
  );

  /*
   * Find the UTxOs which are related to the set element id
   */
  const outputs: [OgmiosSchema.TransactionOutput, PlaV1.TxOutRef][] = [];
  for (let i = 0; i < tx.outputs.length; ++i) {
    const txOut = tx.outputs[i]!;
    const txOutRef = { txOutRefId: txId, txOutRefIdx: BigInt(i) };
    if (hasSetElemId(txOut.value)) {
      outputs.push([txOut, txOutRef]);
    }
  }

  if (!(outputs.length <= 2)) {
    logger.warn(
      `(SetElem) invalid transaction too many outputs with Set Elem assets. Expected at most two outputs with a SetElem token but got ${outputs.length}. This is most likely a bug in the onchain code. The outputs found are as follows:\n${
        JSON.stringify(outputs, stringifyReplacer)
      }`,
    );
    return;
  }

  /*
   * Update the UTxOs / add them in
   */

  for (const [txOut, txOutRef] of outputs) {
    const datum = txOut.datum;

    if (datum === undefined) {
      logger.warn(
        `(SetElem) invalid transaction output ${
          JSON.stringify(txOutRef, stringifyReplacer)
        } missing datum. Most likely a bug in the onchain code.`,
      );
      continue;
    }

    const plaPlutusData = hexPlutusDataToPlaPlutusData(datum);
    try {
      const setDatum = LbrPlutusV1.IsPlutusData[LbfDens.SetDatum]
        .fromData(plaPlutusData);

      await client.insertTxOutRef(txOutRef);
      await client.upsertDensSetUtxo(
        {
          name: setDatum.key.densName,
          pointer: [
            protocol.elementIdMintingPolicy as unknown as PlaV1.CurrencySymbol,
            elementIdTokenName(setDatum.key),
          ],
          txOutRef,
        },
      );
    } catch (err) {
      if (!(err instanceof PlaPd.IsPlutusDataError)) {
        throw err;
      } else {
        logger.warn(
          `(SetElem) invalid SetElem datum at ${
            JSON.stringify(txOutRef, stringifyReplacer)
          } ${err}\nDATUM:\n ${
            JSON.stringify(plaPlutusData, stringifyReplacer)
          }`,
        );
      }
    }
  }
}

/**
 * Roll forward action for things relating to an element id
 */
export async function rollForwardElemId(
  client: Db.DensDbClient,
  tx: Readonly<OgmiosSchema.Transaction>,
) {
  const protocol = (await client.selectProtocol())?.protocol;

  logger.debug(
    `(ElemId) considering protocol ${
      JSON.stringify(protocol, stringifyReplacer)
    }.`,
  );

  if (protocol === undefined) {
    return;
  }

  // First, we remove all the tx out refs that are consumed.. This will
  // cascade to delete the associated RRs since we want the most recent RRs
  for (const txInput of tx.inputs) {
    client.deleteDensElemIdTxOutRef(
      ogmiosTransactionOutputReferenceToPlaTxOutRef(txInput),
    );
  }

  // Then, we collect all the RRs in the transaction outputs..
  // As a harmless bug, we include all RRs that have a sensible datum when in
  // reality, we really _should_ only include the RRs with a certain address
  const elemIdTnHexToRrs: {
    [keys: string]: [PlaV1.TxOutRef, LbfDens.DensRr][];
  } = {};
  for (let i = 0; i < tx.outputs.length; ++i) {
    const txId: PlaV1.TxId = ogmiosTransactionToPlaTxId(tx);
    const txOut = tx.outputs[i]!;
    const txOutRef = { txOutRefId: txId, txOutRefIdx: BigInt(i) };

    if (txOut.datum === undefined) {
      continue;
    }

    const plaPlutusData = hexPlutusDataToPlaPlutusData(txOut.datum);
    logger.debug(
      `(ElemId) Attempting to parse datum as an RR: ${
        JSON.stringify(plaPlutusData, stringifyReplacer)
      }.`,
    );

    try {
      const recordDatum = LbrPlutusV1.IsPlutusData[LbfDens.RecordDatum]
        .fromData(plaPlutusData);

      const densKey: LbfDens.DensKey = {
        densName: recordDatum.recordName,
        densClass: recordDatum.recordClass,
      };

      const elemIdTn = elementIdTokenName(densKey);
      const elemIdTnHex = Buffer.from(elemIdTn).toString("hex");

      if (elemIdTnHexToRrs[elemIdTnHex] === undefined) {
        elemIdTnHexToRrs[elemIdTnHex] = [];
      }

      const mapped: [PlaV1.TxOutRef, LbfDens.DensRr][] = recordDatum.recordValue
        .map((x) => [txOutRef, x]);
      elemIdTnHexToRrs[elemIdTnHex] = elemIdTnHexToRrs[elemIdTnHex]!.concat(
        mapped,
      );
    } catch (err) {
      if (!(err instanceof PlaPd.IsPlutusDataError)) {
        throw err;
      }
    }
  }

  logger.verbose(
    `(ElemId) ElemId token names mapping to candidate RRs: ${
      JSON.stringify(elemIdTnHexToRrs, stringifyReplacer)
    }.`,
  );

  const elemIdCurrencySymbol = protocol
    .elementIdMintingPolicy as unknown as PlaV1.CurrencySymbol;
  const getElemIdTokens = (value: OgmiosSchema.Value): PlaV1.TokenName[] => {
    const elemIdCurrencySymbolHex = Buffer.from(elemIdCurrencySymbol).toString(
      "hex",
    );

    const elemIdTns = value[elemIdCurrencySymbolHex];

    if (elemIdTns === undefined) {
      return [];
    }

    const result: PlaV1.TokenName[] = [];
    for (const [k, v] of Object.entries(elemIdTns)) {
      if (v > 0n) {
        result.push(
          Uint8Array.from(Buffer.from(k, "hex")) as unknown as PlaV1.TokenName,
        );
      }
    }
    return result;
  };

  // TODO(jaredponn): probably can better async here
  for (let i = 0; i < tx.outputs.length; ++i) {
    const txId: PlaV1.TxId = ogmiosTransactionToPlaTxId(tx);
    const txOut = tx.outputs[i]!;
    const txOutRef = { txOutRefId: txId, txOutRefIdx: BigInt(i) };

    const elemIdTns = getElemIdTokens(txOut.value);

    for (const tn of elemIdTns) {
      logger.info(
        `(ElemId) transaction output ${
          JSON.stringify(txOutRef, stringifyReplacer)
        } contains ElemID asset class ${
          JSON.stringify([elemIdCurrencySymbol, tn], stringifyReplacer)
        }.`,
      );

      const elemAssetClass: PlaV1.AssetClass = [elemIdCurrencySymbol, tn];

      const tnHex = Buffer.from(tn).toString("hex");
      const rrs = elemIdTnHexToRrs[tnHex];

      if (rrs === undefined) {
        continue;
      }

      await client.insertTxOutRef(txOutRef);
      await client.insertDensElemIdUtxo(elemAssetClass, txOutRef);

      for (const [_rrTxOutRef, rr] of rrs) {
        await client.insertDensRr(
          { elemTxOutRef: txOutRef, elemAssetClass },
          rr,
        );
      }
    }
  }
}

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
  logger.info(
    `Rolling forward to ${block.id} at slot ${
      `slot` in block ? block.slot : "<no slot>"
    }`,
  );
  logger.verbose(
    `Current Protocol AssetClass: ("${
      Buffer.from(protocolNft[0]).toString("hex")
    }", "${Buffer.from(protocolNft[1]).toString("hex")}")`,
  );

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
    await db.densWithDbClient(async (client) => {
      // TODO(jaredponn): we really want REPEATABLE READ isolation level.
      // Doesn't seem like much of a bug for now -- there really _should_ only
      // be one writer at a time.
      await client.insertPoint(point);

      for (const tx of txs) {
        // NOTE(jaredponn): the order of these actions are important and
        // dependent on specifics of the protocol
        await rollForwardProtocolUtxo(client, tx);
        await rollForwardInsertDensSetElement(client, tx);
        await rollForwardElemId(client, tx);

        await rollForwardDeleteTxInputs(client, tx);
      }
      // TODO(jaredponn): we really should scan through other outputs like
      // the collateralReturn output.
      // But! The offchain code really shouldn't generate a useful DeNS
      // output as a collateralReturn output
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
  logger.info(
    `Rolling backwards to ${
      point === "origin" ? "origin" : `${point.id} at slot ${point.slot}`
    }`,
  );

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
    const myUrl = new url.URL(ogmiosConfig.url);
    super(myUrl);
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
 *     2.3 Gets 2 of the next blocks.
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
  logger.info(`Started synchronizing with Ogmios via ${ogmiosConfig.url}`);
  const client = new ChainSync(ogmiosConfig);

  await db.densWithDbClient((dbClient) => {
    return dbClient.setProtocolNft(protocolNft);
  });

  while (1) {
    protocolNft = await db.densWithDbClient((dbClient) => {
      return dbClient.syncProtocolNft(protocolNft);
    });

    const recentPoints: (OgmiosSchema.Point | "origin")[] = await db
      .densWithDbClient((dbClient) => {
        return dbClient.recentPoints();
      }).then((points) => points.map(plaPointToOgmiosPoint));

    recentPoints.push("origin");

    client.findIntersection(recentPoints);

    let resolveBatch: (value?: unknown) => void;
    const task = new Promise((resolve) => resolveBatch = resolve);

    let numberOfRequests = 100;

    const callback = async (msg: Buffer | Buffer[] | ArrayBuffer) => {
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
        } else {
          client.nextBlock();
        }
      } else {
        throw new Error(`Unexpected response from Ogmios:\n\t${msg}`);
      }
    };

    client.on("message", callback);

    client.nextBlock();

    await task;

    client.off("message", callback);
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

/**
 * @internal
 * NOTE(jaredponn): we abuse csl in weird ways to get the right
 * hash out of it.
 *  - Recall token names are 32 bytes <https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Value.hs#L99-L112>
 *  - Note that hash_plutus_data from csl uses blake2b256 which is a 32 byte image <https://github.com/Emurgo/cardano-serialization-lib/blob/4a35ef11fd5c4931626c03025fe6f67743a6bdf9/rust/src/utils.rs#L1246-L1249>
 *  So, we can use this for our purposes.
 */
export function elementIdTokenName(
  densKey: LbfDens.DensKey,
): PlaV1.TokenName {
  const cslPd = plaPlutusDataToCslPlutusData(
    LbrPlutusV1.IsPlutusData[LbfDens.DensKey].toData(densKey),
  );
  const cslDataHash = csl.hash_plutus_data(cslPd);

  const result = Buffer.from(cslDataHash.to_hex(), "hex");

  cslPd.free();
  cslDataHash.free();

  return Uint8Array.from(result) as PlaV1.TokenName;
}

export function ogmiosTransactionToPlaTxId(
  tx: OgmiosSchema.Transaction,
): PlaV1.TxId {
  return Prelude.fromJust(
    PlaV1.txIdFromBytes(Uint8Array.from(Buffer.from(tx.id, "hex"))),
  );
}

/**
 * A "replacer" for `JSON.stringify` which:
 *  - allows printing of big ints
 *  - prints byte arrays in the hexadecimal representation
 */
function stringifyReplacer(_key: unknown, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  } else if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  } else {
    return value;
  }
}
