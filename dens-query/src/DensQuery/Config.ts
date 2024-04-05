import {
  Config,
  DbConfig,
  OgmiosConfig,
} from "lbf-dens-db/LambdaBuffers/Dens/Config.mjs";
import * as Prelude from "prelude";
import * as PlaV1 from "plutus-ledger-api/V1.js";

// Rexport LB things
export { Config, DbConfig, OgmiosConfig };

export const config: Config = {
  ogmios: { host: "127.0.0.1", port: 1337n },
  db: {
    host: `127.0.0.1`,
    port: 5432n,
    user: `dens`,
    password: ``,
    database: `dens`,
  },
  initSqlFile: "./api/postgres/dens.sql",
  protocolNft: [
    Prelude.fromJust(PlaV1.currencySymbolFromBytes(Uint8Array.from([]))),
    Prelude.fromJust(PlaV1.tokenNameFromBytes(Uint8Array.from([]))),
  ],
};

export async function initConfig(): Promise<void> {
  // TODO(jaredponn): fill me in
  await Promise.resolve(3);
  return;
}

export default config;
