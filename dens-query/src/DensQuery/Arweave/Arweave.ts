import {
  Connection,
  IrysNetwork,
  makeEthPaymentInfo,
  isLeft,
  transactionsByIds,
} from "./Connection.js";

type ETHStringKey = { address: string; key: string };

const ethStringKey: ETHStringKey = {
  address: "0x57c79dd5cba98c636928a70f3222966e31fa785d",
  key: "0x2b37da67cfe37ead51c9dce4a5680bf28137c0e6b6fe97ae9eb41f972598ef09",
};

async function makeIrys() {
  const paymentInfo = makeEthPaymentInfo(
    ethStringKey.key,
    "https://rpc.sepolia.org",
  );
  if (isLeft(paymentInfo)) {
    throw paymentInfo.left;
  }
  const connection = new Connection(IrysNetwork.DevNet, paymentInfo.right);
  const irys = connection.connection;
  const balance = await irys.getLoadedBalance();
  console.log(balance);
  console.log(connection.connection.url)

  const results = await transactionsByIds(connection, ["-Z5NQYXNFpr9DEbBkkyjle2JtbOBnOfN7PgL0kQlLqc"])
  console.log(results)
  //let tx = irys.createTransaction("Hello world!");
  //await tx.sign();
  //console.log(tx);
  //console.log(tx.id);
  //let receipt = await irys.uploader.uploadTransaction(tx);
  //console.log(receipt);

  //const myQuery = new Query({ url: "https://devnet.irys.xyz/graphql" });
  //const results = await myQuery
  //  .search("irys:transactions")
  //  .ids(["-Z5NQYXNFpr9DEbBkkyjle2JtbOBnOfN7PgL0kQlLqc"]);
  //console.log(results);
}

export function main() {
  makeIrys();
}
