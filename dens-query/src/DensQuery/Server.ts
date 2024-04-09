import * as Db from "./Db.js";

import { default as express } from "express";
import type { RequestHandler } from "express";
import { ServerConfig } from "lbf-dens-db/LambdaBuffers/Dens/Config.mjs";
import { logger } from "./Logger.js";
import { default as getRawBody } from "raw-body";
import * as PJson from "prelude/Json.js";
import * as LbrPrelude from "lbr-prelude";
import * as LbDensServer from "lbf-dens-db/LambdaBuffers/Dens/Server.mjs";

/**
 * {@link lbJson} body parser using LambdaBuffers' JSON parser
 */
export const lbJson: RequestHandler = async (req, _res, next) => {
  const body = await getRawBody(req, { limit: "100kb", encoding: "utf-8" });
  try {
    req.body = PJson.parseJson(body);
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * {@link runServer} is an HTTP server which provides an interface to some of
 * the queries for the database
 */
export function runServer(
  config: ServerConfig,
  db: Db.DensDb,
): void {
  const app = express();
  const port = Number(config.port);

  app.use("/api", lbJson);

  app.post(`/api/query-set-insertion-utxo`, async (req, res) => {
    const { name } = LbrPrelude
      .Json[LbDensServer.QueryDensSetInsertionUtxoRequest].fromJson(req.body);

    const lkup = await db.densWithDbClient((client) => {
      return client.selectStrictInfimumDensSetUtxo(name);
    });

    if (lkup === undefined) {
      res.status(500);
      const resJson = LbrPrelude
        .Json[LbDensServer.QueryDensSetInsertionUtxoResponse].toJson(
          {
            name: `Failed`,
            fields: {
              error:
                `No set elements found. Most likely a misconfigured protocol.`,
            },
          },
        );
      res.send(PJson.stringify(resJson));
    } else if (lkup.isAlreadyInserted) {
      res.status(400);
      const resJson = LbrPrelude
        .Json[LbDensServer.QueryDensSetInsertionUtxoResponse].toJson({
          name: `Failed`,
          fields: { error: `${name.toString()} already exists.` },
        });
      res.send(PJson.stringify(resJson));
    } else {
      const resJson = LbrPrelude
        .Json[LbDensServer.QueryDensSetInsertionUtxoResponse].toJson({
          name: `Ok`,
          fields: lkup,
        });
      res.send(PJson.stringify(resJson));
    }
  });

  app.post(`/api/query-protocol-utxo`, async (_req, res) => {
    const lkup = await db.densWithDbClient((client) => {
      return client.selectProtocol();
    });

    if (lkup === undefined) {
      res.status(500);
      const resJson = LbrPrelude
        .Json[LbDensServer.QueryDensSetInsertionUtxoResponse].toJson(
          {
            name: `Failed`,
            fields: { error: `Failed to find protocol UTxO.` },
          },
        );
      res.send(PJson.stringify(resJson));
    } else {
      const resJson = LbrPrelude
        .Json[LbDensServer.QueryDensProtocolUtxoResponse].toJson({
          name: `Ok`,
          fields: lkup,
        });
      res.send(PJson.stringify(resJson));
    }
  });

  app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
  });
}