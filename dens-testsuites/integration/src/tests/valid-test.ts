import test from "node:test";
import { Services } from "../lib/services.js";
import * as L from "lucid-cardano";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs"
import * as Tx from "../../.extra-dependencies/dens-transactions/dist/DensTransactions/index.js";

test.describe("Runtime services can be initialized", async () => {
  let services: Services | undefined;
  await test.before(async () => {
    services = await Services.spawn();
  });

  test.it('offchain', async () => {
    console.log('ogmios url: ' + services.ogmios.host);
    console.log('ogmios port: ' + services.ogmios.port)

    const socketPath = services.densQuery.socketPath;

    const fakeProvider = new Tx.OgmiosOnly(services.ogmios.host,parseInt(services.ogmios.port),'Mainnet');

    const lucidNoWallet = await L.Lucid.new(fakeProvider);

    console.log('priv key bytes: \n ' + JSON.stringify(services.cardano.walletKeyPairs[0].signingKey));

    const userPrivKey = CSL.PrivateKey.from_normal_bytes(services.cardano.walletKeyPairs[0].signingKey);

    console.log('user priv key: ' + JSON.stringify(userPrivKey))

    const lucid = lucidNoWallet.selectWalletFromPrivateKey(userPrivKey.to_bech32());

    const oneShotRef = await Tx.mkProtocolOneShot(lucid);

    const params = await Tx.mkParams(lucid,oneShotRef,socketPath);

    console.log('scripts: \n' + JSON.stringify(params,null,4));

    const initializeDeNSTx = await Tx.initializeDeNS(lucid,params,socketPath,oneShotRef);

    const initTxHash = await Tx.signAndSubmitTx(lucid,initializeDeNSTx);

    console.log('initialize dens tx hash:\n  ' +  initTxHash);
  });


  await test.after(async () => {
    await services!.kill();
  });
});
