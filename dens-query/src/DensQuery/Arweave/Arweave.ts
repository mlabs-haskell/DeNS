import Arweave from "@irys/arweave";
import { JWKPublicInterface } from "@irys/arweave/common/lib/wallet";
import { bundleAndSignData, createData } from "arbundles";
import { ArweaveSigner } from "arbundles/web";
import Wallet from "ethereumjs-wallet";
import Irys from "@irys/sdk";
import Query from "@irys/query";

export function makeArweave(): Arweave {
  return new Arweave({ url: "http://127.0.0.1:1984" });
}

const key1 = {
  kty: "RSA",
  n: "0Ja1rSNcrFyB4di0Y9CdtMFGvkh_fN_X0h_BegLa-RFfDEqRP9KfDAr3zGWTV9frnpXBTVLjgJv4vAbRS7ZQQrjHu_U-zBXmdA84TQPZ7vFzYq-HoQDIw7DdiAd8ygA8qSZVOIJOXzMJl8pe8mrImplO2pN4YjKfd_p9c47CF2ntjDZqwX6ksXqL9VqV1bUG9HxuorGS-E8ADtkDCVYfZYE2eB22c_bfDtLvE6vgFCZC1nPYr5q8SE6VHHNfyZV7DBsFEEOF6wr291gQwuEP8brRG2ZSIpqXBM0gQDuNkaR9ClXzc7fq6X2R43ScNEL9k5NFz0Gm4917NeAAHMhpedK3TQVGHMgG-BZBcnoiexnZMjwtqn6DopHcyv1_8jk8Ar3Q4on3jXdQonWVyd7kKaDZFcsDVYV3Sjw-JmlLfaCfzLZPjlECVLVQEKz643oBLWOVLK9VxFf4vG1IsWVZu4DTVnG7S7vITRCp-nRr3b31sm2obYYfzIbE_-xos-GGFoXqL1G9Gf_tV1NJqhYH9PcOpX6gMK33aa1UhxEjU9VV-39H6cxqgQu9VT9C08V3zEnRsqBeVSchh8bc-IMaRb6jBMeTUkWzJHAN4EgUw6baz0zeSdPIkBTk7TFzwnlRTd3oLVND5LEIERcN__Efp2Q7tvD0FVmlYFNaXF6MO_s",
  e: "AQAB",
  d: "UPdfOAC09VbHN8JlayVMQiCP9Eax7ef5n1-iO1kmZG3AxkWfkfWQtR0AyP9YrU1r8VfR-9DD7GUerOW8kjYHe468QRJWOOP7W2uZABQRoTVqA5F9BRsH0yYxJ584ajSjV0lA5Tl3cG6gN6JfLpwSmCgQOrnpjbx2uBysW5G7d1kv0zBASjF9fkLCVw-9f4HQXFB8pXxmPypzLFBCZHpgn4cDfKaT7vmR5fAsyyb5SPj9Er9PCgL3ON3_9VY3hUkXxUAru_9p2S2dZa9yeiLgjIVmq8sQ8Muu-TciYKx9LF58BuoMIQvwDIgoe_EEvSiPw5v0ChpCzMppDCWSBZopjmLw6BfzA4-i0jqVh3EKjQz6b9558ky5d6INlOy8orXeN-UleDaezRv_lSDR34lhGeLHGsM230jIFW1jobLUHMEXgIdqnAGlqhVfy14m4I3WUFwjFA0jbZcxFBTwRvhSzDqTMq1wiVEaVzIwGF2QK3VmEhT_yp0PUZoY5XoGTnHZenkmKcVYfuSsvG1iVcGpMrGjhdckAXBGZG5wiw0kf3-eLxxzRPOHbEzaV1Ai0MNVRgWCzyiBmQGnEEjt9agYT6Wj1uH3BFzfR3wqox3zjEPwJiZlu1-2owo-5lTekz-PlbnQFbfUq2w4WTbkoRqLI0dgiN7_yKQkgid0yxYzOQE",
  p: "_fp--abLMwHH830TqoDXkn7QNTwSqyPj2kqvd2rjWlzYSKDRwnPD5U0EIAMOf0bPVUVd2a0JgiMCq-zTc6E80bDx-9EDA09KV7qiq-FEDkHv22e4CAt4B7MDzxJ-ONEs_MZ1265YeUtdwmWAE1KNEsRz4tnxMSIzNzZQRFB4w-lUE7JuwdOaeCK81OSRG0jvVGqEZWSRhfzMlw9MWRU8l3l637wW4EEStgo0Kxj5HYjvvPOT7k89sB7NMu7Tf4mAB0B-wBmR8Qc4br1LWrC1TAEvgFdYK6noAsFaymC9qVAvFPVrW1eAyaNc8lsKchi9uwq9BIg4HfO-48UbRSPbew",
  q: "0j-6V8pQYMcjn4EEOcTb_6J3wS_WNhjiwi9yf1_dNASX9norAN2GQlDkqZyXIg-osIB42k5PzN-Ax2ImJKcG7BgG8okOWFbvFWal6Ao_vfSS5O_BeXUKJCXtsQ6ASv9RbYtj8iXMh52_h6z1qHPIqu950wg2bH_H7gduBk8xHwrHOt-UFl1x6cBOxr4Gg20dA5QftAIA6Hs3IKA05T5l73YhnpDzwEB_bfSzLs9OQGGmXybe6UdXHNfHgl4K3nPSpe4i6GQfOopyoyvl8OBJAkdnW8d7bcCoZ3TESebZjyNaSQFqIHl8LXn2idtXzX-DUne_tktdBxJJFzKbxQD5gQ",
  dp:
    "mfer1kjpUqi3wMKIk4q8JRE_w6YBY0LEtOcl7G0eGv_CFnV39Dwd-_puj8GKnlodAwKkXHvsEbqLuhI-NhD_P9fXOuOAwhblaL26NBzCFyqd8BK2nBnn0DMUEgqR_nvAnBTsChttg0rPMjQ6KnyXDVOPNW0OLM0g403H50IplAr1b2NyhYp0UHQuqZlO5o2WmURhst3-4o1YshMSI8ceDm4UsWHjNFv-reENszrWerMzMwcvHP9o1EY3-7KRAPYoaT0OGgLmWIoaCfgzoG0T21m0pEdPKlk8T79L_PgcwnHbuQb26E7pwlOI21uZv4WEL8nYwNCbxHypsochew671Q",
  dq:
    "UwM-e_MxkUSPWCcEmBqWEnT_e5N7rJhez_UT7B7Zo_Q8W-EYoZrVq9Fst1tQgO5V2HqhPPC2qVmF6zNhhA8-uHE0LQbYVyDb_UMuNlP1nva2GRZg-aewfV1MYCAtn273o5zptW4fN1ydhuBPjldI39T18NDJTEWXlu_wDSWva2ZCC4jDW6FBnN2FPQtCXxnx3rvZWKWB3kjoF0WqHOlqLgYieA0bcMkGh0-af9zyNJFZszARy2GTj5vS9jJTcEmi3kkMF12QxvhrEun-PAESUogG00IMBeWPmGmOJu-y7sUynKimUnQlB3-kTAICxOyX2TPWyg8vh988ZKBiyIH-AQ",
  qi:
    "djreOko3EA46mqDtT_BxnY4TMU7cviIWt0xW182bs5M0VS3lrWV2k81y7TDYx41TnLary_x-WbTClXU-C_qTPq4NdY38FtlgHe15uxOeNcMXBYug48v9vuYYCuzxR1-yaP-cnaHziSQXwOmA0nhtEClxw4Y_rwiMlXuDbrl9_JtWhviabFREixpXjmFrzwGtjaMBQ-y8cfHK6J_7f8_-lRc6wIzPvNiMTRd9uNam1twaWcScn5iQiid-lP3DCXc-Qg1iM50eDrsp-2gOo-5600U4m8DiNx_otspTnVuFHScoJ39eAA3mlTmr8eCq4PoMXmLHiwyqTl1cuBVH03IGfg",
};

