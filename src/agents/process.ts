// Shared helpers for running an agent CLI as a child process.
// Every adapter needs the same plumbing: start the process, read its output line by line,
// write JSON to it, and stop it cleanly. Only the message formats differ per agent.
// No vscode import, so these can be unit-tested with `bun test`.

import { type ChildProcess, spawn } from "node:child_process";
import type { Readable } from "node:stream";

// How long to wait for the agent to exit on its own before forcing it.
const STOP_GRACE_MS = 3000;

// Starts the CLI in its own process group (detached), so we can stop it and
// anything it started in one go. stdin/stdout/stderr are pipes we read and write.
export function spawnAgent(cmd: string, args: string[], cwd: string): ChildProcess {
  return spawn(cmd, args, { cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
}

// Calls onLine for every full line the stream produces.
// Output arrives in random-sized chunks, so a line can be split across two chunks:
// we keep the unfinished end in `buffer` until the rest arrives.
export function readLines(stream: Readable, onLine: (line: string) => void): void {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // the last piece has no "\n" yet: keep it for later
    for (const line of lines) {
      if (line.trim()) onLine(line);
    }
  });
}

// Sends one JSON message: the object as one line, ending with "\n".
export function writeLine(child: ChildProcess, message: unknown): void {
  child.stdin?.write(`${JSON.stringify(message)}\n`);
}

// Stops the agent: close stdin (it exits on its own), then force it if it's still running.
export function stopProcess(child: ChildProcess): void {
  child.stdin?.end();
  const pid = child.pid;
  if (pid === undefined) return;

  const force = setTimeout(() => {
    // A negative pid means "the whole process group", so helpers it started die too.
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Already gone: nothing to do.
    }
  }, STOP_GRACE_MS);
  child.once("exit", () => clearTimeout(force));
}
