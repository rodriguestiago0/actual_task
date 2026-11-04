import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { withBudget } from "../src/actual.js";
import { runTasks } from "../src/engine.js";
import { log } from "../src/log.js";
import { parseNotificationUrls } from "../src/notify.js";
import { callsTo, fakeApi } from "./fake-api.js";

const notifications = parseNotificationUrls("telegram://1:token@telegram?chats=42");
const actualConfig = { serverURL: "x", password: "p", syncId: "s", dataDir: "./temp_data_test" };
const failing = (code, times) => async () => {
  if (times-- > 0) throw Object.assign(new Error(`Authentication failed: ${code}`), { code });
};

function quiet(t) {
  for (const level of ["info", "warn", "error"]) {
    const m = mock.method(log, level, () => {});
    t.after(() => m.mock.restore());
  }
}

function mockFetch(t) {
  const fetch = mock.method(globalThis, "fetch", async () => new Response("{}"));
  t.after(() => fetch.mock.restore());
  return () => fetch.mock.calls.map((call) => JSON.parse(call.arguments[1].body).text);
}

describe("withBudget retries", () => {
  it("retries opening the budget after a network failure", async (t) => {
    quiet(t);
    const api = fakeApi();
    api.init = failing("network-failure", 2);
    const config = { ...actualConfig, retryDelaysMs: [0, 0] };
    assert.equal(await withBudget(config, async () => "done", api), "done");
    assert.equal(callsTo(api, "shutdown").length, 3);
  });

  it("gives up after the last retry, and doesn't retry other errors", async (t) => {
    quiet(t);
    const api = fakeApi();
    api.init = failing("network-failure", 3);
    await assert.rejects(
      withBudget({ ...actualConfig, retryDelaysMs: [0, 0] }, async () => {}, api),
      /Actual Budget error: Authentication failed: network-failure/,
    );
    api.init = failing("invalid-password", 1);
    await assert.rejects(
      withBudget({ ...actualConfig, retryDelaysMs: [0, 0] }, async () => {}, api),
      /invalid-password/,
    );
    assert.equal(callsTo(api, "downloadBudget").length, 0);
  });
});

describe("runTasks failures", () => {
  it("notifies the same failure once, and again when it changes", async (t) => {
    quiet(t);
    const texts = mockFetch(t);
    let error = "server down";
    const registry = { down: { run: async () => Promise.reject(new Error(error)) } };
    await runTasks({ notifications }, ["down"], registry);
    await runTasks({ notifications }, ["down"], registry);
    error = "bad password";
    await runTasks({ notifications }, ["down"], registry);
    assert.deepEqual(texts(), [
      "❌ actual-tasks: down failed\nserver down",
      "❌ actual-tasks: down failed\nbad password",
    ]);
  });

  it("notifies a task still running after TASK_TIMEOUT_MINUTES, without abandoning it", async (t) => {
    quiet(t);
    const texts = mockFetch(t);
    mock.timers.enable({ apis: ["setTimeout"] });
    t.after(() => mock.timers.reset());
    let finish;
    const registry = { slow: { run: () => new Promise((resolve) => (finish = resolve)) } };
    const run = runTasks({ notifications, taskTimeoutMinutes: 30 }, ["slow"], registry);
    await new Promise(setImmediate);
    mock.timers.tick(30 * 60_000);
    await new Promise(setImmediate);
    assert.deepEqual(texts(), ["⏱️ actual-tasks: slow is still running after 30 minutes"]);
    finish();
    assert.equal(await run, true);
  });
});
