import * as Db from "./Db.js";

import { default as express } from "express";
import type { ErrorRequestHandler, RequestHandler } from "express";
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

  app.use("/api", lbJson);

  app.post(`/api/check-health`, (req, res) => {
    res.send(PJson.stringify(req.body));
  });

  app.post(`/api/query-set-insertion-utxo`, async (req, res, next) => {
    try {
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
    } catch (err) {
      next(err);
    }
  });

  app.post(`/api/set-protocol-nft`, async (req, res, next) => {
    try {
      const { protocolNft } = LbrPrelude
        .Json[LbDensServer.SetProtocolNftRequest].fromJson(req.body);

      const newProtocolNft = await db.densWithDbClient((client) => {
        return client.setProtocolNft(protocolNft);
      });

      const resJson = LbrPrelude
        .Json[LbDensServer.SetProtocolNftResponse].toJson(
          {
            name: `Ok`,
            fields: { protocolNft: newProtocolNft },
          },
        );
      res.send(PJson.stringify(resJson));
    } catch (err) {
      next(err);
    }
  });

  app.post(`/api/query-protocol-utxo`, async (_req, res, next) => {
    try {
      const lkup = await db.densWithDbClient((client) => {
        return client.selectProtocol();
      });

      if (lkup === undefined) {
        res.status(500);
        const resJson = LbrPrelude
          .Json[LbDensServer.QueryDensProtocolUtxoResponse].toJson(
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
    } catch (err) {
      next(err);
    }
  });

  // Custom error handler s.t. we don't generate a full HTML page for the
  // errors.
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    logger.warn(`Bad request: ${err}`);
    res.status(500).send(err.toString());
  };
  app.use(errorHandler);

  switch (config.name) {
    case `InternetDomain`: {
      const host = config.fields.host;
      const port = Number(config.fields.port);

      app.listen(port, host, () => {
        logger.info(`Server running on host ${host} and port ${port}`);
      });
      break;
    }
    case `UnixDomain`: {
      const path = config.fields.path;
      app.listen(path, () => {
        logger.info(`Server running Unix domain socket: '${path}`);
      });
      break;
    }
  }
}
