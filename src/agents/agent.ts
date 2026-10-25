// The contract every agent adapter follows (claude.ts, codex.ts, …).
// session.ts only talks to this interface, so it never knows which CLI is behind it.
// Adding a new agent = one new file that implements Agent. Nothing else changes.

// What went wrong, in words the rest of Tab understands (see Errors in docs/SKETCH.md).
export type AgentErrorKind =
  | "not-installed" // CLI missing or not logged in
  | "auth" // login expired mid-session
  | "rate-limit"
  | "quota"
  | "network"
  | "crashed" // the process exited unexpectedly
  | "other";

export interface AgentError {
  kind: AgentErrorKind;
  message: string; // raw text from the agent, for the log
  retryAfterMs?: number; // rate limits sometimes say how long to wait
}

// Guesses the error kind from an agent's error text, for agents that only give us words.
export function errorKindFromText(text: string): AgentErrorKind {
  if (/log ?in|auth|api key|unauthorized|401/i.test(text)) return "auth";
  if (/usage limit|quota|credit|billing/i.test(text)) return "quota";
  if (/rate.?limit|429|overloaded/i.test(text)) return "rate-limit";
  if (/network|ECONN|ENOTFOUND|fetch failed|connection/i.test(text)) return "network";
  return "other";
}

export interface Agent {
  // Launch the CLI read-only with the bundled instructions. Resolves when it's ready.
  // Rejects with an AgentError if it can't start (e.g. kind "not-installed").
  start(instructions: string): Promise<void>;
  // Send "go, make a suggestion now". The answer arrives through onReply.
  trigger(): void;
  // Stop the current turn. Resolves when the agent confirms it stopped.
  interrupt(): Promise<void>;
  // Close the agent cleanly (close stdin; kill it if it doesn't exit).
  stop(): void;
  // Called with the reply text when a turn finishes.
  onReply(cb: (text: string) => void): void;
  // Called when something goes wrong.
  onError(cb: (err: AgentError) => void): void;
}
