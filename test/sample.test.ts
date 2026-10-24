// bun:test is Bun's built-in test runner. No extra library needed.
import { expect, test } from "bun:test";

// A sample test, just to prove the runner works. Real tests replace it in Phase 3.
test("runner works", () => {
  expect(1 + 1).toBe(2);
});
