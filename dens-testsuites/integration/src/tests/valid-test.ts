import test from "node:test";
import { Services } from "../lib/services.js";
import * as L from "lucid-cardano";
import * as Tx from "../../.extra-dependencies/dens-transactions/dist/DensTransactions/index.js";

test.describe("Runtime services can be initialized", async () => {
  let services: Services | undefined;
  await test.before(async () => {
    services = await Services.spawn();
  });

  const ogmiosUrl = 'ws://' + services.ogmios.host + ':' + services.ogmios.port;

  const fakeProvider = new Tx.OgmiosOnly(ogmiosUrl);

  const lucidNoWallet = await L.Lucid.new(fakeProvider);

  const userPrivKey = Buffer.from(services.cardano.walletKeyPairs[0].signingKey).toString('hex');

  console.log('user priv key: ' + JSON.stringify(userPrivKey))

  const lucid = lucidNoWallet.selectWalletFromPrivateKey(userPrivKey);

  const oneShotRef = await Tx.mkProtocolOneShot(lucid);

  console.log(JSON.stringify(oneShotRef));

  await test.after(async () => {
    await services!.kill();
  });
});
