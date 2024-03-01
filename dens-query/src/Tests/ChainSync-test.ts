import { it } from "node:test";
import * as assert from "node:assert/strict";
import * as PlaPd from "plutus-ledger-api/PlutusData.js";
import * as PlaAssocMap from "plutus-ledger-api/AssocMap.js";
import * as ChainSync from "../DensQuery/ChainSync.js";
import * as fc from "fast-check";

export function fcPlaPlutusData(): fc.Arbitrary<PlaPd.PlutusData> {
  const { plutusData } = fc.letrec((tie) => ({
    plutusData: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      tie("Bytes"),
      tie("Integer"),
      tie("Constr"),
      tie("Map"),
      tie("List"),
    ),
    Constr: fc.record({
      name: fc.constant("Constr"),
      fields: fc.tuple(fc.bigUintN(12), fc.array(tie("plutusData"))),
    }),
    Map: fc.record({
      name: fc.constant("Map"),
      fields: fc.array(fc.tuple(tie("plutusData"), tie("plutusData")))
        .map((arr) => {
          return PlaAssocMap.fromListSafe(
            PlaPd.eqPlutusData,
            arr as [PlaPd.PlutusData, PlaPd.PlutusData][],
          );
        }),
    }),
    List: fc.record({
      name: fc.constant("List"),
      fields: fc.array(tie("plutusData")),
    }),
    Bytes: fc.record({
      name: fc.constant("Bytes"),
      fields: fc.uint8Array(),
    }),
    Integer: fc.record({
      name: fc.constant("Integer"),
      fields: fc.bigInt({ min: -4294967296n, max: 4294967296n }),
    }),
  }));

  return plutusData as fc.Arbitrary<PlaPd.PlutusData>;
}

it(`Pla Plutus data --> Cardano serialization lib Plutus data ---> Pla Plutus data property based tests`, () => {
  fc.assert(
    fc.property(fcPlaPlutusData(), (pd) => {
      assert.deepStrictEqual(
        ChainSync.cslPlutusDataToPlaPlutusData(
          ChainSync.plaPlutusDataToCslPlutusData(pd),
        ),
        pd,
      );
    }),
  );
});
