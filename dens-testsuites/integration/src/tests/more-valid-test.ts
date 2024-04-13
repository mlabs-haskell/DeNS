import test from "node:test";
import { Services } from "../lib/services.js";

test.describe("Yet another runtime services can be initialized", async () => {
  let result: Services | undefined;
  await test.before(async () => {
    result = await Services.spawn();
  });
  await test.after(async () => {
    await result!.kill();
  });
});
