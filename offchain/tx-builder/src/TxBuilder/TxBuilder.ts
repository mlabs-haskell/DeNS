import { Emulator, Lucid } from "lucid-cardano";

const myAddress =
  "addr_test1vrnkfmgn6qt92lwvlwvq8mzmhe4u37pnetkfumjl9e0gj8sfm98q6";
const theirAddress =
  "addr_test1vr88m63yq8d74d6aswmggz6fe059n6yfpr8mhtmnjr5dk2shdzdg0";

const emulator = new Emulator(
  [
    { address: myAddress, assets: { lovelace: 3000000000n } },
    { address: theirAddress, assets: { lovelace: 9000000000n } },
  ],
);

const lucid = await Lucid.new(emulator);

// Generate / set private key
// const privateKey = lucid.utils.generatePrivateKey(); // Bech32 encoded private key
const privateKey =
  "ed25519_sk1y3juuj2zkwh9j7n38wr8uuke266f02p48ndfvzptkue5p24sce2q9029cl";
lucid.selectWalletFromPrivateKey(privateKey);
console.log("Private key: " + privateKey);

// Get the bech32 address
const address = await lucid.wallet.address(); // Bech32 address
console.log("Address: " + address);

emulator.log();

const tx = await lucid.newTx()
  .payToAddress(theirAddress, { lovelace: 1000000n })
  .complete();

const signedTx = await tx.sign().complete();

const txHash = await signedTx.submit();

console.log("Tx hash: " + txHash);

await lucid.awaitTx(txHash);

emulator.log();
