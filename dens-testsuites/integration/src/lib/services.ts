/**
 * Provides functionality for spawning a local instance of all the runtime
 * services (safe for parallel execution with high probability).
 *
 * @module
 */

// https://www.rfc-editor.org/rfc/rfc6335.html
import * as child_process from "node:child_process";
import type { ChildProcess } from "node:child_process";
import process from "node:process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as timers from "timers/promises";
import * as path from "node:path";
import { Config } from "lbf-dens-db/LambdaBuffers/Dens/Config.mjs";

import chalk from "chalk";

import * as utils from "./utils.js";

import * as PlaV1 from "plutus-ledger-api/V1.js";
import * as P from "prelude";
import * as PJson from "prelude/Json.js";
import * as LbrPrelude from "lbr-prelude";

interface Cardano {
  /** Path to UNIX domain socket that the cardano node is running on */
  socketPath: string;
  /** Path to the node's config */
  nodeConfigPath: string;
  /** Wallet key pairs (secret key, and private key) */
  walletKeyPairs: { signingKey: Uint8Array; verificationKey: Uint8Array }[];

  childProcess: ChildProcess;
}

interface Database {
  /** Path to UNIX domain socket that the database is running on */
  socketPath: string;

  childProcess: ChildProcess;
}

interface Ogmios {
  /** Path to UNIX domain socket */
  host: string;
  port: string;

  childProcess: ChildProcess;
}

interface DensQuery {
  /** Path to UNIX domain socket that dens query is listening on */
  socketPath: string;

  childProcess: ChildProcess;
}

/**
 * {@link Services} a class to
 */
export class Services {
  cardano: Cardano;
  database: Database;
  ogmios: Ogmios;
  densQuery: DensQuery;

  constructor(
    cardano: Cardano,
    database: Database,
    ogmios: Ogmios,
    densQuery: DensQuery,
  ) {
    this.cardano = cardano;
    this.database = database;
    this.ogmios = ogmios;
    this.densQuery = densQuery;
  }

  /**
   * Spawns all runtime services for the DeNS protocol (safe for parallel
   * execution with high probability)
   */
  static async spawn(numWallets = 3): Promise<Services> {
    const [cardano, database] = await Promise.all([
      spawnPlutip(numWallets),
      spawnDatabase(),
    ]);
    const ogmios = await spawnOgmios(cardano);
    const densQuery = await spawnDensQuery(database, ogmios);
    return new Services(cardano, database, ogmios, densQuery);
  }

  kill(): Promise<void> {
    this.cardano.childProcess.kill("SIGINT");
    this.database.childProcess.kill("SIGINT"); // See {@link https://www.postgresql.org/docs/current/server-shutdown.html}
    this.ogmios.childProcess.kill("SIGINT");
    this.densQuery.childProcess.kill("SIGINT");

    return Promise.resolve();
  }
}

/**
 * This is needed because of the awkwardness of knowing when plutip is
 * initialized... Plutip will dump a bunch of files to the file system, and we
 * have to poll until they exist / are written to.
 *
 * Various tricks of using node's inotify / kqueue wrapper for the filesystem
 * don't play nicely with internals of plutip -- namely, plutip likes to delete
 * the directory and recreate it (making inotify useless for plutip as it
 * watches the inodes).
 *
 * Moreover, node's wrapper of inotify/kqueue isn't guaranteed to provide the
 * file name, and we need the file name
 *
 * TODO(jaredponn): it'd be great if we could remove the polling... Just write
 * it in C and do the system calls yourself :^)
 * @internal
 */
async function poll<A>(action: () => Promise<A | undefined>): Promise<A> {
  // NOTE(jaredponn): 2^13 = 8192 is about 8 seconds
  const MAX_RETRIES = 13;
  let DELAY = 2;

  await timers.setTimeout(DELAY);

  let result = await action();

  for (let i = 0; i < MAX_RETRIES && result === undefined; ++i) {
    await timers.setTimeout(DELAY *= 2);
    result = await action();
  }

  if (result === undefined) {
    throw new Error(`polling timed out`);
  }

  return result;
}

/**
 * Polls, and reads / parses the provided JSON file
 *
 * @remarks
 * This will poll until the file exists, and `JSON.parse` can parse it. The
 * latter condition is to accept partial writes of JSON files
 */
