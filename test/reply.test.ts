// Unit tests for src/reply.ts. Run with `bun run test`.
import { describe, expect, test } from "bun:test";
import { isFresh, parseReply } from "../src/reply";

// A valid reply, as the agent should send it.
const GOOD = {
  docVersion: 57,
  file: "docs/guide.md",
  start: { line: 42, col: 13 },
  end: { line: 42, col: 13 },
  text: "open the app and press Sign in.",
};

describe("parseReply", () => {
  test("accepts a valid reply", () => {
    expect(parseReply(JSON.stringify(GOOD))).toEqual(GOOD);
  });

  test("accepts a reply wrapped in markdown fences", () => {
    // Models sometimes add ```json … ``` even when told not to.
    expect(parseReply(`\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\``)).toEqual(GOOD);
  });

  test("accepts an empty suggestion", () => {
    // "" is valid: it means "nothing good to suggest".
    expect(parseReply(JSON.stringify({ ...GOOD, text: "" }))?.text).toBe("");
  });

  test("rejects text that isn't JSON", () => {
    expect(parseReply("Sure! Here is my suggestion: ...")).toBeNull();
  });

  test("rejects a missing field", () => {
    const { file: _, ...noFile } = GOOD;
    expect(parseReply(JSON.stringify(noFile))).toBeNull();
  });

  test("rejects a bad position", () => {
    // Positions are 1-based whole numbers; 0 and 1.5 are not valid.
    expect(parseReply(JSON.stringify({ ...GOOD, start: { line: 0, col: 1 } }))).toBeNull();
    expect(parseReply(JSON.stringify({ ...GOOD, end: { line: 1.5, col: 1 } }))).toBeNull();
  });
});

describe("isFresh", () => {
  test("fresh when file and version match", () => {
    expect(isFresh(GOOD, { file: "docs/guide.md", docVersion: 57 })).toBe(true);
  });

  test("stale when the user kept editing", () => {
    expect(isFresh(GOOD, { file: "docs/guide.md", docVersion: 58 })).toBe(false);
  });

  test("stale when the user switched files", () => {
    expect(isFresh(GOOD, { file: "src/other.ts", docVersion: 57 })).toBe(false);
  });

  test("stale when no editor is open", () => {
    expect(isFresh(GOOD, null)).toBe(false);
  });
});
