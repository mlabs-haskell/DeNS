import * as L from "lucid-cardano";

import {
  Address,
  Assets,
  Credential,
  Datum,
  DatumHash,
  Delegation,
  OutRef,
  PolicyId,
  ProtocolParameters,
  Provider,
  RewardAddress,
  Script,
  Transaction,
  TxHash,
  Unit,
  UTxO,
} from "lucid-cardano";
3;

import { C } from "lucid-cardano";

import * as OGM from "@cardano-ogmios/client";
import * as PP from "@cardano-ogmios/client/dist/LedgerStateQuery/query/protocolParameters.js";
import * as TX from "@cardano-ogmios/client/dist/LedgerStateQuery/query/utxo.js";
import * as Submit from "@cardano-ogmios/client/dist/TransactionSubmission/submitTransaction/index.js";
import * as Schema from "@cardano-ogmios/schema";

// For some dumb reason the ogmios schema's `Utxo` type is an array of this record. Need to refer to the type of elements of that array
export type OgmiosUtxo = {
  transaction: {
    id: Schema.TransactionId;
  };
  index: Schema.UInt32;
  address: Schema.Address;
  value: Schema.Value;
  datumHash?: Schema.DigestBlake2B256;
  datum?: Schema.Datum;
  script?: Schema.Script;
};

export const valueToAssets = (value: Schema.Value): Assets => {
  const acc: Assets = {};
  for (const [policyId, inner] of Object.entries(value)) {
    if (!(policyId === "ada")) {
      for (const [tokenName, amount] of (Object.entries(inner))) {
        acc[policyId + tokenName] = amount;
      }
    }
  }
  acc["lovelace"] = value.ada.lovelace;
  return acc;
};

// deno-lint-ignore no-explicit-any
const pretty = (x: any) => {
  return JSON.stringify(x, (_key, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    } else {
      return value;
    }
  }, 4);
};

export const toLucidScript = (ogScript: Schema.Script): Script => {
  console.log("ogmios script: " + pretty(ogScript));
  if (ogScript.language === "native") {
    throw new Error("do not think we need to support native scripts?");
  } else if (ogScript.language === "plutus:v1") {
    return { type: "PlutusV1", script: ogScript.cbor };
  } else if (ogScript.language === "plutus:v2") {
    return { type: "PlutusV2", script: ogScript.cbor };
  } else {
    throw new Error("lucid does not support v3 scripts");
  }
};

export const toLucidUtxo = (utxo: OgmiosUtxo): UTxO => {
  console.log("ogmios utxo: \n" + pretty(utxo));
  const core: UTxO = {
    address: utxo.address,
    txHash: utxo.transaction.id,
    outputIndex: Number(utxo.index),
    assets: valueToAssets(utxo.value),
  };
  if (utxo.datumHash) {
    core.datumHash = utxo.datumHash;
  }
  if (utxo.datum) {
    core.datum = utxo.datum;
  }
  if (utxo.script) {
    core.scriptRef = toLucidScript(utxo.script);
  }

  return core;
};

type Lovelace = { lovelace: string };

const wsErr: OGM.WebSocketErrorHandler = (e: Error) => {
  console.log("Websocket error:");
  console.error(JSON.stringify(e, null, 4));
};

const wsClose: OGM.WebSocketCloseHandler = (code, reason) => {
  console.log("Websocket close");
  console.error(JSON.stringify(code, null, 4));
  console.error(JSON.stringify(reason, null, 4));
};

export const mkOgmiosCxt = (
  url: string,
  port: number,
): Promise<OGM.InteractionContext> => {
  const cfg: OGM.ConnectionConfig = {
    host: url,
    port: port,
  };

  return OGM.createInteractionContext(wsErr, wsClose, { connection: cfg });
};

export const unitPolicyID = (unit: Unit): PolicyId => {
  return unit.slice(0, 56);
};

export const unitTokenName = (unit: Unit): string => { // why do they have a type syn for policyID but not tokenName?
  return unit.slice(56);
};

export const containsAssetClass = (
  value: Schema.Value,
  unit: Unit,
): boolean => {
  const policyId = unitPolicyID(unit);
  const tokenName = unitTokenName(unit);

  return (policyId in value && tokenName in value[policyId]);
};

const credentialToAddress = (
  network: L.Network,
  paymentCredential: Credential,
  stakeCredential?: Credential,
): Address => {
  if (stakeCredential) {
    return C.BaseAddress.new(
      L.networkToId(network),
      paymentCredential.type === "Key"
        ? C.StakeCredential.from_keyhash(
          C.Ed25519KeyHash.from_hex(paymentCredential.hash),
        )
        : C.StakeCredential.from_scripthash(
          C.ScriptHash.from_hex(paymentCredential.hash),
        ),
      stakeCredential.type === "Key"
        ? C.StakeCredential.from_keyhash(
          C.Ed25519KeyHash.from_hex(stakeCredential.hash),
        )
        : C.StakeCredential.from_scripthash(
          C.ScriptHash.from_hex(stakeCredential.hash),
        ),
    )
      .to_address()
      .to_bech32(undefined);
  } else {
    return C.EnterpriseAddress.new(
      L.networkToId(network),
      paymentCredential.type === "Key"
        ? C.StakeCredential.from_keyhash(
          C.Ed25519KeyHash.from_hex(paymentCredential.hash),
        )
        : C.StakeCredential.from_scripthash(
          C.ScriptHash.from_hex(paymentCredential.hash),
        ),
    )
      .to_address()
      .to_bech32(undefined);
  }
};

