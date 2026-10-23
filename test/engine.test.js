import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { withBudget } from "../src/actual.js";
import { idle, runTasks } from "../src/engine.js";
import { parseNotificationUrls } from "../src/notify.js";
import { callsTo, fakeApi } from "./fake-api.js";

const notifications = parseNotificationUrls("telegram://1:token@telegram?chats=42");
const actualConfig = { serverURL: "x", password: "p", syncId: "s", dataDir: "./temp_data_test" };

function mockFetch() {
  return mock.method(globalThis, "fetch", async () => new Response("{}"));
}

describe("withBudget", () => {
  it("syncs and shuts down after the callback", async () => {
    const api = fakeApi();
    await withBudget(actualConfig, async () => {}, api);
    assert.deepEqual(
      api.calls.map(([name]) => name),
      ["init", "downloadBudget", "sync", "shutdown"],
    );
  });

  it("still shuts down when the callback throws", async () => {
    const api = fakeApi();
    await assert.rejects(
      withBudget(actualConfig, async () => Promise.reject(new Error("boom")), api),
      /boom/,
    );
    assert.equal(callsTo(api, "shutdown").length, 1);
    assert.equal(callsTo(api, "sync").length, 0);
  });

  it("reports the callback's error when shutdown also fails", async () => {
    const api = fakeApi();
    api.shutdown = async () => Promise.reject(new Error("shutdown failed"));
    await assert.rejects(
      withBudget(actualConfig, async () => Promise.reject(new Error("boom")), api),
      /boom/,
    );
  });
});

describe("runTasks", () => {
  it("keeps going after a failure and notifies about it", async (t) => {
    const fetch = mockFetch();
    t.after(() => fetch.mock.restore());
    const ran = [];
    const registry = {
      first: { run: async () => Promise.reject(new Error("broken")) },
      second: { run: async () => ran.push("second") },
    };

    const ok = await runTasks({ notifications }, ["first", "second"], registry);

    assert.equal(ok, false);
    assert.deepEqual(ran, ["second"]);
    assert.match(JSON.parse(fetch.mock.calls[0].arguments[1].body).text, /first failed\nbroken/);
  });

  it("notifies once when a failed task succeeds again", async (t) => {
    const fetch = mockFetch();
    t.after(() => fetch.mock.restore());
    let broken = true;
    const registry = {
      flaky: { run: async () => broken && Promise.reject(new Error("broken")) },
    };
    const texts = () => fetch.mock.calls.map((call) => JSON.parse(call.arguments[1].body).text);

    await runTasks({ notifications }, ["flaky"], registry);
    broken = false;
    await runTasks({ notifications }, ["flaky"], registry);
    await runTasks({ notifications }, ["flaky"], registry);

    assert.equal(texts().length, 2);
    assert.match(texts()[1], /flaky recovered/);
  });

  it("never runs two batches at the same time", async () => {
    let running = 0;
    let maxRunning = 0;
    const slow = {
      run: async () => {
        maxRunning = Math.max(maxRunning, ++running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running--;
      },
    };
    const registry = { a: slow, b: slow };
    await Promise.all([runTasks({}, ["a"], registry), runTasks({}, ["b"], registry)]);
    assert.equal(maxRunning, 1);
  });

  it("idle waits for the running batch", async () => {
    let finished = false;
    const registry = {
      slow: {
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          finished = true;
        },
      },
    };
    runTasks({}, ["slow"], registry);
    await idle();
    assert.equal(finished, true);
  });
});
