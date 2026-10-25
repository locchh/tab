// Unit tests for src/state.ts. Run with `bun run test`.
// describe() groups tests for one function; test() is one check; expect() states what must be true.
import { describe, expect, test } from "bun:test";
import {
  addAction,
  addChanged,
  MAX_VISITS,
  removeVisits,
  startVisit,
  toOneBased,
} from "../src/state";

// A fixed starting time, so the tests don't depend on the real clock.
// Times below are written as T0 + milliseconds, e.g. T0 + 2800 = 2.8 seconds later.
const T0 = Date.parse("2026-10-24T14:00:00.000Z");

// Note: `visits[0]?.file` uses ?. because TypeScript can't know the array isn't empty.
// If it were empty, ?. gives undefined instead of crashing, and the test fails cleanly.

describe("toOneBased", () => {
  test("adds 1 to line and column", () => {
    // VS Code's first line/column is 0; ours is 1.
    expect(toOneBased(0, 0)).toEqual({ line: 1, col: 1 });
    expect(toOneBased(41, 9)).toEqual({ line: 42, col: 10 });
  });
});

describe("startVisit", () => {
  test("first visit goes on top with a start time", () => {
    // Start from an empty list and open a.ts at T0.
    const visits = startVisit([], "a.ts", T0);
    // It's the current visit, so it has `since` (start time) and no time spent yet.
    expect(visits).toEqual([
      { file: "a.ts", since: "2026-10-24T14:00:00.000Z", dwellMs: undefined, actions: [] },
    ]);
  });

  test("switching files ends the old visit with time spent", () => {
    // Open a.ts at T0, then switch to b.ts 2.8 seconds later.
    let visits = startVisit([], "a.ts", T0);
    visits = startVisit(visits, "b.ts", T0 + 2800);
    // b.ts is now current (on top).
    expect(visits[0]?.file).toBe("b.ts");
    // a.ts is finished: no `since`, and it was open for 2800 ms.
    expect(visits[1]).toEqual({ file: "a.ts", dwellMs: 2800, actions: [] });
  });

  test("revisiting moves the file to the top and keeps its history", () => {
    // a.ts from T0 to T0+1000 (with an edit), then b.ts, then back to a.ts.
    let visits = startVisit([], "a.ts", T0);
    visits = addAction(visits, "edit");
    visits = startVisit(visits, "b.ts", T0 + 1000);
    visits = startVisit(visits, "a.ts", T0 + 3000);
    // a.ts is back on top, and appears only once (merged, not duplicated).
    expect(visits.map((v) => v.file)).toEqual(["a.ts", "b.ts"]);
    // It keeps the 1000 ms from its first visit...
    expect(visits[0]?.dwellMs).toBe(1000);
    // ...and the edit it had before.
    expect(visits[0]?.actions).toEqual(["edit"]);
  });

  test("keeps at most MAX_VISITS", () => {
    // Visit 26 different files (file0 to file25), each 1 ms apart.
    let visits = startVisit([], "file0.ts", T0);
    for (let i = 1; i <= MAX_VISITS + 5; i++) {
      visits = startVisit(visits, `file${i}.ts`, T0 + i);
    }
    // Only the newest 20 are kept; the oldest were dropped.
    expect(visits.length).toBe(MAX_VISITS);
    // The last file visited is on top.
    expect(visits[0]?.file).toBe(`file${MAX_VISITS + 5}.ts`);
  });
});

describe("addAction", () => {
  test("records each action once on the current visit", () => {
    // Edit twice and scroll once in a.ts.
    let visits = startVisit([], "a.ts", T0);
    visits = addAction(visits, "edit");
    visits = addAction(visits, "edit");
    visits = addAction(visits, "scroll");
    // "edit" is listed only once: we care that it happened, not how often.
    expect(visits[0]?.actions).toEqual(["edit", "scroll"]);
  });

  test("does nothing with no visits", () => {
    // No file open yet, so there's nowhere to record the action. Must not crash.
    expect(addAction([], "edit")).toEqual([]);
  });
});

describe("removeVisits", () => {
  test("drops deleted files", () => {
    // Visit a.ts and b.ts, then a.ts gets deleted.
    let visits = startVisit([], "a.ts", T0);
    visits = startVisit(visits, "b.ts", T0 + 1);
    // Only b.ts remains.
    expect(removeVisits(visits, ["a.ts"]).map((v) => v.file)).toEqual(["b.ts"]);
  });
});

describe("addChanged", () => {
  test("adds a file once", () => {
    // Add a.ts twice; it should appear only once in the list.
    expect(addChanged(addChanged([], "a.ts"), "a.ts")).toEqual(["a.ts"]);
  });
});