// deno-lint-ignore no-explicit-any
async function pollReadJsonFile(filePath: string): Promise<any | undefined> {
  const result = await poll(
    () =>
      fs.readFile(filePath, { encoding: "utf8" })
        .then((contents) => JSON.parse(contents))
        .catch((err) => {
          if (err.code === "ENOENT") {
            return undefined;
          } else if (err instanceof SyntaxError) {
            return undefined;
          } else {
            return Promise.reject(err);
          }
        }),
  );
  return result;
}

async function spawnDensQuery(
  database: Database,
  ogmios: Ogmios,
): Promise<DensQuery> {
  // Create the database user / names
  const densUserName = `dens`;
  const createDensUserProcess = child_process.spawn(`createuser`, [
    `-h`,
    database.socketPath,
    `-d`,
    `-r`,
    densUserName,
  ], { stdio: ["ignore", "ignore", "inherit"] });

  await new Promise<void>((resolve, reject) =>
    createDensUserProcess.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`createuser failed`));
      }
      resolve();
    })
  );

  const densDatabase = `dens`;
  const createDensDbProcess = child_process.spawn(`createdb`, [
    `-h`,
    database.socketPath,
    `-O`,
    densUserName,
    densDatabase,
  ], { stdio: ["ignore", "ignore", "inherit"] });

  await new Promise<void>((resolve, reject) =>
    createDensDbProcess.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`createdb failed`));
      }
      resolve();
    })
  );

  // Create a temporary directory to put dens-query's files
  const densQueryDir = await fs.mkdtemp(path.join(os.tmpdir(), `dens-query-`));
  console.error(chalk.blue(`dens-query working directory:\n\t${densQueryDir}`));

  // Create the database user / names
  const socketPath = path.join(densQueryDir, `.s.dens-query`);
  const zeroCurrencySymbolBytes = [];
  for (let i = 0; i < 28; ++i) {
    zeroCurrencySymbolBytes.push(0);
  }

  const config: Config = {
    ogmios: { url: `ws://${ogmios.host}:${ogmios.port}` },
    database: {
      socket: { name: `UnixDomain`, fields: { path: database.socketPath } },
      user: densUserName,
      password: ``,
      database: densDatabase,
    },
    server: { name: `UnixDomain`, fields: { path: socketPath } },
    protocolNft: [
      P.fromJust(
        PlaV1.currencySymbolFromBytes(Uint8Array.from(zeroCurrencySymbolBytes)),
      ),
      PlaV1.adaToken,
    ],
  };

  const configFileName = path.join(densQueryDir, `config.json`);
  await fs.appendFile(
    configFileName,
    PJson.stringify(LbrPrelude.Json[Config].toJson(config)),
  );

  // Start dens-query
  const env = JSON.parse(JSON.stringify(process.env)); // silly way to copy the current environment
  env["DENS_QUERY_CONFIG"] = configFileName;

  const densQueryProcess = child_process.spawn(`dens-query-cli`, [], {
    env,
    stdio: [`inherit`, `inherit`, `inherit`],
    cwd: densQueryDir,
  });

  process.once("exit", () => {
    if (densQueryProcess.killed === false) {
      densQueryProcess.kill();
    }
  });

  densQueryProcess.on("close", (code, signal) => {
    if (code === 0 || signal === "SIGINT") {
      return;
    }
    throw new Error(`dens-query-cli failed with exit code ${code}`);
  });

  // FIXME(jaredponn): we wait 15 seconds to let initialize. Change this to poll
  // dens-query until it replies
  poll(async () => {
    try {
      await fs.access(socketPath);
      return true;
    } catch (err) {
      if (
        err !== null && typeof err === "object" && "code" in err &&
        err.code === "ENOENT"
      ) {
        return undefined;
      } else {
        throw err;
      }
    }
  });

  return { socketPath, childProcess: densQueryProcess };
}

/**
 * Spawns an ogmios connection
 */
