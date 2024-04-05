import "./Config.js";
import "./ChainSync.js";

import { db } from "./Db.js";

// Initialize the database
await db.init();

// await db.insertDensSetRow(
//   Buffer.from([0]),
//   12n,
//   Buffer.from([1]),
//   Buffer.from([2]),
//   Buffer.from([3]),
//   69n,
// );

// const user = await db.densKey.create({
//   data: {
//     name: Buffer.from([0]),
//     slot: 69,
//   },
// });

// console.log(user);

// const address = "ws://127.0.0.1:1337"
//
// const wss = new ws.WebSocket(address)
//
// wss.on('open', function() {
//     console.log(`wahoo`);
//     wss.send(`cool`);
// });
//
//
// wss.on('message', function(data, _isBinary) {
//     console.log(`${data}`);
// });
//
//
// wss.on('close', function(data, _isBinary) {
//     console.log(`${data}`);
// });
//
