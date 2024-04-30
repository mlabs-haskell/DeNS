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
import { got, Options } from 'got';
import elemIdMPEnvelope from "./scripts/mkElemIDMintingPolicy.json" with {type: "json"};
import setElemMPEnvelope from "./scripts/mkSetElemMintingPolicy.json" with {type: "json"};
import protocolMPEnvelope from "./scripts/mkProtocolMintingPolicy.json" with {type: "json"};
import recordEnvelope from "./scripts/mkRecordValidator.json" with {type: "json"};
import setValEnvelope from "./scripts/mkSetValidator.json" with {type: "json"};

export const mkParams  = async (lucid: L.Lucid, ref: L.OutRef, path: string): Promise<DeNSParams> => {
  const utils = new L.Utils(lucid);
  const OutRefSchema = L.Data.Tuple([L.Data.Bytes(),L.Data.Integer()],{hasConstr: true})

  type OutRefParams = L.Data.Static<typeof OutRefSchema>;
  const OutRefParams = OutRefSchema as unknown as OutRefParams;

  const arg: [string,bigint] = [ref.txHash,BigInt(ref.outputIndex)]

  const protocolPolicy: L.MintingPolicy = {
    type: "PlutusV2",
    script: L.applyParamsToScript(protocolMPEnvelope.rawHex,[ref.txHash,BigInt(ref.outputIndex)])
  }

  const protocolCS = utils.validatorToScriptHash(protocolPolicy);

  const setValidator: L.SpendingValidator = {
    type: "PlutusV2",
    script: L.applyParamsToScript(setValEnvelope.rawHex,[protocolCS])
  }

  const recordValidator: L.SpendingValidator = {
    type: "PlutusV2",
    script: L.applyParamsToScript(recordEnvelope.rawHex,[protocolCS])
  }

  const setElemIDPolicy: L.MintingPolicy = {
    type: "PlutusV2",
    script: L.applyParamsToScript(setElemMPEnvelope.rawHex,[protocolCS])
  }

  const elemIDPolicy: L.MintingPolicy = {
    type: "PlutusV2",
    script: L.applyParamsToScript(elemIdMPEnvelope.rawHex,[protocolCS])
  }

  await setProtocolNFT(path,protocolCS);
  await new Promise(r => setTimeout(r,5000));
  return {
    setValidator: setValidator,
    recordValidator: recordValidator,
    setElemIDPolicy: setElemIDPolicy,
    elemIDPolicy: elemIDPolicy,
    protocolPolicy: protocolPolicy
  }
}

export const signAndSubmitTx = async (lucid: L.Lucid, tx: L.Tx) => {
   const complete = await tx.complete();
   const signed =  complete.sign();
   const readyToSubmit = await signed.complete();
   const hash = await readyToSubmit.submit();
   return hash
}

export const mkDensKey = (domain: string): DensKey => {
  return  {densName: Buffer.from(domain,'utf16le'), densClass: BigInt(0)}
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
  return fromJust(currencySymbolFromBytes(Buffer.from(x,'utf16le')))
}


export const emptyCS = unsafeCurrSymb("");

export const findProtocolOut: (lucid: L.Lucid, path: string) => Promise<L.UTxO> = async (lucid: L.Lucid, path: string) => {
    console.log('findProtocolOut');
    const data = await got('http://unix:' + path + ':/api/query-protocol-utxo', {
        method: 'post',
        headers: {'Content-Type': 'application/json'},
        json: {},
        enableUnixSockets: true
    }).json();

    console.log('protocol response data: ' + JSON.stringify(data,null,4));

    const protocolResponse = data  as ProtocolResponse;

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

export const findOldSetDatum: (lucid: L.Lucid, path: string, domain: string) => Promise<SetDatumQueryResult> = async (lucid: L.Lucid, path: string, domain: string) => {
    const hexDomain = Buffer.from(domain,'utf16le').toString('hex');

    const data = await got('http://unix:' + path + ':/api/query-set-insertion-utxo', {
        method: 'post',
        json: {name: hexDomain},
        headers: {'Content-Type': 'application/json'},
        enableUnixSockets: true
    }).json();


    const setDatumResponse = data as SetDatumResponse;

    const txOutRef = setDatumResponse.fields[0].txOutRef.txOutRef;
    const txOutRefIx = setDatumResponse.fields[0].txOutRef.txOutRefIx;

    const utxos = await lucid.utxosByOutRef([{txHash: txOutRef, outputIndex: txOutRefIx}])

    const setDatumUtxo = utxos[0];

    const setDatum = IsPlutusData[SetDatum].fromData(toPlaPlutusData(L.C.PlutusData.from_bytes(L.fromHex(setDatumUtxo.datum))));

    return {setDatumUTxO: setDatumUtxo, setDatum: setDatum}
};

export const setProtocolNFT = async (path: string, protocolCS: string) => {
  const body = {protocolNft: {currency_symbol: protocolCS, token_name: ""}};

  const data = await got('http://unix:' + path + ":/api/set-protocol-nft",{
    method: 'post',
    json: body,
    headers: {'Content-Type': 'application/json'},
    enableUnixSockets: true
  }).json();

  console.log('set protocol nft response:\n' + JSON.stringify(data,null,4));
}

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
  const hash = L.C.PlutusScript.from_bytes(
          L.fromHex(L.applyDoubleCborEncoding(script.script)),
        )
          .hash(L.C.ScriptHashNamespace.PlutusV2)
          .to_bytes();
  return fromJust(
    scriptHashFromBytes(hash),
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