function spawnOgmios(cardano: Cardano): Promise<Ogmios> {
  // See {@link https://www.rfc-editor.org/rfc/rfc6335.html}'s Dynamic ports
  // for why we choose this range
  const host = "127.0.0.1";
  const port = Math.floor(Math.random() * ((65535 + 1) - 49152)) + 49152;

  console.error(chalk.blue(`Ogmios listening on: \n\t${host}:${port}`));

  const ogmiosProcess = child_process.spawn(`ogmios`, [
    `--node-socket`,
    cardano.socketPath,
    `--node-config`,
    cardano.nodeConfigPath,
    `--host`,
    host,
    `--port`,
    port.toString(),
  ], { stdio: [`ignore`, `ignore`, `inherit`] });

  process.once("exit", () => {
    if (ogmiosProcess.killed === false) {
      ogmiosProcess.kill();
    }
  });

  return Promise.resolve({
    host,
    port: port.toString(),
    childProcess: ogmiosProcess,
  });
}

/**
 * Spawns a postgres database
 */
async function spawnDatabase(): Promise<Database> {
  const result: Database = {} as Database;
  const postgresDir = await fs.mkdtemp(path.join(os.tmpdir(), `postgres-`));

  console.error(chalk.blue(`Postgres working directory:\n\t${postgresDir}`));
  console.error(
    chalk.yellow(
      `To restart Postgres execute:\n\tcd ${postgresDir} && postgres -h '' -k ${postgresDir} -D ${postgresDir}`,
    ),
  );
  console.error(
    chalk.yellow(
      `To connect to Postgres via psql execute:\n\tpsql -h ${postgresDir}`,
    ),
  );

  {
    // Use `initdb` to initialize the database
    const initDbChildProcess = child_process.spawn(`initdb`, [
      `--auth`,
      `trust`,
      `--pgdata`,
      postgresDir,
    ], { stdio: [`ignore`, `ignore`, `inherit`] });

    await new Promise<void>((resolve, reject) =>
      initDbChildProcess.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`initdb failed with exit code ${code}`));
        }
      })
    );
  }

  {
    // Actually spawn postgres

    // NOTE(jaredponn): we only make postgres listen on its unix domain
    // socket to help ensure "locality" of the test (running on the IP
    // protocol will consume a precious port)
    const postgresChildProcess = child_process.spawn(`postgres`, [
      `-h`,
      ``,
      `-k`,
      postgresDir,
      `-D`,
      postgresDir,
      `-r`,
      path.join(postgresDir, `logs.output`),
    ], { stdio: [`ignore`, `ignore`, `ignore`] });

    // Somewhere in the postgres docs it says this is what the socket is
    // named
    result.socketPath = path.join(postgresDir);
    result.childProcess = postgresChildProcess;

    process.once("exit", () => {
      if (postgresChildProcess.killed === false) {
        postgresChildProcess.kill();
      }
    });
  }

  // Busy loop until postgres is ready
  await poll(() =>
    new Promise<boolean | undefined>((resolve) => {
      const pgIsReadChildProcess = child_process.spawn(`pg_isready`, [
        `-d`,
        `postgres`,
        `-h`,
        result.socketPath,
      ], {});

      pgIsReadChildProcess.on("close", (code) => {
        if (code === 0) {
          return resolve(true);
        } else {
          return resolve(undefined);
        }
      });
    })
  );

  return result;
}