type ETHStringKey = { address: string; key: string };

const ethStringKey: ETHStringKey = {
  address: "0x57c79dd5cba98c636928a70f3222966e31fa785d",
  key: "0x2b37da67cfe37ead51c9dce4a5680bf28137c0e6b6fe97ae9eb41f972598ef09",
};

const address1 = "n1SMaW1SiMYrCdyqcVoNnsD_Q2PkDGXdIvu74jrDRE8";
const fund_url = `http://localhost:1984/mint/${address1}/1000000000000`;

const hellow_world_tx = "-Z5NQYXNFpr9DEbBkkyjle2JtbOBnOfN7PgL0kQlLqc";
// data: {
//     id: '-Z5NQYXNFpr9DEbBkkyjle2JtbOBnOfN7PgL0kQlLqc',
//     timestamp: 1706465884604,
//     version: '1.0.0',
//     public: 'x2dVQryQrutE8B-8aGBBu4LHoLide9c5dOEC09-4KjPnieORbvB6_pWPTqtKXPowBcy3BmRkuUiQiDXSB80cd5_TRpC6EUl_WJXUAcVwJb8BnDiOf88_P0lSZmU4_zK1F2O4FPQp_eNvyNVThFGTuF6v6L1sNEneFawHBA2PSTI8KEYuF8kmS0CWcJ-yotX7cgPeyOFWKlghY1qUb5pKmNGhipQE2bUYhgFJdOKcfRJsyqJwDGsjA3XqGbmK5BXUFRRckSha1U4UHAKHlI6UXO4wHXqf8dLoCe_XVz6T9dbj1mwG56QnzB_brzI6z5aPhQq6oMeblOi27pxk8xR--8RZoqm6fwDs_cROleLKKlBRXPQepjF7xZzzS7Z_51KJEwysbExwq9wqh5O-EuTKxJNggIHGS5JsSYx5rlwKeE5H525sxrOALGe4XiK4uO-AffI-ysmVDKKFBfJFlRLS7S0cvZE698rd_TH0pbdianH6yOjTxlM26AJFWR1UmimA3ZAWIWejcN2aoglaTU1W2wKeFGcBUFnz1Z3JA0jOjHNsNEle55XG3tpBBpLLQN7TBWcyZXPCcJbfcZKJlT5RlgwauIseMKder6c-75tlaXzNNKwOMDxcLPqlrM5huzt7MwkBUTz-ftcPnD-CWZWs0MyaFEPCPjEgLloCaIEH_bc',
//     signature: 'ZrhI8ggBXfNShRag0k3ZWCfwGgjP33TFQ_ZsdGuvM0BUaS3aDKsE03MV6kTD584Lzt7h6wKRxg5C9WdcIFdKo4akdnFCQ58rRq-DecrRlY6enyiR0TY16NL0l5vbXSAvdUQHbu9IFiUlv2vY-F75xMlOJPwISpIf6CYyHu4oGAWWs6YWnqHAcB0vS6MR6kvmmhucGi7u_KUrvjKgWdqS1jRo5G0sn_FHSiL6hvZjJkFAfimXSPJEGpeAoj--9xRZtztR5z2x3QXGOYmG5MB8NbPQmZg4zGXi4ORpTjrrEzr-gyBUsKTHQdHl-GFrFhhV6RxGCAyacP_HXtknC5bOm-IJYsVHL0ZCKwuBYTGg8efx-Tgg9CmTBTBdAYMgMD6t21mtoVBMGim0P9q7Ct_hbZJrpXNj8TBGuSgEoM0QeaNk2hes1M16sM0sSA-GpO0QAGHnf42j5_58YzZ2zW4QHfDcIEGRyOY5-pWJ7kmRMmZDzYkefqzsNYmfG3lkQ2gqOPLrJ2IAHlMF4SVzteoIOJIBTaXr0NHPIe66_4qlsfC3VS1wdOl9Z6drcbS4bfmnerUi6tr70N6a4c31K6fzFNg7LCucMU-axKLD-flguwd9CvTwIVvK3mYremKUa60UImpcze8hicTNkqjhEpN3WvU8ptFe_zq-5x9akKePUFI',
//     deadlineHeight: 1356677,
//     block: 1356677,
//     validatorSignatures: [],
//     verify: [AsyncFunction (anonymous)]
//   }

