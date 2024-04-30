// This module includes sample data + generators for sample data for testing
import * as fc from "fast-check";
import * as PlaV1 from "plutus-ledger-api/V1.js";
import * as Prelude from "prelude";
import type {
  AssetClass,
  CurrencySymbol,
  ScriptHash,
  TokenName,
  TxOutRef,
} from "plutus-ledger-api/V1.js";
import * as Db from "../DensQuery/Db.js";
import { DensRr, Protocol, RData } from "lbf-dens/LambdaBuffers/Dens.mjs";
import prand from "pure-rand";

/**
 * Hardcoded sample data
 */
export const sampleNameTaylorSwiftDotCom: Uint8Array = (() => {
  return Uint8Array.from([
    116,
    97,
    121,
    108,
    111,
    114,
    115,
    119,
    105,
    102,
    116,
    46,
    99,
    111,
    109,
  ]);
})();

export const sampleNameGoogleDotCom: Uint8Array = Uint8Array.from([
  103,
  111,
  111,
  103,
  108,
  101,
  46,
  99,
  111,
  109,
]);

export const sampleProtocolNftAssetClass: AssetClass = (() => {
  const arr = [];
  for (let i = 0; i < 28; ++i) {
    arr.push(69);
  }
  const mcs = PlaV1.currencySymbolFromBytes(Uint8Array.from(arr));
  if (mcs.name === `Just`) {
    return [mcs.fields, PlaV1.adaToken];
  } else {
    throw new Error(`Invalid sampleCurrencySymbol`);
  }
})();

export const sampleElementIdMintingPolicy: ScriptHash = Prelude.fromJust(
  PlaV1.scriptHashFromBytes(
    Uint8Array.from([
      118,
      101,
      98,
      119,
      114,
      118,
      119,
      120,
      113,
      110,
      110,
      114,
      104,
      103,
      102,
      109,
      115,
      107,
      112,
      118,
      105,
      97,
      116,
      104,
      113,
      109,
      107,
      114,
    ]),
  ),
);

export const sampleSetElemMintingPolicy: ScriptHash = Prelude.fromJust(
  PlaV1.scriptHashFromBytes(
    Uint8Array.from([
      101,
      102,
      100,
      109,
      115,
      120,
      112,
      121,
      100,
      101,
      106,
      118,
      99,
      98,
      100,
      102,
      116,
      121,
      110,
      108,
      107,
      117,
      110,
      113,
      101,
      110,
      115,
      110,
    ]),
  ),
);

export const sampleSetValidator: ScriptHash = Prelude.fromJust(
  PlaV1.scriptHashFromBytes(
    Uint8Array.from([
      101,
      98,
      97,
      114,
      103,
      121,
      121,
      111,
      110,
      113,
      107,
      112,
      119,
      101,
      110,
      114,
      103,
      112,
      103,
      114,
      104,
      101,
      97,
      122,
      99,
      112,
      99,
      122,
    ]),
  ),
);

export const sampleRecordsValidator: ScriptHash = Prelude.fromJust(
  PlaV1.scriptHashFromBytes(
    Uint8Array.from([
      118,
      106,
      105,
      120,
      104,
      121,
      104,
      114,
      112,
      101,
      102,
      121,
      106,
      113,
      105,
      108,
      98,
      114,
      97,
      118,
      116,
      106,
      102,
      112,
      110,
      103,
      114,
      103,
    ]),
  ),
);

export const sampleProtocol: Protocol = {
  elementIdMintingPolicy: sampleElementIdMintingPolicy,
  setElemMintingPolicy: sampleSetElemMintingPolicy,
  setValidator: sampleSetValidator,
  recordsValidator: sampleRecordsValidator,
};

