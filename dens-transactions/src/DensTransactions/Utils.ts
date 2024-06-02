import * as L from "lucid-cardano";

import {
  DensKey,
  DensRr,
  RecordDatum,
  SetDatum,
} from "lbf-dens/LambdaBuffers/Dens.mjs";
import { IsPlutusData } from "lbr-plutus/PlutusData.js";
import * as Pla from "plutus-ledger-api/PlutusData.js";
import * as PlaV1 from "plutus-ledger-api/V1.js";
import * as csl from "@emurgo/cardano-serialization-lib-nodejs";
import { fromJust } from "prelude";
import {
  currencySymbolFromBytes,
  scriptHashFromBytes,
} from "plutus-ledger-api/V1.js";
import { got, HTTPError } from "got";
import * as FakeProvider from "./FakeProvider.js";
import elemIdMPEnvelope from "./scripts/mkElemIDMintingPolicy.json" with {
  type: "json",
};
import setElemMPEnvelope from "./scripts/mkSetElemMintingPolicy.json" with {
  type: "json",
};
import protocolMPEnvelope from "./scripts/mkProtocolMintingPolicy.json" with {
  type: "json",
};
import recordEnvelope from "./scripts/mkRecordValidator.json" with {
  type: "json",
};
import setValEnvelope from "./scripts/mkSetValidator.json" with {
  type: "json",
};
import { logger } from "./Logger.js";
import { UnixDomainOrInternetDomain } from "lbf-dens-db/LambdaBuffers/Dens/Config.mjs";

// deno-lint-ignore no-explicit-any
(BigInt as unknown as any).prototype["toJSON"] = function () {
  return this.toString();
};

export async function mkLucid(
  ogmiosHost: string,
  ogmiosPort: number,
  network: L.Network,
): Promise<L.Lucid> {
  const fakeProvider = new FakeProvider.OgmiosOnly(
    ogmiosHost,
    ogmiosPort,
    network,
  );
  return await L.Lucid.new(fakeProvider, network);
}

export const mkParams = async (
  lucid: L.Lucid,
  ref: L.OutRef,
  path: UnixDomainOrInternetDomain,
): Promise<DeNSParams> => {
  const utils = new L.Utils(lucid);

  const outRef: PlaV1.TxOutRef = {
    txOutRefId: fromJust(PlaV1.txIdFromBytes(Buffer.from(ref.txHash, "hex"))),
    txOutRefIdx: BigInt(ref.outputIndex),
  };

  const protocolPolicy: L.MintingPolicy = {
    type: "PlutusV2",
    script: L.applyParamsToScript(protocolMPEnvelope.rawHex, [
      plaPdToLucidPd(PlaV1.isPlutusDataTxOutRef.toData(outRef)),
    ]),
  };

  const protocolCS = utils.validatorToScriptHash(protocolPolicy);

  await setProtocolNFT(path, protocolCS);

  const setValidator: L.SpendingValidator = {
    type: "PlutusV2",
    script: L.applyParamsToScript(setValEnvelope.rawHex, [protocolCS]),
  };

  const recordValidator: L.SpendingValidator = {
    type: "PlutusV2",
    script: L.applyParamsToScript(recordEnvelope.rawHex, [protocolCS]),
  };

  const setElemIDPolicy: L.MintingPolicy = {
    type: "PlutusV2",
    script: L.applyParamsToScript(setElemMPEnvelope.rawHex, [protocolCS]),
  };

  const elemIDPolicy: L.MintingPolicy = {
    type: "PlutusV2",
    script: L.applyParamsToScript(elemIdMPEnvelope.rawHex, [protocolCS]),
  };
  return {
    setValidator: setValidator,
    recordValidator: recordValidator,
    setElemIDPolicy: setElemIDPolicy,
    elemIDPolicy: elemIDPolicy,
    protocolPolicy: protocolPolicy,
  };
};