type Balance = { winston: string; ar: string };

async function get_balance(
  arweave: Arweave,
  address: string,
): Promise<Balance> {
  let balance = await arweave.wallets.getBalance(address);
  let winston = balance;
  let ar = arweave.utils.winstonToAr(balance);
  const result = { winston: winston, ar: ar };
  return result;
}

async function set_funds(arweave: Arweave, address: string): Promise<Balance> {
  await get_balance(arweave, address);
  let response = await fetch(fund_url);
  console.log(response);
  let result = await get_balance(arweave, address);
  console.log(result);
  return result;
}

async function makeTransaction(
  arweave: Arweave,
  jwk: JWKPublicInterface,
): Promise<void> {
  let data = "some random data that we want to split";
  let dataSplitted = data.split(" ");
  let signer = new ArweaveSigner(jwk);
  let dataItems = dataSplitted.map((x) => createData(x, signer));
  const bundle = await bundleAndSignData(dataItems, signer);
  console.log(bundle);
  let transaction = await bundle.toTransaction({}, arweave, jwk);
  console.log(transaction);
  await arweave.transactions.sign(transaction, jwk);
  let receipt = await arweave.transactions.post(transaction);
  console.log(receipt);
}

async function makeSimpleTransaction(
  arweave: Arweave,
  jwk: JWKPublicInterface,
): Promise<void> {
  let data = "some random data that we want to split";
  let tx = await arweave.createTransaction({ data: data }, jwk);
  console.log(tx);
  await arweave.transactions.sign(tx, jwk);
  let receipt = await arweave.transactions.post(tx);
  console.log(receipt);
}

