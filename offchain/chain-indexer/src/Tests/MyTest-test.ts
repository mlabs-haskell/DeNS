import { describe } from "node:test";
import * as assert from "node:assert/strict";

describe("Sample test", () => {
  const actual = true;
  const expected = true;
  const message = "A message.";
  assert.deepStrictEqual(actual, expected, message);
});