export const signAndSubmitTx = async (tx: L.Tx) => {
  const complete = await tx.complete().catch((e) => {
    throw new Error("Error when completing tx:\n" + e);
  });
  const signed = complete.sign();
  const readyToSubmit = await signed.complete().catch((e) => {
    throw new Error("Error when completing signed tx:\n" + e);
  });

  const hash = await readyToSubmit.submit().catch((e) => {
    throw new Error(
      `Error when submitting tx:\n${e}\nTx is as follows:\n${
        JSON.stringify(readyToSubmit.txSigned.to_js_value())
      }`,
    );
  });
  return hash;
};

export const mkDensKey = (domain: string): DensKey => {
  return { densName: Buffer.from(domain), densClass: BigInt(0) };
};

type ProtocolResponseBody = {
  txOutRef: { transaction_id: string; index: number };
  protocol: {
    elementIdMintingPolicy: string;
    setElemMintingPolicy: string;
    setValidator: string;
    recordsValidator: string;
  };
};

type ProtocolResponse = {
  name: string;
  fields: Array<ProtocolResponseBody>;
};

export const unsafeCurrSymb = (x: string) => {
  return fromJust(currencySymbolFromBytes(Buffer.from(x)));
};

export const emptyCS = unsafeCurrSymb("");

export const isUnixDomain = (domain: UnixDomainOrInternetDomain): boolean => {
  return (domain.name === "UnixDomain");
};

export const mkDomainPath = (
  domain: UnixDomainOrInternetDomain,
  endpoint: string,
): string => {
  if (domain.name === "UnixDomain") {
    const path = domain.fields.path;
    return ("http://unix:" + path + ":" + endpoint); // "/api/query-protocol-utxo")
  } else {
    const url = new URL(domain.fields.host);
    url.port = domain.fields.port.toString();
    return (url.toString() + endpoint);
  }
};

export const findProtocolOut: (
  lucid: L.Lucid,
  path: UnixDomainOrInternetDomain,
) => Promise<L.UTxO> = async (
  lucid: L.Lucid,
  path: UnixDomainOrInternetDomain,
) => {
  logger.debug("findProtocolOut");
  const endpoint = "/api/query-protocol-utxo";
  const domainPath = mkDomainPath(path, endpoint);
  const data = await got(domainPath, {
    method: "post",
    headers: { "Content-Type": "application/json" },
    json: {},
    enableUnixSockets: isUnixDomain(path),
  }).json().catch((err) => {
    // Patch the exception s.t. we can see the response body in the generated error message
    if (err instanceof HTTPError) {
      const body = JSON.stringify(err.response.body, null, 4);
      if (err.message === undefined) {
        throw new Error(body);
      } else {
        throw new Error(`${err.message}\n` + body);
      }
    }
    throw err;
  });
  logger.debug("protocol response data: " + JSON.stringify(data, null, 4));

  const protocolResponse = data as ProtocolResponse;

  const txOutRef = protocolResponse.fields[0].txOutRef.transaction_id;
  const txOutRefIx = protocolResponse.fields[0].txOutRef.index;

  const utxos = await lucid.provider.getUtxosByOutRef(
    [{ txHash: txOutRef, outputIndex: txOutRefIx }],
  );

  logger.debug("protocol response utxos: " + JSON.stringify(utxos, null, 4));

  return utxos[0];
};

type SetDatumQueryResult = { setDatumUTxO: L.UTxO; setDatum: SetDatum };

type SetDatumResponseBody = {
  name: string;
  pointer: {
    currency_symbol: string;
    token_name: string;
  };
  txOutRef: {
    transaction_id: string;
    index: number;
  };
};

type SetDatumResponse = { name: string; fields: Array<SetDatumResponseBody> };

