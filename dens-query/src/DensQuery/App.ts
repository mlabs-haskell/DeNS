/**
 * Main entry point of the program
 */

import { config, initSqlFile } from "./Config.js";
import * as ChainSync from "./ChainSync.js";
import * as Db from "./Db.js";
import * as Server from "./Server.js";

// Initialize the database
const db = new Db.DensDb(config.database);
await db.densInit(initSqlFile);

// Run the chain sync
await ChainSync.runChainSync(config.protocolNft, config.ogmios, db);

// Run the HTTP server
Server.runServer(config.server, db);
