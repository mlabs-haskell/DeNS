import * as child_process from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as dns from "node:dns/promises";
import { poll } from "./utils.js";

export class Pdns {
  public localPort: number;
  public childProcess: ChildProcess;

  public stdoutLog: string;
  public stderrLog: string;

  public cwd: string;

  private constructor(
    cwd: string,
    localPort: number,
    childProcess: ChildProcess,
  ) {
    this.cwd = cwd;
    this.localPort = localPort;
    this.childProcess = childProcess;
    this.stdoutLog = "";
    this.stderrLog = "";
  }

  public kill() {
    if (!this.childProcess.killed) {
      this.childProcess.kill();
    }
    process.off("exit", this.kill);
  }

  public static async new(options: { pdnsConf: string }) {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), `pdns-`));

    await fs.writeFile(path.join(cwd, `pdns.conf`), options.pdnsConf);

    // Choose a random port for pdns to run on. With high probability, this
    // should be free.
    // See {@link https://www.rfc-editor.org/rfc/rfc6335.html}'s Dynamic ports
    // for why we choose this range
    const localPort = Math.floor(Math.random() * ((65535 + 1) - 49152)) + 49152;

    const pdnsServer = child_process.spawn(`pdns_server`, [
      `--config-dir=${cwd}`,
      `--socket-dir=${cwd}`,
      `--local-port=${localPort}`,
    ]);

    const result = new Pdns(cwd, localPort, pdnsServer);
    {
      pdnsServer.stderr.on("data", (chunk) => result.stderrLog += chunk);
      pdnsServer.stdout.on("data", (chunk) => result.stdoutLog += chunk);
    }

    process.once("exit", (_) => result.kill());

    const resolver = new dns.Resolver();
    resolver.setServers([`127.0.0.1:${result.localPort}`]);

    await poll(async () => {
      try {
        await resolver.resolve4(`taylorswift.com`);
        return true;
      } catch (err) {
        if (
          err !== null && typeof err === "object" && `code` in err &&
          err?.code === `ECONNREFUSED`
        ) {
          return undefined;
        }
        if (
          err !== null && typeof err === "object" && `code` in err &&
          err?.code === dns.REFUSED
        ) {
          return true; // NOTE(jaredponn): If the DNS server refused the query, then it's ready and can answer queries. See <https://nodejs.org/api/dns.html#error-codes>
        }
        throw err;
      }
    });

    return result;
  }

  /**
   * Pretty prints information relating to the running instance of PowerDNS
   */
  public pdnsInfo(): string {
    return `pdns working directory: ${this.cwd}\n` +
      `pdns running on port: ${this.localPort}`;
  }
}

/**
 * Creates a trivial `pdns.conf` file with this as a remote-backend
 *
 * `remoteConnectionString` should be something like
 * ```
 * remote-connection-string=unix:path=/path/to/socket
 * ```
 */
export function mkPdnsConf(options: { remoteConnectionString: string }) {
  const tmp = `
launch=remote
remote-connection-string=${options.remoteConnectionString}

# https://doc.powerdns.com/authoritative/backends/remote.html#getalldomains
zone-cache-refresh-interval=0
`;
  return tmp;
}
