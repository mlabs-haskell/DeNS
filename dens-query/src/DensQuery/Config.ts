/**
 * Global static read only configuration including:
 *
 *  - {@link config}: object for the configuration
 *
 * See {@link initConfig} for initially setting this.
 */
import {
  Config,
  DbConfig,
  OgmiosConfig,
  ServerConfig,
} from "lbf-dens-db/LambdaBuffers/Dens/Config.mjs";
import * as LbrPrelude from "lbr-prelude";
import * as Prelude from "prelude";

import { readFile } from "node:fs/promises";

// Rexport LB things
export { Config, DbConfig, OgmiosConfig, ServerConfig };

const DENS_QUERY_CONFIG_ENV_VAR = "DENS_QUERY_CONFIG";
const DENS_QUERY_INIT_SQL_FILE_ENV_VAR = "DENS_QUERY_INIT_SQL_FILE";

/**
 * {@link initConfig} reads the environment variable {@link
 * DENS_QUERY_CONFIG_ENV_VAR}, opens the file, and parses the {@link Config}.
 */
export async function initConfig(): Promise<Config> {
  const configFile = process.env[DENS_QUERY_CONFIG_ENV_VAR];
  if (configFile === undefined) {
    throw new Error(
      `environment variable ${DENS_QUERY_CONFIG_ENV_VAR} is undefined. Please provide a configuration file.`,
    );
  }
  const contents = await readFile(configFile, { encoding: "utf8" });
  const value = Prelude.parseJson(contents);
  const cfg = LbrPrelude.Json[Config].fromJson(value);

  return cfg;
}

export const config: Config = await initConfig();
export const initSqlFile: string = (() => {
  const initSqlFile = process.env[DENS_QUERY_INIT_SQL_FILE_ENV_VAR];
  if (initSqlFile === undefined) {
    throw new Error(
      `environment variable ${DENS_QUERY_INIT_SQL_FILE_ENV_VAR} is undefined, so no init SQL file was found.`,
    );
  }
  return initSqlFile;
})();
