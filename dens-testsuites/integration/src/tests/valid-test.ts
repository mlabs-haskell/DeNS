import test from "node:test";
import { Services } from "../lib/services.js";

test.describe("Runtime services can be initialized", async () => {
  let services: Services | undefined;
  await test.before(async () => {
    services = await Services.spawn();
  });

  await test.after(async () => {
    await services!.kill();
  });
});
