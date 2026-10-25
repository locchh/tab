// Shapes of the data Tab writes to .tab/state.json.
// Matches the State section in docs/SKETCH.md. Types only: no logic, no vscode import,
// so any file (including unit tests) can use them.

// How far the agent looks and how much it writes. "auto" = the agent decides both.
export type Effort = "low" | "medium" | "high" | "auto";

// A spot in a file. Both numbers are 1-based (VS Code uses 0-based; state.ts converts).
export interface Position {
  line: number;
  col: number;
}

// Where the user is right now.
export interface ActiveFile {
  file: string; // path relative to the workspace root
  language: string; // VS Code language id, e.g. "typescript", "markdown"
  docVersion: number; // goes up on every edit, saved or not
  cursor: Position;
  selection: { start: Position; end: Position } | null; // null when nothing is selected
  dirty: boolean; // true when the file has unsaved changes
  text?: string; // file content, only when dirty; otherwise the agent reads disk
  lineCount: number;
}

// The most recent edit in the active file.
export interface LastChange {
  file: string;
  docVersion: number;
  start: Position; // replaced range, before the edit
  end: Position;
  text: string; // inserted text ("" for a pure delete)
}

// What the user did while in a file.
export type VisitAction = "edit" | "select" | "cursor" | "scroll";

// One file the user spent time in.
export interface Visit {
  file: string;
  since?: string; // current visit only: when it started (ISO time)
  dwellMs?: number; // finished visits only: how long the user stayed
  actions: VisitAction[];
}

// One error from VS Code's Problems panel. Warnings are left out.
export interface Diagnostic {
  file: string;
  line: number; // 1-based
  severity: "error";
  message: string;
}

// Everything the agent reads from .tab/state.json.
export interface State {
  syncedAt: string; // ISO time of this write
  effort: Effort;
  active: ActiveFile | null; // null when there's no usable editor (no suggestions then)
  lastChange: LastChange | null; // null until the first edit
  changed: string[]; // files changed since the last completed turn
  visits: Visit[]; // most recent first, at most 20
  diagnostics: Diagnostic[]; // at most 50
}

// What the agent sends back (see Reply in docs/SKETCH.md). Checked by reply.ts.
export interface Reply {
  docVersion: number; // the active.docVersion the agent read
  file: string; // the file the suggestion is for
  start: Position; // range to replace, 1-based; same as end for a plain insert
  end: Position;
  text: string; // the suggestion; "" means no suggestion
}
