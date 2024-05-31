/**
 * @remarks
 * Most of the code was taken from {@link
 * https://github.com/75lb/command-line-args/wiki/Implement-command-parsing-(git-style)}
 * as per instructions of the library
 */
import { default as commandLineArgs } from "command-line-args";
import { default as commandLineUsage } from "command-line-usage";
import * as DensTransactions from "./DensTransactions.js";
import * as Utils from "./Utils.js";
import * as Logger from "./Logger.js";
import * as Lucid from "lucid-cardano";
import { UnixDomainOrInternetDomain } from "lbf-dens-db/LambdaBuffers/Dens/Config.mjs";
import { DensRr } from "lbf-dens/LambdaBuffers/Dens.mjs";

export interface CliOpts {
  "ogmios-host": string;
  "ogmios-port": number;
  "private-key-bech32": string;
  "network": string;
  "protocol-nft-tx-out-ref": string;
  "dens-query-socket-path": string;
}

/**
 * Parameters from the CLI options and initializes the system.
 */
export async function mkLucidAndDensParamsFromCliOpts(
  obj: { [key: string]: unknown },
): Promise<
  {
    lucid: Lucid.Lucid;
    densParams: Utils.DeNSParams;
    protocolNftOutRef: Lucid.OutRef;
    densQuery: UnixDomainOrInternetDomain;
  }
> {
  // TODO(jaredponn): parse this properly
  const opts = obj as unknown as CliOpts;

  const lucid = await Utils.mkLucid(
    opts["ogmios-host"],
    opts["ogmios-port"],
    opts["network"] as Lucid.Network,
  );
  await lucid.selectWalletFromPrivateKey(opts["private-key-bech32"]);

  // It's the hash of blake2b 256, so 32 bytes, so 64 hex digits
  // <hash>#<index>
  // TODO(jaredponn): cram this in the type parser {@link https://github.com/75lb/command-line-args/wiki/Custom-type-example}
  const protocolNftOutRef: Lucid.OutRef = (() => {
    const txOutRefRegex = /^(?<txHash>[0-9a-f]{64})#(?<outputIndex>\d+)$/ig;
    const matches = opts["private-key-bech32"].match(txOutRefRegex);
    return {
      txHash: matches.groups["txHash"],
      outputIndex: parseInt(matches.groups["outputIndex"]),
    };
  })();

  const densQuery: UnixDomainOrInternetDomain = {
    name: "UnixDomain",
    fields: { path: opts["dens-query-socket-path"] },
  };
  const densParams = await Utils.mkParams(lucid, protocolNftOutRef, densQuery);

  return { lucid, densParams, protocolNftOutRef, densQuery };
}

/* First, parse the main command */
const mainDefinitions = [
  { name: "command", defaultOption: true },
];
const mainOptions = commandLineArgs(mainDefinitions, {
  stopAtFirstUnknown: true,
});
const argv = mainOptions._unknown || [];

/**
 * {@link commonDefinitions} are the command line options which are common to
 * all subcommands of the CLI interface
 */
const commonDefinitions = [
  { name: "ogmios-host", type: String, description: `Host for ogmios` },
  { name: "ogmios-port", type: Number, description: `Port for ogmios` },
  {
    name: "private-key-bech32",
    type: String,
    description:
      `Human readable bech32 encoding of a private key used to balance transactions`,
  },
  {
    name: "network",
    type: String,
    description:
      `The network connected to. Either: 'Mainnet', 'Preview', 'Preprod', or 'Custom'`,
  },
  {
    name: "protocol-nft-tx-out-ref",
    type: String,
    description:
      `The transaction output reference used to initialize the protocol of the form: <tx-hash>#<output-index> where <tx-hash> is hex encoded and <output-index> is the base 10 representation e.g. aa..aa#0`,
  },
  {
    name: "dens-query-socket-path",
    type: String,
    description: `Socket path to connect to the dens-query server`,
  },
  { name: "help", type: Boolean, description: `Display this help menu` },
];

