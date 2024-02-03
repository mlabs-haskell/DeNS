import { describe } from "node:test";
import * as assert from "node:assert/strict";

// See the following for details on the test runner:
// https://nodejs.org/api/test.html

describe("Sample test", () => {
  const actual = true;
  const expected = true;
  const message = "A message.";
  assert.deepStrictEqual(actual, expected, message);
});
