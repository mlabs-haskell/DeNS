import * as L from "lucid-cardano";
import {
  DensKey,
  Protocol,
  RecordDatum,
  SetDatum,
} from "lbf-dens/LambdaBuffers/Dens.mjs";
import { IsPlutusData } from "lbr-plutus/PlutusData.js";
import * as Utils  from "./Utils.js"

export const initializeDeNS = async (
  lucid: L.Lucid,
  params: Utils.DeNSParams,
): Promise<L.Tx> => {
  const builder = new L.Tx(lucid);
  const utils = new L.Utils(lucid);

  const initialSetDatumPD = IsPlutusData[SetDatum].toData(Utils.initialSetDatum);
  const initialSetDatumCSL = (Utils.toCslPlutusData(initialSetDatumPD)).to_hex();
  const initialSetDatumDatum: L.OutputData = { inline: initialSetDatumCSL };

  const protocolDatumRaw: Protocol = {
    elementIdMintingPolicy: Utils.mkLBScriptHash(params.elemIDPolicy),
    setElemMintingPolicy: Utils.mkLBScriptHash(params.setElemIDPolicy),
    setValidator: Utils.mkLBScriptHash(params.setValidator),
    recordsValidator: Utils.mkLBScriptHash(params.recordValidator),
  };

  const protocolDatum: L.OutputData = {
    inline: Utils.toCslPlutusData(IsPlutusData[Protocol].toData(protocolDatumRaw))
      .to_hex(),
  };

  const protocolOut = await Utils.findProtocolOut(lucid);

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

export const registerDomain = async (
  lucid: L.Lucid,
  params: Utils.DeNSParams,
  domain: string,
): Promise<L.Tx> => {
  const builder = new L.Tx(lucid);
  const utils = new L.Utils(lucid);

  const oneSetElemToken = {
    [utils.mintingPolicyToId(params.setElemIDPolicy)]: BigInt(1),
  };

  const setDatumResponse = await Utils.findOldSetDatum(lucid,domain);

  const oldSetDatum = setDatumResponse.setDatum;
  const oldSetDatumUtxo = setDatumResponse.setDatumUTxO;

  const k: DensKey = oldSetDatum.key;
  const nxt: DensKey = oldSetDatum.next;

  const sdl: SetDatum = {key: k,
                         next: {densName: Buffer.from(domain,'utf8'), densClass: BigInt(0)},
                         ownerApproval: Utils.emptyCS
                        };
  const sdr: SetDatum = {key: {densName: Buffer.from(domain,'utf8'), densClass: BigInt(0)},
                         next: nxt,
                         ownerApproval: Utils.emptyCS
                        };


  const newSetDatumL: L.OutputData = {inline: Utils.toCslPlutusData(IsPlutusData[SetDatum].toData(sdl)).to_hex()};
  const newSetDatumR: L.OutputData = {inline: Utils.toCslPlutusData(IsPlutusData[SetDatum].toData(sdr)).to_hex()};

  const elemIDPolicy = utils.mintingPolicyToId(params.elemIDPolicy);
  const elemIDAssetClass: L.Unit = elemIDPolicy + L.fromText(domain);

  const oneElemIDToken = { [elemIDAssetClass]: BigInt(1) };

  const protocolOut = await Utils.findProtocolOut(lucid);

  const setValidatorAddr = utils.validatorToAddress(params.setValidator);

  return builder // TODO: null redeemers
    .mintAssets(oneSetElemToken)
    .mintAssets(oneElemIDToken)
    .readFrom([protocolOut])
    .collectFrom([oldSetDatumUtxo])
    .payToAddressWithData(setValidatorAddr, newSetDatumL, oneSetElemToken)
    .payToAddressWithData(setValidatorAddr, newSetDatumR, oneSetElemToken);
};

export const updateRecord = async (
  lucid: L.Lucid,
  params: Utils.DeNSParams,
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

  const protocolOut = await Utils.findProtocolOut(lucid);


  const elemIDUTxO: L.UTxO = await Utils.findElemIDUTxO(elemIDAssetClass,lucid);

  const recordDatum: L.OutputData = {
    inline: Utils.toCslPlutusData(IsPlutusData[RecordDatum].toData(record)).to_hex(),
  };

  return builder
    .readFrom([protocolOut])
    .collectFrom([elemIDUTxO])
    .payToAddressWithData(recValidatorAddr, recordDatum, {
      lovelace: BigInt(0),
    })
    .payToAddress(user, elemIDToken);
};