export const sampleBlockHash: Uint8Array = (() => {
  return Uint8Array.from([
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
})();

/**
 * Hardcoded sample data
 */
export const sampleSlot = 69n;

export const samplePoint: Db.Point = {
  slot: sampleSlot,
  blockId: sampleBlockHash,
};

/**
 * Hardcoded sample data
 */
export const sampleCurrencySymbol: CurrencySymbol = (() => {
  const arr = [];
  for (let i = 0; i < 28; ++i) {
    arr.push(i);
  }
  const mcs = PlaV1.currencySymbolFromBytes(Uint8Array.from(arr));
  if (mcs.name === `Just`) {
    return mcs.fields;
  } else {
    throw new Error(`Invalid sampleCurrencySymbol`);
  }
})();

/**
 * Hardcoded sample data
 */
export const sampleTokenName: TokenName = (() => {
  const arr = [];
  for (let i = 0; i < 32; ++i) {
    arr.push(i);
  }
  const mtn = PlaV1.tokenNameFromBytes(Uint8Array.from(arr));
  if (mtn.name === `Just`) {
    return mtn.fields;
  } else {
    throw new Error(`Invalid sampleTokenName`);
  }
})();

/**
 * Hardcoded sample data
 */
export const sampleTxOutRef: TxOutRef = (() => {
  const arr = [];
  for (let i = 0; i < 32; ++i) {
    arr.push(i);
  }
  const mtxId = PlaV1.txIdFromBytes(Uint8Array.from(arr));
  if (mtxId.name === `Just`) {
    return { txOutRefId: mtxId.fields, txOutRefIdx: 420n };
  } else {
    throw new Error(`Invalid sampleTxOutRef`);
  }
})();

/**
 * Generator for an arbitrary domain name
 */
export function fcName(): fc.Arbitrary<Uint8Array> {
  return fc.uint8Array({ min: 0, max: 255, minLength: 0, maxLength: 255 });
}

/**
 * Generator for a block hash (32 byte digest)
 */
export function fcBlockHash(): fc.Arbitrary<Uint8Array> {
  return fc.uint8Array({ min: 0, max: 255, minLength: 0, maxLength: 32 });
}

/**
 * Generator for an arbitrary slot
 */
export function fcSlot(): fc.Arbitrary<bigint> {
  return fc.bigUintN(63);
}

/**
 * Generator for an arbitrary {@link CurrencySymbol}
 */
export function fcCurrencySymbol(): fc.Arbitrary<CurrencySymbol> {
  return fc.oneof(
    fc.constant(Uint8Array.from([])),
    fc.uint8Array({ min: 0, max: 255, minLength: 28, maxLength: 28 }),
  )
    .map((bytes) => {
      const mCurrencySymbol = PlaV1.currencySymbolFromBytes(bytes);
      if (mCurrencySymbol.name === "Just") {
        return mCurrencySymbol.fields;
      } else {
        throw new Error(`Invalid generated CurrencySymbol`);
      }
    });
}

/**
 * Generator for an arbitrary {@link AssetClass}
 */
export function fcAssetClass(): fc.Arbitrary<AssetClass> {
  return fc.tuple(
    fcCurrencySymbol(),
    fcTokenName(),
  );
}

/**
 * Generator for an arbitrary {@link TokenName}
 */
export function fcTokenName(): fc.Arbitrary<TokenName> {
  return fc.uint8Array({ min: 0, max: 255, minLength: 0, maxLength: 32 })
    .map((bytes) => {
      const mTokenName = PlaV1.tokenNameFromBytes(bytes);
      if (mTokenName.name === "Just") {
        return mTokenName.fields;
      } else {
        throw new Error(`Invalid generated TokenName`);
      }
    });
}

/**
 * Generator for an arbitrary {@link TxOutRef}
 */
export function fcTxOutRef(): fc.Arbitrary<TxOutRef> {
  return fc.record(
    {
      txOutRefId: fc.uint8Array({
        min: 0,
        max: 255,
        minLength: 32,
        maxLength: 32,
      }).map((bytes) => {
        const mTxId = PlaV1.txIdFromBytes(bytes);
        if (mTxId.name === "Just") {
          return mTxId.fields;
        } else {
          throw new Error(`Invalid generated TxId`);
        }
      }),
      txOutRefIdx: fc.bigUintN(63),
    },
  );
}

/**
 * Generator for an arbitrary {@link ScriptHash}
 */
export function fcScriptHash(): fc.Arbitrary<ScriptHash> {
  return fc.uint8Array({
    min: 0,
    max: 255,
    minLength: 28,
    maxLength: 28,
  }).map((bytes) => {
    const mTxId = PlaV1.scriptHashFromBytes(bytes);
    if (mTxId.name === "Just") {
      return mTxId.fields;
    } else {
      throw new Error(`Invalid generated ScriptHash`);
    }
  });
}

/**
 * Generator for an arbitrary {@link Protocol}
 */
export function fcProtocol(): fc.Arbitrary<Db.Protocol> {
  return fc.record(
    {
      elementIdMintingPolicy: fcScriptHash(),
      setElemMintingPolicy: fcScriptHash(),
      setValidator: fcScriptHash(),
      recordsValidator: fcScriptHash(),
    },
  );
}

export function fcPoint(): fc.Arbitrary<Db.Point> {
  return fc.record(
    {
      slot: fc.bigUintN(16),
      blockId: fc.uint8Array({ minLength: 32, maxLength: 32 }),
    },
  );
}

export function fcDensSetUtxo(): fc.Arbitrary<Db.DensSetUtxo> {
  return fc.record(
    {
      name: fcName(),
      pointer: fc.tuple(fcCurrencySymbol(), fcTokenName()),
      txOutRef: fcTxOutRef(),
    },
  );
}

export function fcDensRrsUtxo(): fc.Arbitrary<Db.DensRrsUtxo> {
  return fc.record(
    {
      name: fcName(),
      rrs: fc.array(fcDensRr()),
      txOutRef: fcTxOutRef(),
    },
  );
}

export function fcDensRr(): fc.Arbitrary<DensRr> {
  return fc.record(
    {
      ttl: fc.bigInt({ min: 0n, max: 2n ^ 32n - 1n }),
      rData: fcRdata(),
    },
  );
}

export function fcRdata(): fc.Arbitrary<RData> {
  return fc.oneof(
    fc.record(
      {
        name: fc.constant(`A`),
        fields: fc.ipV4().map((ip) =>
          Uint8Array.from(ip, (c) => c.charCodeAt(0))
        ),
      },
    ),
    fc.record(
      {
        name: fc.constant(`AAAA`),
        fields: fc.ipV6().map((ip) =>
          Uint8Array.from(ip, (c) => c.charCodeAt(0))
        ),
      },
    ),
    // TODO(jaredponn): actually generate all the possible RRs here
  ) as fc.Arbitrary<RData>;
}

export function fcDensProtocolUtxo(): fc.Arbitrary<Db.DensProtocolUtxo> {
  return fc.record(
    {
      protocol: fcProtocol(),
      txOutRef: fcTxOutRef(),
    },
  );
}

const rng = prand.xoroshiro128plus(69420);
const rnd = new fc.Random(rng);

/**
 * Generate a random value given an arbitrary from fast-check
 */
export function fcGenerate<T>(arb: fc.Arbitrary<T>): T {
  return arb.generate(rnd, undefined).value_;
}
