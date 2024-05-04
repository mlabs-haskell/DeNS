// NOTE(jaredponn):
//
// The JSON RPC responses we must implement are given in
// [[[powerdns-remote-backend]]]. The meaning of the parameters are more
// thorougly explained in [[[powerdns-backend-writers-guide]]].
//
// For our use case, we only need the
// * initialize: <https://doc.powerdns.com/authoritative/backends/remote.html#initialize>
// * lookup: <https://doc.powerdns.com/authoritative/backends/remote.html#lookup>
// as per instructions in the methods
// <https://doc.powerdns.com/authoritative/backends/remote.html#methods>
// section.
//
// * [[[powerdns-backend-writers-guide]]] https://doc.powerdns.com/authoritative/appendices/backend-writers-guide.html
// * [[[powerdns-remote-backend]]] https://doc.powerdns.com/authoritative/backends/remote.html
// * [[[powerdns-internals]]] https://doc.powerdns.com/authoritative/appendices/internals.html
import * as net from "node:net";

import { default as logger } from "./logger.js";
import { maxRequestLength, socketPath, socketTimeout } from "./constants.js";
import * as db from "./postgres.js";

/**
 * Unix domain socket server
 */
const server = net.createServer((c) => {
  logger.info(`Client connected`);

  c.setTimeout(socketTimeout);

  c.on(`timeout`, () => {
    logger.warn(`Client timed out.`);
    if (!c.writableEnded) {
      c.end(
        JSON.stringify({ result: false, log: [`Session timeout.`] } as Reply),
      );
    }
    c.destroySoon();
  });

  // TODO(jaredponn): This is awkward. We don't know when the JSON message is
  // done being sent until we've received the full JSON object. Ideally, we'd use
  // a push parser and resolve when we have a full parse, but in the interest of
  // time, we skip this and pray that any bad JSON is an "incomplete" JSON
  // object.
  // See <https://github.com/PowerDNS/pdns/blob/5e386641f208cf843e40094269e12de4e84170c5/modules/remotebackend/unixconnector.cc#L139-L158>.
  let chunks: string = ``;
  c.on("data", async (chunk) => {
    chunks += chunk;

    try {
      if (chunks.length >= maxRequestLength) {
        throw new Error(`Request too large.${chunks.length}`);
      }

      const req = JSON.parse(chunks);

      if (!isJsonQuery(req)) {
        throw new Error(`Invalid request.`);
      }

      const result = await app(req);

      if (c.writableEnded) {
        return;
      }

      c.end(JSON.stringify(result as Reply));
    } catch (err) {
      if (err instanceof SyntaxError) {
        return;
      }
      logger.warn(
        `${err}\nRequest:\n${chunks}${
          err instanceof Error ? `\nStack trace:\n${err.stack}` : ""
        }`,
      );
      c.end(JSON.stringify({ result: false, log: [`${err}`] } as Reply));
      c.destroySoon();
    }
  });

  c.on("close", (_hadError) => {
    logger.info(`Client closed.`);
  });
});

/**
 * A type for the types of JSON queries given from PowerDNS
 *
 * @see https://doc.powerdns.com/authoritative/backends/remote.html#queries
 */
interface Query {
  method: string;
  parameters: { [key: string]: unknown };
}

/**
 * Checks if the provided value is a Query
 */
export function isJsonQuery(json: unknown): json is Query {
  return json !== null && json instanceof Object && "method" in json &&
    typeof json["method"] === "string" && "parameters" in json &&
    json["parameters"] instanceof Object;
}

/**
 * A type for the types of JSON replies to PowerDNS
 *
 * @see https://doc.powerdns.com/authoritative/backends/remote.html#replies
 */
interface Reply {
  result: unknown;
  log?: string[];
}

/**
 * {@link app} is the core application logic which given an RPC requests,
 * returns the corresponding JSON object to send as the response.
 */
export async function app(req: Query): Promise<Reply> {
  switch (req.method) {
    case `initialize`: {
      return {
        result: true,
      };
    }

    case `lookup`: {
      if (
        !(`qtype` in req.parameters &&
          typeof req.parameters["qtype"] === `string`)
      ) {
        throw new Error(`Request missing \`parameters.qtype\` field`);
      }
      if (
        !(`qname` in req.parameters &&
          typeof req.parameters["qname"] === `string`)
      ) {
        throw new Error(`Request missing \`parameters.qname\` field`);
      }
      if (
        !(`zone-id` in req.parameters &&
          typeof req.parameters["zone-id"] === `number`)
      ) {
        throw new Error(`Request missing \`parameters.zone-id\` field`);
      }

      const qtype: string = req.parameters["qtype"];
      // remove the trailing dot. I think we should normalize this to
      // lowercase? Not sure if PowerDNS does this for us -- I may be
      // misrecalling / conjuring a false memory.
      const qname: string = req.parameters["qname"].slice(0, -1).toLowerCase();
      const zoneId: number = req.parameters["zone-id"];

      const response: Reply = {
        result: await db.queryLookup(qtype, qname, zoneId),
      };

      return response;
    }

    default: {
      return {
        result: false,
      };
    }
  }
}

server.listen(socketPath, () => {
  logger.info(`Listening on ${socketPath}...`);
});
