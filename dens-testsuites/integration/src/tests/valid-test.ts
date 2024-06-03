import test from "node:test";
import { Services } from "../lib/services.js";
import * as L from "lucid-cardano";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import * as Tx from "dens-transactions/index.js";
import { UnixDomainOrInternetDomain } from "lbf-dens-db/LambdaBuffers/Dens/Config.mjs";

test.describe("Happy path test for transactions", async () => {
  let services: Services | undefined;
  await test.before(async () => {
    services = await Services.spawn();
  });

  test.it("Offchain tx submission", async (t) => {
    t.diagnostic("Ogmios url: " + services!.ogmios.host);
    t.diagnostic("Ogmios port: " + services!.ogmios.port);

    const socketPath: UnixDomainOrInternetDomain = {
      name: "UnixDomain",
      fields: {
        path: services!.densQuery.socketPath,
      },
    };

    const fakeProvider = new Tx.OgmiosOnly(
      services!.ogmios.host,
      parseInt(services!.ogmios.port),
      "Mainnet",
    );

    const lucidNoWallet = await L.Lucid.new(fakeProvider);

    t.diagnostic(
      `Private key bytes: ${
        Buffer.from(services!.cardano.walletKeyPairs[0]!.signingKey).toString(
          "hex",
        )
      }`,
    );

    const userPrivKey = CSL.PrivateKey.from_normal_bytes(
      services!.cardano.walletKeyPairs[0]!.signingKey,
    );

    t.diagnostic(`User private key: ${userPrivKey.to_hex()}`);

    const lucid = lucidNoWallet.selectWalletFromPrivateKey(
      userPrivKey.to_bech32(),
    );

    const oneShotRef = await Tx.getProtocolOneShot(lucid);

    const params = await Tx.mkParams(lucid, oneShotRef, socketPath);

    t.diagnostic("Scripts:");
    t.diagnostic(JSON.stringify(params, null, 4));

    const initializeDeNSTx = await Tx.initializeDeNS(
      lucid,
      params,
      oneShotRef,
      socketPath,
    );

    const initTxHash = await Tx.signAndSubmitTx(initializeDeNSTx);

    t.diagnostic("Initialize dens tx hash:");
    t.diagnostic(initTxHash);

    await lucid.awaitTx(initTxHash);

    const registerDomainTx = await Tx.registerDomain(
      lucid,
      params,
      "www.google.com",
      socketPath,
    );

    const registerDomainTxHash = await Tx.signAndSubmitTx(
      registerDomainTx,
    );

    t.diagnostic("Register domain tx hash: " + registerDomainTxHash);

    // idk if we need to wait for the server to pick up on changes but it likely can't hurt
    await lucid.awaitTx(registerDomainTxHash);
    const userAddress = await lucid.wallet.address();

    const updateRecordTx = await Tx.updateRecord(
      lucid,
      params,
      userAddress,
      "www.google.com",
      Tx.mkRecordDatum(
        "www.google.com",
        [Tx.mkARecord("101.101.101.101", 1000)],
      ),
      socketPath,
    );

    const updateRecordTxHash = await Tx.signAndSubmitTx(updateRecordTx);

    await lucid.awaitTx(updateRecordTxHash);

    t.diagnostic("UpdateRecordTxHash: " + updateRecordTxHash);
  });

  await test.after(async () => {
    await services!.kill();
  });
});
