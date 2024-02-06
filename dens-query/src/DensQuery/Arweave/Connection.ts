import Query from "@irys/query";
import Irys from "@irys/sdk";

import Wallet from "ethereumjs-wallet";

export const nothing = Symbol("Nothing");
export type Nothing = typeof nothing;

export type Maybe<A> = A | Nothing;

type Left<T> = {
  left: T;
  right?: never;
};

type Right<U> = {
  left?: never;
  right: U;
};

type Either<T, U> = NonNullable<Left<T> | Right<U>>;

export function makeLeft<T, U>(l: T): Either<T, U> {
  return { left: l }
}

export function makeRight<T, U>(r: U): Either<T, U> {
  return { right: r }
}

export function isRight<T, U>(e: Either<T, U>): e is Right<U> {
  return e.right !== undefined;
}

export function isLeft<T, U>(e: Either<T, U>): e is Left<T> {
  return e.left !== undefined;
}

type EthErrorCode = "CANT_PARSE_ETH_RPC_PROVIDER" | "CANT_PARSE_ETH_ADDRESS"

class EthError extends Error {
  constructor(name: EthErrorCode, message: string) {
    super(message);
    this.name = name;
  }
}


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
  return (typeof provider_string === "string");
}

export function makeEthProvider(provider_string: string): Either<EthError, EthProvider> {
  return isProviderString(provider_string) ? makeRight(provider_string) :
    makeLeft(new EthError("CANT_PARSE_ETH_RPC_PROVIDER", provider_string));
}

interface EthPrivateKeySymbol {
  readonly s: unique symbol;
}

export type EthPrivateKey = string & EthPrivateKeySymbol;

function isAddress(key: string): key is EthPrivateKey {
  try {
    const buffer = Buffer.from(key.slice(2), "hex");
    Wallet.default.fromPrivateKey(buffer);
  } catch (_) {
    return false;
  }
  return true;
}

export function makeEthPrivateKey(key: string): Either<EthError, EthPrivateKey> {
  return isAddress(key) ? makeRight(key) : makeLeft(new EthError("CANT_PARSE_ETH_ADDRESS", "hidded_private_key"));
}

type EthPaymentInfo = {
  key: EthPrivateKey;
  provider: EthProvider;
};

export function makeEthPaymentInfo(
  key_string: string,
  provider_string: string,
): Either<EthError, EthPaymentInfo> {
  const maybe_key = makeEthPrivateKey(key_string);
  if (isLeft(maybe_key)) {
    return maybe_key
  }
  const maybe_provider = makeEthProvider(provider_string);
  if (isLeft(maybe_provider)) {
    return maybe_provider
  }

  return makeRight({ key: maybe_key.right, provider: maybe_provider.right });
}

function irysNetworkToUrl(network: IrysNetwork): string {
  switch (network) {
    case IrysNetwork.Node1: {
      return "https://node1.irys.xyz";
    }
    case IrysNetwork.Node2: {
      return "https://node2.irys.xyz";
    }
    case IrysNetwork.DevNet: {
      return "https://devnet.irys.xyz";
    }
  }

}

export class Connection {
  connection: Irys;
  query: Query;
  network: IrysNetwork;

  constructor(
    network: IrysNetwork,
    paymentInfo: EthPaymentInfo,
  ) {
    //We assume that the founding token is Sepolia in Eth
    const network_url: string = irysNetworkToUrl(network);
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
    this.network = network;
  }
}

export async function tryEither<U>(f: () => Promise<U>): Promise<Either<any, U>> {
  try { let result = await f(); return makeRight(result) } catch (e) { return makeLeft(e) }
}

export async function transactionsByIds(connection: Connection, ids: string[]) {
  async function f() { const result = await connection.query.search("arweave:transactions").ids(ids); return result }
  return tryEither(f)
}