async function compare(
  arweave: Arweave,
  address: string,
  jwk: JWKPublicInterface,
): Promise<void> {
  await set_funds(arweave, address);
  let original_balance = await get_balance(arweave, address);
  await makeTransaction(arweave, jwk);
  let balance2 = await get_balance(arweave, address);
  await makeSimpleTransaction(arweave, jwk);
  let balance3 = await get_balance(arweave, address);
  console.log(original_balance);
  console.log(balance2);
  console.log(balance3);
}
const getIrys = async () => {
  const url = "https://devnet.irys.xyz";
  const providerUrl = "https://rpc.sepolia.org";
  const token = "ethereum";

  const irys = new Irys({
    url, // URL of the node you want to connect to
    token, // Token used for payment
    key: ethStringKey.key,
    config: { providerUrl }, // Optional provider URL, only required when using Devnet
  });
  return irys;
};

async function makeIrys() {
  let irys = await getIrys();
  let balance = await irys.getLoadedBalance();
  console.log(balance);
  let tx = irys.createTransaction("Hello world!");
  await tx.sign();
  console.log(tx);
  console.log(tx.id);
  let receipt = await irys.uploader.uploadTransaction(tx);
  console.log(receipt);

  const myQuery = new Query({ url: "https://devnet.irys.xyz/graphql" });
  const results = await myQuery
    .search("irys:transactions")
    .ids(["-Z5NQYXNFpr9DEbBkkyjle2JtbOBnOfN7PgL0kQlLqc", tx.id]);
  console.log(results);
}

export function main() {
  //let privateKey = Buffer.from(ethStringKey.key.slice(2),"hex")
  //let wallet = Wallet.default.fromPrivateKey(privateKey)
  //let address = wallet.getAddressString()
  //console.log(address)

  makeIrys();

  //const arweave = makeArweave();
  //console.log(arweave.getConfig())
  //arweave.wallets.generate().then((key) => {
  //  console.log(key);
  //});
  //arweave.network.getInfo().then(value=>{console.log(value)})
  // compare(arweave,address1,key1)
  //arweave.transactions.get("yEB4twVZ5_435N9SglymWJ99nT3KITGvkMM0lfLhLcA").then(tx =>{
  //  console.log(tx);
  //  })
}
