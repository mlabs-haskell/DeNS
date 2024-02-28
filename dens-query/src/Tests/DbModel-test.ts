// WARNING(jaredponn): this is all deprecated and broken. We leave this file
// here s.t. in the future maybe one day we can "breathe life back into it" and
// use the property based testing again.
//
// This file includes tests which check that a simplified model of the
// interactions agree with what the database is doing.
//
// Most of the code is heavily based off the documentation in [1].
//
// As a commutative diagram, we're testing if
//
// ```
//  Model ---command---> Model'
//   |                    |
//  eq                    eq
//   |                    |
//  Db    ---command---> Db'
// ```
//
// References:
// [1]: https://fast-check.dev/docs/advanced/model-based-testing/
// import { it } from "node:test";
// import * as assert from "node:assert/strict";
// import * as DbTestUtils from "./DbTestUtils.js";
// import * as Db from "../DensQuery/Db.js";
//
// import * as Prelude from "prelude";
// import * as PMap from "prelude/Map.js";
//
// import * as fc from "fast-check";
//
// // This is needed to print `bigint`s for the debugging messages.
//
// // deno-lint-ignore no-explicit-any
// (BigInt.prototype as any).toJSON = function () {
//   return this.toString();
// };
//
// // Set some default global settings for fast-check
// // Remarks:
// //  - We keep the tests low (because spinning up a DB is expensive)
// //
// //  - We immediately end on failure because it'll take too long for fast-check
// //    to shrink and find a small counter example.
// fc.configureGlobal({ numRuns: 5, endOnFailure: true });
//
// /**
//  * An "idealized" correct model.
//  */
// type Model = {
//   densSetRows: PMap.Map<Uint8Array, Db.DensSetRow>;
// };
//
// /**
//  * A command for {@link insertDensSetUtxo}
//  */
// class InsertDensSetUtxoCommand implements fc.AsyncCommand<Model, Db.DensDb> {
//   #densSetRow: Db.DensSetRow;
//
//   constructor(densSetRow: Db.DensSetRow) {
//     this.#densSetRow = densSetRow;
//   }
//
//   check(_m: Readonly<Model>): boolean {
//     return true;
//   }
//
//   async run(m: Model, r: Db.DensDb): Promise<void> {
//     PMap.insert(
//       Prelude.ordBytes,
//       this.#densSetRow.name,
//       this.#densSetRow,
//       m.densSetRows,
//     );
//     await r.insertDensSetUtxo(this.#densSetRow);
//   }
//
//   toString() {
//     return `insertDensSetUtxo(${JSON.stringify(this.#densSetRow)})`;
//   }
// }
//
// /**
//  * A command for {@link strictInfimumDensSetUtxo}
//  */
// class StrictInfimumDensSetUtxoCommand implements fc.Command<Model, Db.DensDb> {
//   #name: Uint8Array;
//   constructor(name: Uint8Array) {
//     this.#name = name;
//   }
//
//   check(m: Readonly<Model>): boolean {
//     return m.densSetRows.length !== 0;
//   }
//
//   async run(m: Model, r: Db.DensDb): Promise<void> {
//     const mV = PMap.lookupLT(Prelude.ordBytes, this.#name, m.densSetRows);
//     const rV = await r.strictInfimumDensSetUtxo(this.#name);
//
//     assert.deepStrictEqual(rV, mV.name === "Just" ? mV.fields : undefined);
//   }
//
//   toString() {
//     return `strictInfimumDensSetUtxo(${JSON.stringify(this.#name)})`;
//   }
// }
//
// it(`Database model tests`, async () => {
//   await DbTestUtils.withPgTest(async (host, port) => {
//     const db: Db.DensDb = new Db.DensDb({
//       host: host,
//       port: BigInt(port),
//       user: "dens",
//       database: `dens`,
//       password: ``,
//     });
//     try {
//       await DbTestUtils.pgCreateUserAndDb(host, port, `dens`, `dens`);
//
//       const allCommands = [
//         DbTestUtils.fcDensSetRow().map((densSetRow) =>
//           new InsertDensSetUtxoCommand(densSetRow)
//         ),
//         DbTestUtils.fcName().map((name) =>
//           new StrictInfimumDensSetUtxoCommand(name)
//         ),
//       ];
//
//       await fc.assert(
//         fc.asyncProperty(
//           fc.commands(allCommands, { maxCommands: 4096, size: "max" }),
//           async (cmds) => {
//             async function s() {
//               const model: Model = { densSetRows: new PMap.Map() };
//
//               const real = db;
//
//               await real.query("DROP OWNED BY dens CASCADE");
//               await real.init();
//
//               return { model, real };
//             }
//
//             await fc.asyncModelRun(s, cmds);
//           },
//         ),
//       );
//     } finally {
//       await db.end();
//     }
//   });
// });
