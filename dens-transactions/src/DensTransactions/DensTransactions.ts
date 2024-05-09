import * as L from "lucid-cardano";
import {
  DensKey,
  Protocol,
  RecordDatum,
  SetDatum,
  SetInsert,
} from "lbf-dens/LambdaBuffers/Dens.mjs";
import { IsPlutusData } from "lbr-plutus/PlutusData.js";
import * as Utils from "./Utils.js";
// Scripts

const initSetInsert = () => {
  const setInsert: SetInsert = { setInsert: Utils.mkDensKey("") };
  return Utils.toCslPlutusData(IsPlutusData[SetInsert].toData(setInsert));
};

export const mkProtocolOneShot = async (lucid: L.Lucid): Promise<L.OutRef> => {
  const builder = new L.Tx(lucid);
  const myAddr = await lucid.wallet.address();

  const tx = builder.payToAddress(myAddr, { lovelace: BigInt(1) });

  const complete = await tx.complete();
  const signed = complete.sign();

  const readyToSubmit = await signed.complete();
  const hash = await readyToSubmit.submit();

  await new Promise((r) => setTimeout(r, 10000));
  const walletUTXOs = await lucid.wallet.getUtxos();

  const utxoWithHash = walletUTXOs.find((x) => x.txHash === hash);

  return { txHash: hash, outputIndex: utxoWithHash.outputIndex };
};

export const initializeDeNS = async (
  lucid: L.Lucid,
  params: Utils.DeNSParams,
  _path: string,
  oneShotOutRef: L.OutRef,
): Promise<L.Tx> => {
  const builder = new L.Tx(lucid);
  const utils = new L.Utils(lucid);
  const initialSetDatumPD = IsPlutusData[SetDatum].toData(
    Utils.initialSetDatum,
  );
  console.log(
    "initial set datum: " + JSON.stringify(initialSetDatumPD, null, 4),
  );
  const initialSetDatumCSL = (Utils.toCslPlutusData(initialSetDatumPD))
    .to_hex();
  const initialSetDatumDatum: L.OutputData = { inline: initialSetDatumCSL };
  const protocolDatumRaw: Protocol = {
    elementIdMintingPolicy: Utils.mkLBScriptHash(params.elemIDPolicy),
    setElemMintingPolicy: Utils.mkLBScriptHash(params.setElemIDPolicy),
    setValidator: Utils.mkLBScriptHash(params.setValidator),
    recordsValidator: Utils.mkLBScriptHash(params.recordValidator),
  };

  const protocolDatum: L.OutputData = {
    inline: Utils.toCslPlutusData(
      IsPlutusData[Protocol].toData(protocolDatumRaw),
    )
      .to_hex(),
  };

  const oneShotUtxos = await lucid.utxosByOutRef([oneShotOutRef]);
  const oneShotUtxo = oneShotUtxos[0];

  // Mint one protocol token
  const protocolPolicyID = utils.mintingPolicyToId(params.protocolPolicy);

  const oneProtocolToken = { [protocolPolicyID]: BigInt(1) };

  // Mint one setElem token
  const setElemPolicyID = utils.mintingPolicyToId(params.setElemIDPolicy);

  const oneSetElemToken = { [setElemPolicyID]: BigInt(1) };

  const setValidatorAddr = utils.validatorToAddress(params.setValidator);

  // TODO: Figure out how to make a unit datum
  return builder
    .attachMintingPolicy(params.protocolPolicy)
    .mintAssets(oneProtocolToken, L.Data.void())
    .attachMintingPolicy(params.setElemIDPolicy)
    .mintAssets(oneSetElemToken, initSetInsert().to_hex())
    // WARNING(jaredponn): we MUST put the protocol datum as a tx output BEFORE
    // ALL OTHER TX OUTPUTS. This is because of the way the query layer works.
    // There is a way to "fix" this, but that'd make a good separate project --
    // A Framework for Efficient Databases of subsets of UTxOs for Cardano.
    .payToAddressWithData(setValidatorAddr, protocolDatum, oneProtocolToken)
    .payToAddressWithData(
      setValidatorAddr,
      initialSetDatumDatum,
      oneSetElemToken,
    )
    .collectFrom([oneShotUtxo]);
};

