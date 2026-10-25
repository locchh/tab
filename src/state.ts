// Pure State logic: no vscode import, so it can be unit-tested with `bun test`.
// tracker.ts listens to VS Code and calls these functions.
// Every function returns a NEW array instead of changing the old one. That makes them
// easy to test: same input, same output, nothing hidden.

import type { Position, Visit, VisitAction } from "./types";

export const MAX_VISITS = 20;
export const MAX_DIAGNOSTICS = 50;

// VS Code counts lines and columns from 0; the State counts from 1.
export function toOneBased(line: number, character: number): Position {
  return { line: line + 1, col: character + 1 };
}

// Ends the current visit: turns its `since` into time spent (`dwellMs`).
// The current visit is always the first one, the only one with `since`.
function endCurrentVisit(visits: Visit[], now: number): Visit[] {
  const [current, ...rest] = visits;
  if (!current?.since) return visits;

  const spent = now - Date.parse(current.since);
  const ended: Visit = {
    file: current.file,
    dwellMs: (current.dwellMs ?? 0) + spent,
    actions: current.actions,
  };
  return [ended, ...rest];
}

// The user switched to `file`. Ends the current visit and starts a new one at the top.
// Revisiting a file moves it to the top, keeping its earlier actions and time spent.
// Keeps at most MAX_VISITS, dropping the oldest.
export function startVisit(visits: Visit[], file: string, now: number): Visit[] {
  const ended = endCurrentVisit(visits, now);
  const earlier = ended.find((v) => v.file === file);
  const others = ended.filter((v) => v.file !== file);

  const visit: Visit = {
    file,
    since: new Date(now).toISOString(),
    dwellMs: earlier?.dwellMs,
    actions: earlier?.actions ?? [],
  };
  return [visit, ...others].slice(0, MAX_VISITS);
}

// The user did something (edit, select, …) in the current file.
// Each action is recorded once per file.
export function addAction(visits: Visit[], action: VisitAction): Visit[] {
  const [current, ...rest] = visits;
  if (!current || current.actions.includes(action)) return visits;
  return [{ ...current, actions: [...current.actions, action] }, ...rest];
}

// Drops visits to files that no longer exist.
export function removeVisits(visits: Visit[], deleted: string[]): Visit[] {
  return visits.filter((v) => !deleted.includes(v.file));
}

// Adds a file to the `changed` list, once. The list is cleared (set to []) when a turn completes.
export function addChanged(changed: string[], file: string): string[] {
  return changed.includes(file) ? changed : [...changed, file];
}
