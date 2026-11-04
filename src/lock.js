import { open, readFile, rm, stat } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { log } from "./log.js";

/**
 * Whether another process is running. This process doesn't count: a lock file with its PID that
 * it doesn't hold is left over from an earlier process (in a container, the scheduler is PID 1
 * after every restart).
 */
export function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

// Locks this process holds, so its own PID in a lock file is only stale when it isn't one.
const held = new Set();

/** The PID holding the lock, or null when the lock is stale. */
async function holder(path) {
  if (held.has(path)) return process.pid;
  const content = await readFile(path, "utf8").catch(() => null);
  if (content === null) return null;
  // Checked again: this process may have taken the lock while the file was being read.
  if (held.has(path)) return process.pid;
  const pid = Number(content);
  if (content !== "") return isRunning(pid) ? pid : null;
  // Just created, its PID not written yet, unless it has been empty for a while.
  const { mtimeMs } = await stat(path).catch(() => ({ mtimeMs: 0 }));
  return Date.now() - mtimeMs < 10_000 ? "?" : null;
}

/**
 * Runs fn holding an exclusive lock file, so separate processes (the scheduler and a `docker exec`
 * CLI run) never use the budget at the same time. Waits for another process's lock, up to
 * timeoutMs, and takes over a lock whose process is gone.
 */
export async function withLock(path, fn, { timeoutMs = 15 * 60_000, pollMs = 1000 } = {}) {
  const started = Date.now();
  let waiting = false;
  for (;;) {
    try {
      const handle = await open(path, "wx");
      held.add(path);
      try {
        await handle.writeFile(String(process.pid));
      } finally {
        await handle.close();
      }
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    const pid = await holder(path);
    if (pid === null) {
      await rm(path, { force: true });
      continue;
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error(
        `Another actual-tasks run (PID ${pid}) is still using the budget after ` +
          `${Math.round(timeoutMs / 60_000)} minutes; remove ${path} if it isn't running`,
      );
    }
    if (!waiting) log.info(`Waiting for another actual-tasks run (PID ${pid}) to finish`);
    waiting = true;
    await sleep(pollMs);
  }
  try {
    return await fn();
  } finally {
    held.delete(path);
    await rm(path, { force: true });
  }
}
