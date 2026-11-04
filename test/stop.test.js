// In its own file: stop() can't be undone, and node --test runs each file in its own process.
import assert from "node:assert/strict";
import { it } from "node:test";
import { runTasks, stop } from "../src/engine.js";

it("stop lets the running task finish and skips the rest of the batch", async () => {
  const ran = [];
  let started;
  const running = new Promise((resolve) => (started = resolve));
  const registry = {
    first: {
      run: async () => {
        started();
        await new Promise((resolve) => setTimeout(resolve, 10));
        ran.push("first");
      },
    },
    second: { run: async () => ran.push("second") },
  };
  const batch = runTasks({}, ["first", "second"], registry);
  const queued = runTasks({}, ["second"], registry);
  await running;
  await stop();
  await Promise.all([batch, queued]);
  assert.deepEqual(ran, ["first"]);
});
