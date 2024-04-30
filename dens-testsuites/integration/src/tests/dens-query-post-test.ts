import test from "node:test";
import assert from "node:assert";
import { Services } from "../lib/services.js";
import * as http from "node:http";

import * as P from "prelude";
import * as PJson from "prelude/Json.js";
import * as PlaV1 from "plutus-ledger-api/V1.js";
import * as LbrPrelude from "lbr-prelude";
import * as LbDensServer from "lbf-dens-db/LambdaBuffers/Dens/Server.mjs";

/**
 * {@link HttpTester}
 */
class HttpTester {
  socketPath: string; // path to Unix domain socket

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  /**
   * Sends a request specified with the given options where the socketPath
   * field is set to the member variable's value.
   *
   * Returns the incoming message adjoined with `body` denoting the
   * concatenated http body.
   */
  send(
    options: http.RequestOptions,
    data: string,
  ): Promise<http.IncomingMessage & { body: string }> {
    options.socketPath = this.socketPath;

    let done: (value: http.IncomingMessage & { body: string }) => void = (_) =>
      false;
    let bad: (err: Error) => void = (_) => false;
    const task = new Promise<http.IncomingMessage & { body: string }>(
      (resolve, reject) => {
        done = resolve;
        bad = reject;
      },
    );

    const callback = (res: http.IncomingMessage) => {
      res.setEncoding("utf8");
      const chunks: string[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", bad);

      res.on("end", () => {
        const resultingData: string = chunks.join("");
        (res as unknown as { body: string }).body = resultingData;
        done(res as http.IncomingMessage & { body: string });
      });
    };
    const req = http.request(options, callback);
    req.on("error", bad);
    req.write(data);
    req.end();

    return task;
  }
}

test.describe(`Sending POST requests to the server`, async () => {
  let services: Services | undefined;
  let httpTester: HttpTester | undefined;

  await test.before(async () => {
    services = await Services.spawn();
    httpTester = new HttpTester(services!.densQuery.socketPath);
  });

  await test.after(async () => {
    await services!.kill();
  });

  await test.it(`/api/check-health`, async () => {
    const data = JSON.stringify({});
    const options = {
      socketPath: services!.densQuery.socketPath,
      path: `/api/check-health`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const response = await httpTester!.send(options, data);

    assert.deepStrictEqual(
      JSON.parse(response.body),
      JSON.parse(data),
      `/api/check-health does not send the same data back`,
    );
    assert.deepStrictEqual(
      response.statusCode,
      200,
      `bad status code`,
    );
  });

  await test.it(`/api/set-protocol-nft: invalid JSON`, async () => {
    const data = `{ haha`;
    const options = {
      socketPath: services!.densQuery.socketPath,
      path: `/api/set-protocol-nft`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const response = await httpTester!.send(options, data);

    assert.deepStrictEqual(
      response.body,
      `SyntaxError: Unexpected token h in JSON at position 2`,
      `Invalid error message`,
    );

    assert.notDeepStrictEqual(
      response.statusCode,
      200,
      `bad status code`,
    );
  });

  await test.it(`/api/set-protocol-nft: valid JSON`, async () => {
    const assetClass: PlaV1.AssetClass = [
      P.fromJust(
        PlaV1.currencySymbolFromBytes(
          Uint8Array.from([
            69,
            69,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
          ]),
        ),
      ),
      PlaV1.adaToken,
    ];

    const data = PJson.stringify(
      LbrPrelude.Json[LbDensServer.SetProtocolNftRequest].toJson({
        protocolNft: assetClass,
      }),
    );

    const options = {
      socketPath: services!.densQuery.socketPath,
      path: `/api/set-protocol-nft`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const response = await httpTester!.send(options, data);

    assert.deepStrictEqual(
      LbrPrelude.Json[LbDensServer.SetProtocolNftResponse].fromJson(
        PJson.parseJson(response.body),
      ),
      { name: "Ok", fields: { protocolNft: assetClass } },
      `bad response body`,
    );

    assert.deepStrictEqual(
      response.statusCode,
      200,
      `bad status code`,
    );
  });

  await test.it(`/api/query-protocol-utxo: no protocol utxo available yet `, async () => {
    const data = JSON.stringify({});

    const options = {
      socketPath: services!.densQuery.socketPath,
      path: `/api/query-protocol-utxo`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const response = await httpTester!.send(options, data);

    assert.deepStrictEqual(
      LbrPrelude.Json[LbDensServer.QueryDensProtocolUtxoResponse].fromJson(
        PJson.parseJson(response.body),
      ),
      { fields: { error: "Failed to find protocol UTxO." }, name: "Failed" },
      `bad response body`,
    );

    assert.deepStrictEqual(
      response.statusCode,
      500,
      `bad status code`,
    );
  });
});
