import * as L from "lucid-cardano";
import {
  DensKey,
  DensValue,
  Protocol,
  RecordDatum,
  SetDatum,
  SetInsert,
} from "lbf-dens/LambdaBuffers/Dens.mjs";
import { IsPlutusData } from "lbr-plutus/PlutusData.js";
import * as Pla from "plutus-ledger-api/PlutusData.js";
import * as csl from "@emurgo/cardano-serialization-lib-nodejs";
import { fromJust } from "prelude";
import { scriptHashFromBytes } from "plutus-ledger-api/V1.js";

type DeNSParams = {
  setValidator: L.SpendingValidator;
  recordValidator: L.SpendingValidator;
  setElemIDPolicy: L.MintingPolicy;
  elemIDPolicy: L.MintingPolicy;
  protocolPolicy: L.MintingPolicy;
};

const mkLBScriptHash = (script: L.SpendingValidator) => {
  return fromJust(
    scriptHashFromBytes(L.fromHex(L.applyDoubleCborEncoding(script.script))),
  );
};

const initializeDeNS = async (
  lucid: L.Lucid,
  params: DeNSParams,
): Promise<L.Tx> => {
  const builder = new L.Tx(lucid);
  const utils = new L.Utils(lucid);

  const initialSetDatum: SetDatum = undefined;
  const initialSetDatumPD = IsPlutusData[SetDatum].toData(initialSetDatum);
  const initialSetDatumCSL = (toCslPlutusData(initialSetDatumPD)).to_hex();
  const initialSetDatumDatum: L.OutputData = { inline: initialSetDatumCSL };

  const protocolDatumRaw: Protocol = {
    elementIdMintingPolicy: mkLBScriptHash(params.elemIDPolicy),
    setElemMintingPolicy: mkLBScriptHash(params.setElemIDPolicy),
    setValidator: mkLBScriptHash(params.setValidator),
    recordsValidator: mkLBScriptHash(params.recordValidator),
  };

  const protocolDatum: L.OutputData = {
    inline: toCslPlutusData(IsPlutusData[Protocol].toData(protocolDatumRaw))
      .to_hex(),
  };

  const findProtocolOut: () => Promise<L.UTxO> = undefined;

  const protocolOut = await findProtocolOut();

  // Mint one protocol token
  const protocolPolicyID = utils.mintingPolicyToId(params.protocolPolicy);
  const oneProtocolToken = { [protocolPolicyID]: BigInt(1) };

  // Mint one setElem token
  const setElemPolicyID = utils.mintingPolicyToId(params.setElemIDPolicy);
  const oneSetElemToken = { [setElemPolicyID]: BigInt(1) };

  const setValidatorAddr = utils.validatorToAddress(params.setValidator);

  // TODO: Figure out how to make a unit datum
  return builder
    .mintAssets(oneProtocolToken)
    .mintAssets(oneSetElemToken)
    .payToAddressWithData(
      setValidatorAddr,
      initialSetDatumDatum,
      oneSetElemToken,
    )
    .payToAddressWithData(setValidatorAddr, protocolDatum, oneProtocolToken)
    .collectFrom([protocolOut]);
};

const registerDomain = async (
  lucid: L.Lucid,
  params: DeNSParams,
  domain: string,
): Promise<L.Tx> => {
  const builder = new L.Tx(lucid);
  const utils = new L.Utils(lucid);

  const oneSetElemToken = {
    [utils.mintingPolicyToId(params.setElemIDPolicy)]: BigInt(1),
  };

  const newSetDatumL: L.OutputData = undefined;
  const newSetDatumR: L.OutputData = undefined;

  const elemIDPolicy = utils.mintingPolicyToId(params.elemIDPolicy);
  const elemIDAssetClass: L.Unit = elemIDPolicy + L.fromText(domain);

  const oneElemIDToken = { [elemIDAssetClass]: BigInt(1) };

  const findOldSetDatumUTxO: () => Promise<L.UTxO> = undefined;

  const oldSetDatumUTxO = await findOldSetDatumUTxO();

  const findProtocolOut: () => Promise<L.UTxO> = undefined;

  const protocolOut = await findProtocolOut();

  const setValidatorAddr = utils.validatorToAddress(params.setValidator);

  return builder // TODO: null redeemers
    .mintAssets(oneSetElemToken)
    .mintAssets(oneElemIDToken)
    .readFrom([protocolOut])
    .collectFrom([oldSetDatumUTxO])
    .payToAddressWithData(setValidatorAddr, newSetDatumL, oneSetElemToken)
    .payToAddressWithData(setValidatorAddr, newSetDatumR, oneSetElemToken);
};

const updateRecord = async (
  lucid: L.Lucid,
  params: DeNSParams,
  user: L.Address,
  domain: string,
  record: RecordDatum,
) => {
  const builder = new L.Tx(lucid);
  const utils = new L.Utils(lucid);

  const recValidatorAddr = utils.validatorToAddress(params.recordValidator);

  const elemIDPolicy = utils.mintingPolicyToId(params.elemIDPolicy);
  const elemIDAssetClass: L.Unit = elemIDPolicy + L.fromText(domain);

  const elemIDToken = { [elemIDAssetClass]: BigInt(1) };

  const findProtocolOut: () => Promise<L.UTxO> = undefined;

  const protocolOut = await findProtocolOut();

  const findElemIDUTxO: () => Promise<L.UTxO> = undefined;

  const elemIDUTxO: L.UTxO = await findElemIDUTxO();

  const recordDatum: L.OutputData = {
    inline: toCslPlutusData(IsPlutusData[RecordDatum].toData(record)).to_hex(),
  };

  return builder
    .readFrom([protocolOut])
    .collectFrom([elemIDUTxO])
    .payToAddressWithData(recValidatorAddr, recordDatum, {
      lovelace: BigInt(0),
    })
    .payToAddress(user, elemIDToken);
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
