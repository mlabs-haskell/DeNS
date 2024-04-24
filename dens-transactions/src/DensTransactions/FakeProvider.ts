import * as L from "lucid-cardano";

import {
  Address,
  Assets,
  Credential,
  Datum,
  DatumHash,
  Delegation,
  OutRef,
  ProtocolParameters,
  Provider,
  RewardAddress,
  Transaction,
  TxHash,
  Unit,
  UTxO,
} from "lucid-cardano";

import { C  } from "lucid-cardano";

import { fromHex, fromUnit, toHex } from "lucid-cardano";



export class OgmiosOnly implements Provider {
  ogmiosUrl: string;

  /**
   * @param kupoUrl: http(s)://localhost:1442
   * @param ogmiosUrl: ws(s)://localhost:1337
   */
  constructor(ogmiosUrl: string) {
    this.ogmiosUrl = ogmiosUrl;
  }

  async getProtocolParameters(): Promise<ProtocolParameters> {
    const client = await this.ogmiosWsp("Query", {
      query: "currentProtocolParameters",
    });

    return new Promise((res, rej) => {
      client.addEventListener("message", (msg: MessageEvent<string>) => {
        try {
          const { result } = JSON.parse(msg.data);

          // deno-lint-ignore no-explicit-any
          const costModels: any = {};
          Object.keys(result.costModels).forEach((v) => {
            const version = v.split(":")[1].toUpperCase();
            const plutusVersion = "Plutus" + version;
            costModels[plutusVersion] = result.costModels[v];
          });
          const [memNum, memDenom] = result.prices.memory.split("/");
          const [stepsNum, stepsDenom] = result.prices.steps.split("/");

          res(
            {
              minFeeA: parseInt(result.minFeeCoefficient),
              minFeeB: parseInt(result.minFeeConstant),
              maxTxSize: parseInt(result.maxTxSize),
              maxValSize: parseInt(result.maxValueSize),
              keyDeposit: BigInt(result.stakeKeyDeposit),
              poolDeposit: BigInt(result.poolDeposit),
              priceMem: parseInt(memNum) / parseInt(memDenom),
              priceStep: parseInt(stepsNum) / parseInt(stepsDenom),
              maxTxExMem: BigInt(result.maxExecutionUnitsPerTransaction.memory),
              maxTxExSteps: BigInt(
                result.maxExecutionUnitsPerTransaction.steps,
              ),
              coinsPerUtxoByte: BigInt(result.coinsPerUtxoByte),
              collateralPercentage: parseInt(result.collateralPercentage),
              maxCollateralInputs: parseInt(result.maxCollateralInputs),
              costModels,
            },
          );
          client.close();
        } catch (e) {
          rej(e);
        }
      }, { once: true });
    });
  }

  async getUtxos(addressOrCredential: Address | Credential): Promise<UTxO[]> {
    throw new Error('getUtxos not implemented in fake ogmios provider');
  }

  async getUtxosWithUnit(
    addressOrCredential: Address | Credential,
    unit: Unit,
  ): Promise<UTxO[]> {
    throw new Error('getUtxosWithUnit not implemented in fake ogmios provider');
  }

  async getUtxoByUnit(unit: Unit): Promise<UTxO> {
    throw new Error('getUtxosWithUnit not implemented in fake ogmios provider');
  }

  async getUtxosByOutRef(outRefs: Array<OutRef>): Promise<UTxO[]> {
    throw new Error('Implement getUtxosByOutRef')
  }

  async getDelegation(rewardAddress: RewardAddress): Promise<Delegation> {
    const client = await this.ogmiosWsp("Query", {
      query: { "delegationsAndRewards": [rewardAddress] },
    });

    return new Promise((res, rej) => {
      client.addEventListener("message", (msg: MessageEvent<string>) => {
        try {
          const { result } = JSON.parse(msg.data);
          const delegation = (result ? Object.values(result)[0] : {}) as {
            delegate: string;
            rewards: number;
          };
          res(
            {
              poolId: delegation?.delegate || null,
              rewards: BigInt(delegation?.rewards || 0),
            },
          );
          client.close();
        } catch (e) {
          rej(e);
        }
      }, { once: true });
    });
  }

  async getDatum(datumHash: DatumHash): Promise<Datum> {
    throw new Error('getDatum not implemented in fake ogmios provider');
  }

  awaitTx(txHash: TxHash, checkInterval = 3000): Promise<boolean> {
    throw new Error('TODO: Figure out what to do w/ awaitTx');
  }

  async submitTx(tx: Transaction): Promise<TxHash> {
    const client = await this.ogmiosWsp("SubmitTx", {
      submit: tx,
    });

    return new Promise((res, rej) => {
      client.addEventListener("message", (msg: MessageEvent<string>) => {
        try {
          const { result } = JSON.parse(msg.data);

          if (result.SubmitSuccess) res(result.SubmitSuccess.txId);
          else rej(result.SubmitFail);
          client.close();
        } catch (e) {
          rej(e);
        }
      }, { once: true });
    });
  }

  private async ogmiosWsp(
    methodname: string,
    args: unknown,
  ): Promise<WebSocket> {
    const client = new WebSocket(this.ogmiosUrl);
    await new Promise((res) => {
      client.addEventListener("open", () => res(1), { once: true });
    });
    client.send(JSON.stringify({
      type: "jsonwsp/request",
      version: "1.0",
      servicename: "ogmios",
      methodname,
      args,
    }));
    return client;
  }
}
