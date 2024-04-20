import * as L from "lucid-cardano";

import {
  DensKey,
  SetDatum,
} from "lbf-dens/LambdaBuffers/Dens.mjs";
import { IsPlutusData } from "lbr-plutus/PlutusData.js";
import * as Pla from "plutus-ledger-api/PlutusData.js";
import * as csl from "@emurgo/cardano-serialization-lib-nodejs";
import { fromJust } from "prelude";
import { currencySymbolFromBytes, scriptHashFromBytes } from "plutus-ledger-api/V1.js";
import fetch from 'node-fetch'

const serverBaseUrl: string = "www.test.com";

export const mkDensKey = (domain: string): DensKey => {
  return  {densName: Buffer.from(domain,'utf8'), densClass: BigInt(0)}
}

type ProtocolResponseBody = {
    txOutRef: {txOutRef: string, txOutRefIx: number},
    protocol: {
        elementIdMintingPolicy: string,
        setElemMintingPolicy: string,
        setValidator: string,
        recordsValidator: string
    }
}

type ProtocolResponse = {
    name: string,
    fields: Array<ProtocolResponseBody>
}

export const unsafeCurrSymb = (x: string) => {
  return fromJust(currencySymbolFromBytes(Buffer.from(x,'utf8')))
}

export const emptyCS = unsafeCurrSymb("");

export const findProtocolOut: (lucid: L.Lucid) => Promise<L.UTxO> = async (lucid: L.Lucid) => {
    const response = await fetch(serverBaseUrl + '/api/protocol-utxo', {
        method: 'post',
        body: JSON.stringify({}),
        headers: {'Content-Type': 'application/json'}
    });

    const data = await response.json();

    const protocolResponse = data as ProtocolResponse;

    const txOutRef = protocolResponse.fields[0].txOutRef.txOutRef;
    const txOutRefIx = protocolResponse.fields[0].txOutRef.txOutRefIx;

    const utxos = await lucid.utxosByOutRef([{txHash: txOutRef, outputIndex: txOutRefIx}])

    return utxos[0]
};


type SetDatumQueryResult = {setDatumUTxO: L.UTxO, setDatum: SetDatum}

type SetDatumResponseBody = {
    name: string,
    pointer: {
      currency_symbol: string,
      token_name: string
     },
    txOutRef: {
      txOutRef: string,
      txOutRefIx: number
    }
  }

type SetDatumResponse = {name: string, fields: Array<SetDatumResponseBody>}

export const findOldSetDatum: (lucid: L.Lucid, domain: string) => Promise<SetDatumQueryResult> = async (lucid: L.Lucid, domain: string) => {
    const hexDomain = Buffer.from(domain,'utf8').toString('hex');

    const response = await fetch(serverBaseUrl + '/api/protocol-utxo', {
        method: 'post',
        body: JSON.stringify({name: hexDomain}),
        headers: {'Content-Type': 'application/json'}
    });

    const data = await response.json()

    const setDatumResponse = data as SetDatumResponse;

    const txOutRef = setDatumResponse.fields[0].txOutRef.txOutRef;
    const txOutRefIx = setDatumResponse.fields[0].txOutRef.txOutRefIx;

    const utxos = await lucid.utxosByOutRef([{txHash: txOutRef, outputIndex: txOutRefIx}])

    const setDatumUtxo = utxos[0];

    const setDatum = IsPlutusData[SetDatum].fromData(toPlaPlutusData(L.C.PlutusData.from_bytes(L.fromHex(setDatumUtxo.datum))));

    return {setDatumUTxO: setDatumUtxo, setDatum: setDatum}
};

// TODO: Figure out if lucid exposes any utilities for filtering wallet UTxOs.
export const findElemIDUTxO = async (assetClass: string, lucid: L.Lucid): Promise<L.UTxO> => {
    const walletUtxos = await lucid.wallet.getUtxos();

    // TODO: Comically unsafe, do better error handling
    return walletUtxos.filter(x => x.assets[assetClass] >= 1)[0]
}

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
  next: mkDensKey("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"),
  ownerApproval: emptyCS
}

export const mkLBScriptHash = (script: L.SpendingValidator) => {
  return fromJust(
    scriptHashFromBytes(L.fromHex(L.applyDoubleCborEncoding(script.script))),
  );
};

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
