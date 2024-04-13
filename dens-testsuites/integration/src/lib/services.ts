/**
 * Provides functionality for spawning a local instance of all the runtime
 * services (safe for parallel execution with high probability).
 *
 * @module
 */

// https://www.rfc-editor.org/rfc/rfc6335.html
import * as child_process from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as timers from "timers/promises";
import * as path from "node:path";

import chalk from "chalk";

import * as utils from "./utils.js";
// import * as Pla from "plutus-ledger-api/V1.js";

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

/**
 * {@link Services} a class to
 */
export class Services {
  cardano: Cardano;
  database: Database;
  ogmios: Ogmios;

  constructor(cardano: Cardano, database: Database, ogmios: Ogmios) {
    this.cardano = cardano;
    this.database = database;
    this.ogmios = ogmios;
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
    return new Services(cardano, database, ogmios);
  }

  kill(): Promise<void> {
    this.cardano.childProcess.kill("SIGINT");
    this.database.childProcess.kill("SIGINT"); // See {@link https://www.postgresql.org/docs/current/server-shutdown.html}
    this.ogmios.childProcess.kill("SIGINT");
  }
}

// export class DensQueryService {
//   static async spawn(
//     protocolNft: [string],
//     services: Services,
//   ): Promise<DensQueryService> {
//     const [cardano, database] = await Promise.all([
//       spawnPlutip(numWallets),
//       spawnDatabase(),
//     ]);
//     const ogmios = await spawnOgmios(cardano);
//     return new Services(cardano, database, ogmios);
//   }
// }

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
  ]);

  return { host, port: port.toString(), childProcess: ogmiosProcess };
}

/**
 * Spawns a postgres database
 */
async function spawnDatabase(): Promise<Database> {
  const result: Database = {} as Database;
  const postgresDir = await fs.mkdtemp(path.join(os.tmpdir(), `postgres-`));

  console.error(chalk.blue(`Postgres working directory:\n\t${postgresDir}`));

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
    ], { stdio: [`ignore`, `ignore`, `inherit`] });

    // Somewhere in the postgres docs it says this is what the socket is
    // named
    result.socketPath = path.join(postgresDir);
    result.childProcess = postgresChildProcess;
  }

  // Busy loop until postgres is ready
  await poll(() =>
    new Promise<boolean | undefined>((resolve) => {
      const pgIsReadChildProcess = child_process.spawn(`pg_isready`, [
        `-d`,
        `postgres`,
        `-h`,
        result.socketPath,
      ]);

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
  ], { stdio: [`ignore`, `ignore`, `inherit`] });

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

  return result;
}
