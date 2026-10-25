// Unit tests for src/agents/process.ts. Run with `bun run test`.
import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { readLines } from "../src/agents/process";

describe("readLines", () => {
  test("joins lines split across chunks", () => {
    // PassThrough is a fake stream: whatever we write comes out the other side.
    const stream = new PassThrough();
    const lines: string[] = [];
    readLines(stream, (line) => lines.push(line));

    // One message arrives in two pieces, then a second message in one piece.
    stream.write('{"a":');
    stream.write('1}\n{"b":2}\n');

    // Each full line is reported once, in order. Bun runs stream events right away
    // on write, so we can check immediately.
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("skips empty lines", () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    readLines(stream, (line) => lines.push(line));
    stream.write("\n\nhello\n\n");
    expect(lines).toEqual(["hello"]);
  });
});
