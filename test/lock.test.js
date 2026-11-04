import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, mock } from "node:test";
import { withBudget } from "../src/actual.js";
import { withLock } from "../src/lock.js";
import { log } from "../src/log.js";
import { fakeApi } from "./fake-api.js";

const tempDir = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "actual-tasks-lock-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

describe("withLock", () => {
  it("waits for a running process's lock, up to the timeout", async (t) => {
    const info = mock.method(log, "info", () => {});
    t.after(() => info.mock.restore());
    const lock = join(await tempDir(t), "lock");
    await writeFile(lock, String(process.ppid));
    await assert.rejects(
      withLock(lock, async () => "ran", { timeoutMs: 50, pollMs: 10 }),
      new RegExp(`Another actual-tasks run \\(PID ${process.ppid}\\) is still using the budget`),
    );
    assert.match(info.mock.calls[0].arguments[0], /Waiting for another actual-tasks run/);
  });

  it("takes over a lock left by a process that is gone, or by an earlier one with this PID", async (t) => {
    const lock = join(await tempDir(t), "lock");
    for (const pid of [2 ** 22 + 1, process.pid]) {
      await writeFile(lock, String(pid));
      assert.equal(await withLock(lock, async () => "ran"), "ran");
      assert.equal(existsSync(lock), false);
    }
  });

  it("runs one holder at a time", async (t) => {
    const lock = join(await tempDir(t), "lock");
    let running = 0;
    let max = 0;
    const hold = () =>
      withLock(
        lock,
        async () => {
          max = Math.max(max, ++running);
          await new Promise((resolve) => setTimeout(resolve, 20));
          running--;
        },
        { pollMs: 5 },
      );
    await Promise.all([hold(), hold()]);
    assert.equal(max, 1);
  });
});

describe("withBudget run directories", () => {
  it("uses a new directory per run, removes the databases after it and old runs before", async (t) => {
    const dataDir = await tempDir(t);
    await mkdir(join(dataDir, "sync-id"));
    await mkdir(join(dataDir, `run-${2 ** 22 + 1}-old`));
    const api = fakeApi();
    let budgetDir;
    api.init = async ({ dataDir: dir }) => {
      budgetDir = dir;
      await mkdir(join(dir, "budget"));
      await writeFile(join(dir, "budget", "db.sqlite"), "decrypted");
      await writeFile(join(dir, "budget", "cache.sqlite"), "cells");
      await writeFile(join(dir, "budget", "metadata.json"), "{}");
    };

    await withBudget({ dataDir, syncId: "sync-id" }, async () => {}, api);

    assert.match(budgetDir, new RegExp(`run-${process.pid}-`));
    assert.deepEqual(await readdir(join(budgetDir, "budget")), ["metadata.json"]);
    assert.deepEqual(await readdir(dataDir), [budgetDir.slice(dataDir.length + 1)]);
  });
});
