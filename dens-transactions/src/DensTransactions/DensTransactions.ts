import * as L from "lucid-cardano";
import {
  DensKey,
  Protocol,
  RecordDatum,
  SetDatum,
  SetInsert
} from "lbf-dens/LambdaBuffers/Dens.mjs";
import { IsPlutusData } from "lbr-plutus/PlutusData.js";
import * as Utils  from "./Utils.js"
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
// Scripts


const unit = L.toHex(L.C.PlutusData.new_constr_plutus_data(L.C.ConstrPlutusData.new(L.C.BigNum.zero(),L.C.PlutusList.new())).to_bytes());
console.log('unit: \n' + JSON.stringify(unit,null,4));
// throw new Error('UNIT DATA:\n' + JSON.stringify(unitData,null,0))

//const initialSetInsert: L.Data = Utils.toCslPlutusData(IsPlutusData[SetInsert].toData({name: 'Insert', fields: Utils.mkDensKey("")})).to_hex();

const initSetInsert = () => {
  const innerKey = Utils.toCslPlutusData(IsPlutusData[DensKey].toData(Utils.mkDensKey("")));
  let list = CSL.PlutusList.new();
  list.add(innerKey)
  return CSL.PlutusData.new_list(list);
}

export const mkProtocolOneShot = async (lucid: L.Lucid): Promise<L.OutRef> => {
  const builder = new L.Tx(lucid);
  const myAddr = await lucid.wallet.address();

  const tx = builder.payToAddress(myAddr,{lovelace: BigInt(1)})

  const complete = await tx.complete();
  const signed =  complete.sign();

  const readyToSubmit = await signed.complete();
  const hash = await readyToSubmit.submit();

  await new Promise(r => setTimeout(r, 10000));
  const walletUTXOs = await lucid.wallet.getUtxos();

  const utxoWithHash = walletUTXOs.find(x => x.txHash == hash);

  return {txHash: hash, outputIndex: utxoWithHash.outputIndex}
}

export const initializeDeNS = async (
  lucid: L.Lucid,
  params: Utils.DeNSParams,
  path: string,
  oneShotOutRef: L.OutRef
): Promise<L.Tx> => {
  console.log('a')
  const builder = new L.Tx(lucid);
  const utils = new L.Utils(lucid);
  console.log('b')
  const initialSetDatumPD = IsPlutusData[SetDatum].toData(Utils.initialSetDatum);
  console.log('c')
  const initialSetDatumCSL = (Utils.toCslPlutusData(initialSetDatumPD)).to_hex();
  console.log('d')
  const initialSetDatumDatum: L.OutputData = { inline: initialSetDatumCSL };
  console.log('e')
  const protocolDatumRaw: Protocol = {
    elementIdMintingPolicy: Utils.mkLBScriptHash(params.elemIDPolicy),
    setElemMintingPolicy: Utils.mkLBScriptHash(params.setElemIDPolicy),
    setValidator: Utils.mkLBScriptHash(params.setValidator),
    recordsValidator: Utils.mkLBScriptHash(params.recordValidator),
  };
  console.log('f')
  const protocolDatum: L.OutputData = {
    inline: Utils.toCslPlutusData(IsPlutusData[Protocol].toData(protocolDatumRaw))
      .to_hex(),
  };
  console.log('g')
  const oneShotUtxos = await lucid.utxosByOutRef([oneShotOutRef]);
  const oneShotUtxo = oneShotUtxos[0];
  console.log('h')
  // Mint one protocol token
  const protocolPolicyID = utils.mintingPolicyToId(params.protocolPolicy);
  console.log('i')
  const oneProtocolToken = { [protocolPolicyID]: BigInt(1) };
  console.log('j')
  // Mint one setElem token
  const setElemPolicyID = utils.mintingPolicyToId(params.setElemIDPolicy);
  console.log('k')
  const oneSetElemToken = { [setElemPolicyID]: BigInt(1) };
  console.log('l')
  const setValidatorAddr = utils.validatorToAddress(params.setValidator);
  console.log('m')
  // TODO: Figure out how to make a unit datum
  return builder
    .attachMintingPolicy(params.protocolPolicy)
    .mintAssets(oneProtocolToken)
    .attachMintingPolicy(params.setElemIDPolicy)
    .mintAssets(oneSetElemToken,initSetInsert().to_hex())
    .attachSpendingValidator(params.setValidator)
    .payToAddressWithData(
      setValidatorAddr,
      initialSetDatumDatum,
      oneSetElemToken,
    )
    .payToAddressWithData(setValidatorAddr, protocolDatum, oneProtocolToken)
    .collectFrom([oneShotUtxo]);
};

export const registerDomain = async (
  lucid: L.Lucid,
  params: Utils.DeNSParams,
  domain: string,
  path: string
): Promise<L.Tx> => {
  const builder = new L.Tx(lucid);
  const utils = new L.Utils(lucid);

  const oneSetElemToken = {
    [utils.mintingPolicyToId(params.setElemIDPolicy)]: BigInt(1),
  };

  const setDatumResponse = await Utils.findOldSetDatum(lucid,path,domain);

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

  const protocolOut = await Utils.findProtocolOut(lucid,path);

  const setValidatorAddr = utils.validatorToAddress(params.setValidator);

  return builder // TODO: null redeemer
    .attachMintingPolicy(params.setElemIDPolicy)
    .mintAssets(oneSetElemToken)
    .attachMintingPolicy(params.elemIDPolicy)
    .mintAssets(oneElemIDToken)
    .readFrom([protocolOut])
    .collectFrom([oldSetDatumUtxo])
    .attachSpendingValidator(params.setValidator)
    .payToAddressWithData(setValidatorAddr, newSetDatumL, oneSetElemToken)
    .payToAddressWithData(setValidatorAddr, newSetDatumR, oneSetElemToken);
};

export const updateRecord = async (
  lucid: L.Lucid,
  params: Utils.DeNSParams,
  user: L.Address,
  domain: string,
  record: RecordDatum,
  path: string
) => {
  const builder = new L.Tx(lucid);
  const utils = new L.Utils(lucid);

  const recValidatorAddr = utils.validatorToAddress(params.recordValidator);

  const elemIDPolicy = utils.mintingPolicyToId(params.elemIDPolicy);
  const elemIDAssetClass: L.Unit = elemIDPolicy + L.fromText(domain);

  const elemIDToken = { [elemIDAssetClass]: BigInt(1) };

  const protocolOut = await Utils.findProtocolOut(lucid,path);

  const elemIDUTxO: L.UTxO = await Utils.findElemIDUTxO(elemIDAssetClass,lucid);

  const recordDatum: L.OutputData = {
    inline: Utils.toCslPlutusData(IsPlutusData[RecordDatum].toData(record)).to_hex(),
  };

  return builder
    .attachSpendingValidator(params.recordValidator)
    .readFrom([protocolOut])
    .collectFrom([elemIDUTxO])
    .payToAddressWithData(recValidatorAddr, recordDatum, {
      lovelace: BigInt(0),
    })
    .payToAddress(user, elemIDToken);
};