async function spawnPlutip(numWallets: number): Promise<Cardano> {
  const result = {} as unknown as Cardano;
  /**
   * Spawning plutip
   */
  const plutipDir = await fs.mkdtemp(path.join(os.tmpdir(), `plutip-`));
  const plutipWalletsDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `plutip-wallets-`),
  );
  const localClusterInfoBaseName = `local-cluster-info.json`;
  const localClusterInfoJsonPath = path.join(
    plutipDir,
    localClusterInfoBaseName,
  );

  console.error(chalk.blue(`Plutip wallets directory:\n\t${plutipWalletsDir}`));
  console.error(chalk.blue(`Plutip working directory:\n\t${plutipDir}`));

  const childProcess = child_process.spawn(`local-cluster`, [
    `--working-dir`,
    plutipDir,
    `--dump-info-json`,
    localClusterInfoJsonPath,
    `--num-wallets`,
    numWallets.toString(),
    `--wallets-dir`,
    plutipWalletsDir,
  ], { stdio: [`ignore`, `ignore`, `ignore`] });

  result.childProcess = childProcess;

  const localClusterInfo = await pollReadJsonFile(localClusterInfoJsonPath);

  {
    // Adding the `socketPath` and `nodeConfigPath` fields
    if (
      !(localClusterInfo?.ciNodeSocket !== undefined &&
        typeof localClusterInfo.ciNodeSocket === "string")
    ) {
      throw new Error(
        `Malformed local-cluster-info.json invalid 'ciNodeSocket' key at ${localClusterInfoJsonPath}`,
      );
    }

    result.socketPath = localClusterInfo.ciNodeSocket;
    // NOTE(jaredponn): by inspection of the generated code,
    // the `node.config` file is put here.
    result.nodeConfigPath = path.join(
      path.dirname(result.socketPath),
      `node.config`,
    );
  }

  {
    // Adding the public / private keys of the wallets
    result.walletKeyPairs = [];
    if (
      !(localClusterInfo?.ciWallets !== undefined &&
        Array.isArray(localClusterInfo.ciWallets))
    ) {
      throw new Error(
        `Malformed local-cluster-info.json invalid 'ciWallets' key at ${localClusterInfoJsonPath}`,
      );
    }

    const publicAndPrivateKeyTasks = [];

    // NOTE(jaredponn): Note that the local-cluster-info.json has an array of
    // [public key hash, bech32 of verification key]
    // {@link https://github.com/mlabs-haskell/plutip/blob/37f6303f1ddff66c5ab5d73cd065b9b98511cea0/local-cluster/Main.hs#L86-L98}
    for (const ciWallet of localClusterInfo.ciWallets) {
      if (!(Array.isArray(ciWallet) && ciWallet.length === 2)) {
        throw new Error(
          `Malformed local-cluster-info.json invalid array element of '${ciWallet}' in 'ciWallets' key at ${localClusterInfoJsonPath}`,
        );
      }

      const [publicKeyHash, _bech32VKey] = ciWallet;

      // NOTE(jaredponn): by inspection of the generated values, the files
      // are of the form
      // ```
      // signing-key-<the public key hash i.e., 28 pairs of hex digits>.skey
      // ```
      // with contents
      // ```
      // {
      //     "type": "PaymentSigningKeyShelley_ed25519",
      //     "description": "Payment Signing Key",
      //     "cborHex": "58208101d38823613974976d5032fb66f6165808d63eaa861d36f65a6d8786964249"
      // }
      // ```
      // and
      // ```
      // verification-key-<the public key hash i.e., 28 pairs of hex digits>.vkey
      // ```
      // with contents
      // ```
      // {
      //     "type": "PaymentSigningKeyShelley_ed25519",
      //     "description": "Payment Signing Key",
      //     "cborHex": "58208101d38823613974976d5032fb66f6165808d63eaa861d36f65a6d8786964249"
      // }
      // ```
      //
      // See the source code {@link
      // https://github.com/mlabs-haskell/plutip/blob/37f6303f1ddff66c5ab5d73cd065b9b98511cea0/src/Plutip/Keys.hs#L60-L74}
      // for details

      const vkeyPath = path.join(
        plutipWalletsDir,
        `verification-key-${publicKeyHash}.vkey`,
      );
      const skeyPath = path.join(
        plutipWalletsDir,
        `signing-key-${publicKeyHash}.skey`,
      );

      publicAndPrivateKeyTasks.push(
        Promise.all([pollReadJsonFile(vkeyPath), pollReadJsonFile(skeyPath)])
          .then((_) =>
            Promise.all([vkeyPath, skeyPath].map(
              (p) =>
                fs.readFile(p, { encoding: "utf8" })
                  .then((contents) => JSON.parse(contents)),
            ))
          )
          .then((jsons) => {
            const [vkeyJson, skeyJson] = jsons;
            if (
              !(vkeyJson?.cborHex !== undefined &&
                typeof vkeyJson.cborHex === "string")
            ) {
              throw new Error(`Malformed verification key file at ${vkeyPath}`);
            }
            if (
              !(skeyJson?.cborHex !== undefined &&
                typeof skeyJson.cborHex === "string")
            ) {
              throw new Error(`Malformed verification key file at ${vkeyPath}`);
            }

            result.walletKeyPairs.push(
              {
                signingKey: utils.cborHexPrivateKey(skeyJson.cborHex)
                  .as_bytes(),
                verificationKey: utils.cborHexPublicKey(vkeyJson.cborHex)
                  .as_bytes(),
              },
            );
          }),
      );
    }

    await Promise.all(publicAndPrivateKeyTasks);
  }

  process.once("exit", () => {
    if (childProcess.killed === false) {
      childProcess.kill();
    }
  });

  return result;
}