export class OgmiosOnly implements Provider {
  ogmiosUrl: string;
  ogmiosPort: number;
  network: L.Network;

  /**
   * @param kupoUrl: http(s)://localhost:1442
   * @param ogmiosUrl: ws(s)://localhost:1337
   */
  constructor(ogmiosUrl: string, ogmiosPort: number, network: L.Network) {
    this.ogmiosUrl = ogmiosUrl;
    this.ogmiosPort = ogmiosPort;
    this.network = network;
  }

  async getProtocolParameters(): Promise<ProtocolParameters> {
    const cxt = await mkOgmiosCxt(this.ogmiosUrl, this.ogmiosPort);
    const params = await PP.protocolParameters(cxt);

    console.log("Protocol parameters: \n" + pretty(params));

    // deno-lint-ignore no-explicit-any
    const costModels: any = {};
    Object.keys(params.plutusCostModels).forEach((v) => {
      const version = v.split(":")[1].toUpperCase();
      const plutusVersion = "Plutus" + version;
      costModels[plutusVersion] = params.plutusCostModels[v];
    });
    const [memNum, memDenom] = params.scriptExecutionPrices.memory.split("/");
    const [stepsNum, stepsDenom] = params.scriptExecutionPrices.cpu.split("/");

    return {
      minFeeA: params.minFeeCoefficient,
      minFeeB: parseInt(
        (params.minFeeConstant as unknown as Lovelace).lovelace,
      ),
      maxTxSize: params.maxTransactionSize.bytes,
      maxValSize: params.maxValueSize.bytes,
      keyDeposit: BigInt(
        parseInt(
          (params.stakeCredentialDeposit as unknown as Lovelace).lovelace,
        ),
      ),
      poolDeposit: BigInt(
        parseInt((params.stakePoolDeposit as unknown as Lovelace).lovelace),
      ),
      priceMem: parseInt(memNum) / parseInt(memDenom),
      priceStep: parseInt(stepsNum) / parseInt(stepsDenom),
      maxTxExMem: BigInt(params.maxExecutionUnitsPerTransaction.memory),
      maxTxExSteps: BigInt(params.maxExecutionUnitsPerTransaction.cpu),
      coinsPerUtxoByte: BigInt(params.minUtxoDepositCoefficient),
      collateralPercentage: params.collateralPercentage,
      maxCollateralInputs: params.maxCollateralInputs,
      costModels,
    };
  }

  async getUtxos(addressOrCredential: Address | Credential): Promise<UTxO[]> {
    if (typeof addressOrCredential === "string") {
      const addr: Address = addressOrCredential as Address;
      const cxt = await mkOgmiosCxt(this.ogmiosUrl, this.ogmiosPort);

      const txs = await TX.utxo(cxt, { addresses: [addr] });

      return txs.map((x) => toLucidUtxo(x));
    } else {
      const credentialAddr = credentialToAddress(
        this.network,
        addressOrCredential,
      );
      return this.getUtxos(credentialAddr);
    }
  }

  async getUtxosWithUnit(
    addressOrCredential: Address | Credential,
    unit: Unit,
  ): Promise<UTxO[]> {
    if (typeof addressOrCredential === "string") {
      const addr: Address = addressOrCredential as Address;
      const cxt = await mkOgmiosCxt(this.ogmiosUrl, this.ogmiosPort);

      const txs = await TX.utxo(cxt, { addresses: [addr] });

      return txs.filter((x) => containsAssetClass(x.value, unit)).map((x) =>
        toLucidUtxo(x)
      );
    } else {
      const credentialAddr = credentialToAddress(
        this.network,
        addressOrCredential,
      );
      return this.getUtxosWithUnit(credentialAddr, unit);
    }
  }

  async getUtxoByUnit(unit: Unit): Promise<UTxO> {
    const cxt = await mkOgmiosCxt(this.ogmiosUrl, this.ogmiosPort);

    const txs = await TX.utxo(cxt);

    return txs.filter((x) => containsAssetClass(x.value, unit)).map((x) =>
      toLucidUtxo(x)
    )[0];
  }

  async getUtxosByOutRef(outRefs: Array<OutRef>): Promise<UTxO[]> {
    console.log(
      "getUtxosByOutRef: outRefs: " + JSON.stringify(outRefs, null, 4),
    );
    const outputRefs = {
      outputReferences: outRefs.map((x) => {
        return { transaction: { id: x.txHash }, index: x.outputIndex };
      }),
    };
    console.log(
      "getUtxosByOutRef: outRefs (ogmios fmt)" +
        JSON.stringify(outputRefs, null, 4),
    );
    const cxt = await mkOgmiosCxt(this.ogmiosUrl, this.ogmiosPort);
    const txs = await TX.utxo(cxt, outputRefs);
    return txs.map((x) => toLucidUtxo(x));
  }

  getDelegation(_rewardAddress: RewardAddress): Promise<Delegation> {
    throw new Error("We should not need to use getDelegation");
  }

  getDatum(_datumHash: DatumHash): Promise<Datum> {
    throw new Error("getDatum not implemented in fake ogmios provider");
  }

  // TODO(jaredponn): do a race between checking if this exists vs some bounded timeout
  async awaitTx(_txHash: TxHash, _checkInterval = 3000): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 2000));
    return true;
  }

  async submitTx(tx: Transaction): Promise<TxHash> {
    const cxt = await mkOgmiosCxt(this.ogmiosUrl, this.ogmiosPort);

    const hash = await Submit.submitTransaction(cxt, tx);

    return hash;
  }
}
