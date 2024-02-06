import Query from "@irys/query";
import Irys from "@irys/sdk";

import Wallet from "ethereumjs-wallet";

export const nothing = Symbol("Nothing");
export type Nothing = typeof nothing;

export type Maybe<A> = A | Nothing;

export enum IrysNetwork {
  Node1,
  Node2,
  DevNet,
}

interface EthProviderSymbol {
  readonly s: unique symbol;
}

export type EthProvider = string & EthProviderSymbol;

function isProviderString(
  provider_string: string,
): provider_string is EthProvider {
  // TODO: do we really need to check this?
  console.log(typeof provider_string === "string");
  return (typeof provider_string === "string");
}

export function makeEthProvider(provider_string: string): Maybe<EthProvider> {
  return isProviderString(provider_string) ? provider_string : nothing;
}

interface EthPrivateKeySymbol {
  readonly s: unique symbol;
}

export type EthPrivateKey = string & EthPrivateKeySymbol;

function isAddressInternal(key: string): key is EthPrivateKey {
  try {
    const buffer = Buffer.from(key.slice(2), "hex");
    Wallet.default.fromPrivateKey(buffer);
  } catch (_) {
    return false;
  }
  return true;
}

export function makeEthPrivateKey(key: string): Maybe<EthPrivateKey> {
  return isAddressInternal(key) ? key : nothing;
}

type EthPaymentInfo = {
  key: EthPrivateKey;
  provider: EthProvider;
};

export function makeEthPaymentInfo(
  key_string: string,
  provider_string: string,
): Maybe<EthPaymentInfo> {
  const maybe_key = makeEthPrivateKey(key_string);
  const maybe_provider = makeEthProvider(provider_string);

  if ((maybe_key === nothing) || (maybe_provider === nothing)) {
    return nothing;
  }

  return { key: maybe_key, provider: maybe_provider };
}

export class Connection {
  connection: Irys;
  query: Query;

  constructor(
    network: IrysNetwork,
    paymentInfo: EthPaymentInfo,
  ) {
    //We assume that the founding token is Sepolia in Eth
    let network_url: string;
    switch (network) {
      case IrysNetwork.Node1: {
        network_url = "https://node1.irys.xyz";
        break;
      }
      case IrysNetwork.Node2: {
        network_url = "https://node2.irys.xyz";
        break;
      }
      case IrysNetwork.DevNet: {
        network_url = "https://devnet.irys.xyz";
        break;
      }
    }
    const connection: Irys = new Irys(
      {
        url: network_url,
        token: "ethereum",
        key: paymentInfo.key,
        config: { providerUrl: paymentInfo.provider },
      },
    );
    this.connection = connection;
    this.query = new Query({ url: network_url + "/graphql" });
  }
}