export const registerDomain = async (
  lucid: L.Lucid,
  params: Utils.DeNSParams,
  domain: string,
  path: string,
): Promise<L.Tx> => {
  const trace = (msg: string) => {
    console.log("registerDomain " + msg);
  };
  trace("A");
  const builder = new L.Tx(lucid);
  const utils = new L.Utils(lucid);
  trace("B");
  const oneSetElemToken = {
    [utils.mintingPolicyToId(params.setElemIDPolicy)]: BigInt(1),
  };
  trace("C");
  const setDatumResponse = await Utils.findOldSetDatum(lucid, path, domain);
  trace("D");
  const oldSetDatum = setDatumResponse.setDatum;
  const oldSetDatumUtxo = setDatumResponse.setDatumUTxO;
  trace("E");
  const k: DensKey = oldSetDatum.key;
  trace("oldSetDatum.key: " + JSON.stringify(k, null, 4));
  const nxt: DensKey = oldSetDatum.next;
  trace("oldSetDatum.nxt: " + JSON.stringify(nxt, null, 4));
  trace("F");
  trace("oldSetDatumUtxo:\n" + JSON.stringify(oldSetDatumUtxo, null, 4));
  const sdl: SetDatum = {
    key: k,
    next: { densName: Buffer.from(domain), densClass: BigInt(0) },
    ownerApproval: Utils.emptyCS,
  };
  const sdr: SetDatum = {
    key: { densName: Buffer.from(domain), densClass: BigInt(0) },
    next: nxt,
    ownerApproval: Utils.emptyCS,
  };
  trace("SDL: " + JSON.stringify(sdl, null, 4));
  trace("SDR: " + JSON.stringify(sdr, null, 4));

  trace("G");

  trace(
    "SDL Data: " + JSON.stringify(IsPlutusData[SetDatum].toData(sdl), null, 4),
  );
  const newSetDatumL: L.OutputData = {
    inline: Utils.toCslPlutusData(IsPlutusData[SetDatum].toData(sdl)).to_hex(),
  };
  const newSetDatumR: L.OutputData = {
    inline: Utils.toCslPlutusData(IsPlutusData[SetDatum].toData(sdr)).to_hex(),
  };
  trace("H");
  const elemIDPolicy = utils.mintingPolicyToId(params.elemIDPolicy);
  const elemIDTokenName = Utils.elementIdTokenName(domain);
  const elemIDAssetClass: L.Unit = elemIDPolicy + elemIDTokenName;
  trace("I");
  const oneElemIDToken = { [elemIDAssetClass]: BigInt(1) };
  trace("J");
  const protocolOut = await Utils.findProtocolOut(lucid, path);
  trace("K");
  const setValidatorAddr = utils.validatorToAddress(params.setValidator);
  trace("L");
  const setInsertLB: SetInsert = { setInsert: Utils.mkDensKey(domain) };
  const setInsertData = Utils.toCslPlutusData(
    IsPlutusData[SetInsert].toData(setInsertLB),
  );
  console.log("setInsertData: " + JSON.stringify(setInsertData, null, 4));
  console.log(
    "registerDomain protocolOut:\n" + JSON.stringify(protocolOut, null, 4),
  );
  console.log(
    "registerDomain oldSetDatumUtxo:\n" +
      JSON.stringify(oldSetDatumUtxo, null, 4),
  );
  return builder
    .attachMintingPolicy(params.setElemIDPolicy)
    .mintAssets(oneSetElemToken, setInsertData.to_hex())
    .attachMintingPolicy(params.elemIDPolicy)
    .mintAssets(oneElemIDToken, L.Data.void())
    .readFrom([protocolOut])
    .collectFrom([oldSetDatumUtxo], setInsertData.to_hex())
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
  path: string,
) => {
  const builder = new L.Tx(lucid);
  const utils = new L.Utils(lucid);

  const recValidatorAddr = utils.validatorToAddress(params.recordValidator);

  const elemIDPolicy = utils.mintingPolicyToId(params.elemIDPolicy);
  const elemIDTokenName = Utils.elementIdTokenName(domain);
  const elemIDAssetClass: L.Unit = elemIDPolicy + elemIDTokenName;

  const elemIDToken = { [elemIDAssetClass]: BigInt(1) };

  const protocolOut = await Utils.findProtocolOut(lucid, path);

  const elemIDUTxO: L.UTxO = await Utils.findElemIDUTxO(
    elemIDAssetClass,
    lucid,
  );

  const recordDatum: L.OutputData = {
    inline: Utils.toCslPlutusData(IsPlutusData[RecordDatum].toData(record))
      .to_hex(),
  };

  return builder
    // .attachSpendingValidator(params.recordValidator)
    .readFrom([protocolOut])
    .collectFrom([elemIDUTxO])
    .payToAddressWithData(recValidatorAddr, recordDatum, {
      lovelace: BigInt(0),
    })
    .payToAddress(user, elemIDToken);
};
