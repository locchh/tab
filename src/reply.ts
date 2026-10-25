// The checker between the agent and the screen. Nothing reaches the editor without passing here.
//   1. Shape: is the agent's text a valid Reply?
//   2. Freshness: is it still for the file and document version the user has now?
// No vscode import, so it can be unit-tested with `bun test`.

import type { Position, Reply } from "./types";

// Turns the agent's raw text into a Reply, or null if it isn't one (a "bad reply").
export function parseReply(raw: string): Reply | null {
  let data: unknown;
  try {
    data = JSON.parse(stripFences(raw.trim()));
  } catch {
    return null; // not JSON at all
  }
  if (!isObject(data)) return null;

  const { docVersion, file, start, end, text } = data;
  if (typeof docVersion !== "number" || typeof file !== "string" || typeof text !== "string") {
    return null;
  }
  if (!isPosition(start) || !isPosition(end)) return null;
  return { docVersion, file, start, end, text };
}

// True if the reply still fits what the user has open right now.
// `current` is null when there's no usable editor.
export function isFresh(
  reply: Reply,
  current: { file: string; docVersion: number } | null,
): boolean {
  return current !== null && reply.file === current.file && reply.docVersion === current.docVersion;
}

// The instructions say "no markdown fences", but models sometimes add them anyway:
// ```json { … } ```  →  { … }
function stripFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match?.[1] ?? text;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A valid position: whole numbers, and 1 or more (the State is 1-based).
function isPosition(value: unknown): value is Position {
  if (!isObject(value)) return false;
  const { line, col } = value;
  return Number.isInteger(line) && Number.isInteger(col) && Number(line) >= 1 && Number(col) >= 1;
}