/* Second, parse command options */
switch (mainOptions["command"]) {
  case `init`: {
    const defns = commonDefinitions;
    const usage = commandLineUsage(
      [{
        header: "init",
        content: "CLI endpoint for initializing the DeNS protocol",
      }, { header: "Options", optionList: defns }],
    );

    const rawOptions = commandLineArgs(defns, { argv });
    if (rawOptions["help"]) {
      console.error(usage);
      process.exit(1);
    }

    const { lucid, densParams, protocolNftOutRef } =
      await mkLucidAndDensParamsFromCliOpts(rawOptions);

    const tx = await DensTransactions.initializeDeNS(
      lucid,
      densParams,
      protocolNftOutRef,
    );
    const txHash = await Utils.signAndSubmitTx(tx);
    Logger.logger.info(`Tx hash: ${txHash}`);

    {
      const utils = new Lucid.Utils(lucid);
      Logger.logger.info(
        `Protocol token: ${
          JSON.stringify({
            currency_symbol: utils.mintingPolicyToId(densParams.protocolPolicy),
            token_name: "",
          })
        } `,
      );
    }
    await lucid.awaitTx(txHash);

    break;
  }

  case `register-domain`: {
    const defns = commonDefinitions.concat([{
      name: "domain-name",
      type: String,
      description: `Domain name to purchase e.g. mydomain.com`,
    }]);

    const usage = commandLineUsage(
      [{
        header: "register-domain",
        content: "CLI endpoint for registering a domain with the DeNS protocol",
      }, { header: "Options", optionList: defns }],
    );

    const rawOptions = commandLineArgs(defns, { argv });

    if (rawOptions["help"]) {
      console.error(usage);
      process.exit(1);
    }

    const { lucid, densParams, densQuery } =
      await mkLucidAndDensParamsFromCliOpts(rawOptions);

    const tx = await DensTransactions.registerDomain(
      lucid,
      densParams,
      rawOptions["domain-name"],
      densQuery,
    );
    const txHash = await Utils.signAndSubmitTx(tx);
    Logger.logger.info(`Tx hash: ${txHash}`);

    await lucid.awaitTx(txHash);

    break;
  }

  case `update-record`: {
    const defns = commonDefinitions.concat(
      [
        {
          name: "domain-name",
          type: String,
          description: `Domain name to purchase e.g. mydomain.com`,
        },
        {
          name: "a-record",
          type: String,
          description:
            `A record of the form <ttl>,<content> where <ttl> is non-negative integer for the time to live, and <content> is the content for an A record`,
        },
        ,
        {
          name: "aaaa-record",
          type: String,
          description:
            `A record of the form <ttl>,<content> where <ttl> is non-negative integer for the time to live, and <content> is the content for an AAAA record`,
        },
        ,
        {
          name: "soa-record",
          type: String,
          description:
            `A record of the form <ttl>,<content> where <ttl> is non-negative integer for the time to live, and <content> is the content for an SOA record`,
        },
      ],
    );

    const usage = commandLineUsage(
      [{
        header: "update-record",
        content:
          "CLI endpoint for updating the RRs associated with a domain name",
      }, { header: "Options", optionList: defns }],
    );

    const rawOptions = commandLineArgs(defns, { argv });

    if (rawOptions["help"]) {
      console.error(usage);
      process.exit(1);
    }

    const { lucid, densParams, densQuery } =
      await mkLucidAndDensParamsFromCliOpts(rawOptions);
    const userAddress = await lucid.wallet.address();

    // Parse the RRs from the CLI interface
    const parseTtlAndContent = (
      str: string,
      f: (record: string, ttl: number) => DensRr,
    ): DensRr => {
      const ttlAndContentRegex = /^(?<ttl>\d+),(?<content>.*)$/g;
      const matches = str.match(ttlAndContentRegex);

      const ttl = parseInt(matches.groups["ttl"]);
      const content = matches.groups["content"];

      return f(content, ttl);
    };

    const rrs = [].concat(
      rawOptions["a-record"] === undefined
        ? []
        : rawOptions["a-record"].map((rr: string) =>
          parseTtlAndContent(rr, Utils.mkARecord)
        ),
    )
      .concat(
        rawOptions["aaaa-record"] === undefined
          ? []
          : rawOptions["aaaa-record"].map((rr: string) =>
            parseTtlAndContent(rr, Utils.mkAAAARecord)
          ),
      )
      .concat(
        rawOptions["soa-record"] === undefined
          ? []
          : rawOptions["soa-record"].map((rr: string) =>
            parseTtlAndContent(rr, Utils.mkSOARecord)
          ),
      );

    const tx = await DensTransactions.updateRecord(
      lucid,
      densParams,
      userAddress,
      rawOptions["domain-name"],
      Utils.mkRecordDatum(rawOptions["domain-name"], rrs),
      densQuery,
    );
    const txHash = await Utils.signAndSubmitTx(tx);
    Logger.logger.info(`Tx hash: ${txHash}`);

    await lucid.awaitTx(txHash);

    break;
  }

  default: {
    const sections = [
      {
        header: "dens-transactions-cli",
        content:
          "CLI interface for creating transactions to interact with the DeNS protocol",
      },
      {
        header: "Synopsis",
        content: "$ dens-transactions-cli <command> <options>",
      },
      {
        header: "Command List",
        content: [
          { name: "init", summary: "Initializing the DeNS protocol" },
          {
            name: "register-domain",
            summary: "Registering a domain with the DeNS protocol",
          },
          {
            name: "update-record",
            summary: "Updating the records associated with a domain name",
          },
        ],
      },
    ];
    const usage = commandLineUsage(sections);
    console.error(usage);
    process.exit(1);
  }
}