export const findOldSetDatum: (
  lucid: L.Lucid,
  path: UnixDomainOrInternetDomain,
  domain: string,
) => Promise<SetDatumQueryResult> = async (
  lucid: L.Lucid,
  path: UnixDomainOrInternetDomain,
  domain: string,
) => {
  const hexDomain = Buffer.from(domain).toString("hex");
  const endpoint = "/api/query-set-insertion-utxo";
  const domainPath = mkDomainPath(path, endpoint);

  const data = await got(
    domainPath,
    {
      method: "post",
      json: { name: hexDomain },
      headers: { "Content-Type": "application/json" },
      enableUnixSockets: isUnixDomain(path),
    },
  ).json().catch((err) => {
    // Patch the exception s.t. we can see the response body in the generated error message
    if (err instanceof HTTPError) {
      const body = JSON.stringify(err.response.body, null, 4);
      if (err.message === undefined) {
        throw new Error(body);
      } else {
        throw new Error(`${err.message}\n` + body);
      }
    }
    throw err;
  });

  const setDatumResponse = data as SetDatumResponse;

  logger.debug("findOldSetDatum: " + JSON.stringify(setDatumResponse, null, 4));

  logger.debug(
    "responseField0: " + JSON.stringify(setDatumResponse.fields[0].txOutRef),
  );

  const txOutRef = setDatumResponse.fields[0].txOutRef.transaction_id;
  const txOutRefIx = setDatumResponse.fields[0].txOutRef.index;

  const utxos = await lucid.provider.getUtxosByOutRef([{
    txHash: txOutRef,
    outputIndex: txOutRefIx,
  }]);

  const setDatumUtxo = utxos[0];

  const setDatum = IsPlutusData[SetDatum].fromData(
    toPlaPlutusData(L.C.PlutusData.from_bytes(L.fromHex(setDatumUtxo.datum))),
  );

  return { setDatumUTxO: setDatumUtxo, setDatum: setDatum };
};

export const setProtocolNFT = async (
  path: UnixDomainOrInternetDomain,
  protocolCS: string,
) => {
  const endpoint = "/api/set-protocol-nft";
  const domainPath = mkDomainPath(path, endpoint);
  const body = { protocolNft: { currency_symbol: protocolCS, token_name: "" } };

  const data = await got(domainPath, {
    method: "post",
    json: body,
    headers: { "Content-Type": "application/json" },
    enableUnixSockets: isUnixDomain(path),
  }).json();

  logger.debug("set protocol nft response:\n" + JSON.stringify(data, null, 4));
};

// TODO: Figure out if lucid exposes any utilities for filtering wallet UTxOs.
export const findElemIDUTxO = async (
  assetClass: string,
  lucid: L.Lucid,
): Promise<L.UTxO> => {
  const walletUtxos = await lucid.wallet.getUtxos();

  // TODO: Comically unsafe, do better error handling
  return walletUtxos.filter((x) => x.assets[assetClass] >= 1)[0];
};

export type DeNSParams = {
  setValidator: L.SpendingValidator;
  recordValidator: L.SpendingValidator;
  setElemIDPolicy: L.MintingPolicy;
  elemIDPolicy: L.MintingPolicy;
  protocolPolicy: L.MintingPolicy;
};

// Hopefully I'm getting the encoding right...
export const initialSetDatum: SetDatum = {
  key: mkDensKey(""),
  next: mkDensKey(
    "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
  ),
  ownerApproval: emptyCS,
};

export const mkLBScriptHash = (script: L.SpendingValidator) => {
  const hash = L.C.PlutusScript.from_bytes(
    L.fromHex(script.script),
  )
    .hash(L.C.ScriptHashNamespace.PlutusV2)
    .to_bytes();
  return fromJust(
    scriptHashFromBytes(hash),
  );
};

/**
 * Converts the PlutusData type from plutus-ledger-api into the equivalent type
 * from Lucid
 *
 * @private TODO(jaredponn): this needs the inverse function + testing.
 */
export function plaPdToLucidPd(plutusData: Pla.PlutusData): L.Data {
  switch (plutusData.name) {
    case `Integer`: {
      return plutusData.fields;
    }
    case `Bytes`: {
      return Buffer.from(plutusData.fields).toString("hex");
    }
    case `List`: {
      return plaPdListToLucidPdList(plutusData.fields);
    }
    case `Constr`: {
      return new L.Constr(
        Number(plutusData.fields[0]),
        plaPdListToLucidPdList(plutusData.fields[1]),
      );
    }
    case `Map`: {
      const result: Map<L.Data, L.Data> = new Map();

      for (const [k, v] of plutusData.fields) {
        result.set(plaPdToLucidPd(k), plaPdToLucidPd(v));
      }

      return result;
    }
  }
}

