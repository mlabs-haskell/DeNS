/*
 * NOTE(jaredponn): Mostly taken from: {@ link
 * https://github.com/CardanoSolutions/ogmios-ts-client-starter-kit/tree/main/src}
 */
// import { createInteractionContext } from "@cardano-ogmios/client";
// import type { InteractionContext } from "@cardano-ogmios/client";
// import { createChainSynchronizationClient } from "@cardano-ogmios/client";
// import {
//   Block,
//   // BlockPraos,
//   // DigestBlake2B256,
//   Point,
//   // Slot,
// } from "@cardano-ogmios/schema";
//
// import { config } from "./Config.js";
// import { logger } from "./Logger.js";
//
// export async function createContext(
//   host: string,
//   port: number,
// ): Promise<InteractionContext> {
//   return createInteractionContext(
//     (err) => logger.error(`Ogmios connection error: ${err}`),
//     () => logger.info("Ogmios connection closed"),
//     { connection: { host: host, port: port } },
//   );
// }
//
// // /* A dummy database implementation. */
// // class Database {
// //   blocks: Block[];
// //
// //   constructor() {
// //     this.blocks = [];
// //   }
// //
// //   rollForward(_block: Block) {
// //     // this.blocks.push(block);
// //   }
// //
// //   rollBackward(_point: Point) {
// //     // this.blocks.filter(block => (block as BlockPraos).slot <= point.slot);
// //   }
// //
// //   getBlock(point: Point) {
// //     return this.blocks.filter((block) => block.id == point.id);
// //   }
// // }
//
// // Avoids error when serializing BigInt
// // const replacer = (_key: any, value: any) =>
// //   typeof value === "bigint" ? value.toString() : value;
//
// const rollForward =
//   (db: Database) =>
//   async ({ block }: { block: Block }, nextBlock: () => void) => {
//     console.log(`Roll forward: ${JSON.stringify(block, replacer)}`);
//     db.rollForward(block);
//     nextBlock();
//   };
//
// const rollBackward =
//   (db: Database) => async ({ point }: any, nextBlock: () => void) => {
//     console.log(`Roll backward: ${JSON.stringify(point)}`);
//     db.rollBackward(point);
//     nextBlock();
//   };
//
// export async function runChainSync() {
//   const context = await createContext(config.ogmios.host, config.ogmios.port);
//   const db = new Database();
//   const client = await createChainSynchronizationClient(context, {
//     rollForward: rollForward(db),
//     rollBackward: rollBackward(db),
//   });
//   await client.resume();
// }