/**
 * @internal
 */
function plaPdListToLucidPdList(listOfPlutusData: Pla.PlutusData[]): L.Data[] {
  const result: L.Data[] = [];
  for (const x of listOfPlutusData) {
    result.push(plaPdToLucidPd(x));
  }
  return result;
}

export function toCslPlutusData(
  plutusData: Pla.PlutusData,
): csl.PlutusData {
  switch (plutusData.name) {
    case "Integer":
      return csl.PlutusData.new_integer(
        csl.BigInt.from_str(plutusData.fields.toString()),
      );
    case "Bytes":
      return csl.PlutusData.new_bytes(plutusData.fields);
    case "List":
      return csl.PlutusData.new_list(
        plaPdListToCslPlutusList(plutusData.fields),
      );
    case "Constr":
      return csl.PlutusData.new_constr_plutus_data(
        csl.ConstrPlutusData.new(
          csl.BigNum.from_str(plutusData.fields[0].toString()),
          plaPdListToCslPlutusList(plutusData.fields[1]),
        ),
      );
    case "Map": {
      const plutusMap = csl.PlutusMap.new();
      for (const elem of plutusData.fields) {
        plutusMap.insert(
          toCslPlutusData(elem[0]),
          toCslPlutusData(elem[1]),
        );
      }
      return csl.PlutusData.new_map(plutusMap);
    }
  }
}

function plaPdListToCslPlutusList(list: Pla.PlutusData[]): csl.PlutusList {
  const result = csl.PlutusList.new();

  for (const elem of list) {
    result.add(toCslPlutusData(elem));
  }
  return result;
}

export function toPlaPlutusData(
  plutusData: L.C.PlutusData,
): Pla.PlutusData {
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
    const result: [Pla.PlutusData, Pla.PlutusData][] = [];

    for (let i = 0; i < keys.len(); ++i) {
      const k = keys.get(i);
      result.push([
        toPlaPlutusData(k),
        toPlaPlutusData(map.get(k)!),
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

function cslPlutusListToPlaPdList(list: L.C.PlutusList): Pla.PlutusData[] {
  const result = [];
  for (let i = 0; i < list.len(); ++i) {
    result.push(toPlaPlutusData(list.get(i)));
  }
  return result;
}

export function elementIdTokenName(
  name: string,
): string {
  const key = mkDensKey(name);
  const cslPd = toCslPlutusData(IsPlutusData[DensKey].toData(key));
  const cslDataHash = csl.hash_plutus_data(cslPd);

  const result = cslDataHash.to_hex();
  return result;
}

/**
 *  Utilities for constructin Dens Records
 */
export const mkRecordDatum = (
  domain: string,
  records: Array<DensRr>,
): RecordDatum => {
  return {
    recordClass: BigInt(0),
    recordName: Buffer.from(domain),
    recordOwner: fromJust(
      PlaV1.pubKeyHashFromBytes(Buffer.from("1234567890123456789012345678")),
    ),
    recordValue: records,
  };
};

export const mkARecord = (record: string, ttl: number): DensRr => {
  return {
    ttl: BigInt(ttl),
    rData: {
      name: "A",
      fields: Buffer.from(record),
    },
  };
};

export const mkAAAARecord = (record: string, ttl: number): DensRr => {
  return {
    ttl: BigInt(ttl),
    rData: {
      name: "AAAA",
      fields: Buffer.from(record),
    },
  };
};

export const mkSOARecord = (record: string, ttl: number): DensRr => {
  return {
    ttl: BigInt(ttl),
    rData: {
      name: "SOA",
      fields: Buffer.from(record),
    },
  };
};
