import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { dryRunApi, withBudget } from "../src/actual.js";
import { idle, runTasks, summarize } from "../src/engine.js";
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

  it("returns the callback's result", async () => {
    assert.equal(await withBudget(actualConfig, async () => "done", fakeApi()), "done");
  });

  // the real shutdown() pushes pending changes too, swallowing errors; only api.sync() reports them
  it("still shuts down when the callback throws, without reporting a sync", async () => {
    const api = fakeApi();
    await assert.rejects(
      withBudget(actualConfig, async () => Promise.reject(new Error("boom")), api),
      /boom/,
    );
    assert.equal(callsTo(api, "shutdown").length, 1);
    assert.equal(callsTo(api, "sync").length, 0);
  });

  it("in a dry run, skips changes and doesn't sync", async () => {
    const api = fakeApi({ payees: [{ id: "1", name: "Cafe" }] });
    let payees;
    await withBudget(
      { ...actualConfig, dryRun: true },
      async (budget) => {
        payees = await budget.getPayees();
        await budget.updatePayee("1", { name: "Coffee" });
        await budget.mergePayees("1", ["2"]);
      },
      api,
    );
    assert.deepEqual(payees, [{ id: "1", name: "Cafe" }]);
    assert.deepEqual(
      api.calls.map(([name]) => name),
      ["init", "downloadBudget", "getPayees", "shutdown"],
    );
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

describe("dryRunApi", () => {
  it("counts skipped calls and previews imports", async () => {
    const api = fakeApi();
    const skipped = new Map();
    const budget = dryRunApi(api, skipped);
    await budget.updateRule({ id: "1" });
    await budget.updateRule({ id: "2" });
    await budget.importTransactions("acc", [{ date: "2026-11-01", amount: 1 }]);
    assert.deepEqual([...skipped], [["updateRule", 2]]);
    assert.deepEqual(callsTo(api, "importTransactions"), [
      [
        "importTransactions",
        "acc",
        [{ date: "2026-11-01", amount: 1 }],
        { defaultCleared: true, dryRun: true },
      ],
    ]);
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

  it("notifies a task's warning once, and again when it changes", async (t) => {
    const fetch = mockFetch();
    t.after(() => fetch.mock.restore());
    let warning = "conflict A";
    const registry = { merge: { run: async () => warning } };
    const texts = () => fetch.mock.calls.map((call) => JSON.parse(call.arguments[1].body).text);

    await runTasks({ notifications }, ["merge"], registry);
    await runTasks({ notifications }, ["merge"], registry);
    warning = undefined;
    await runTasks({ notifications }, ["merge"], registry);
    warning = "conflict A";
    await runTasks({ notifications }, ["merge"], registry);

    assert.deepEqual(texts(), [
      "⚠️ actual-tasks: merge\nconflict A",
      "⚠️ actual-tasks: merge\nconflict A",
    ]);
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

describe("summarize", () => {
  it("joins the items, or returns undefined without any", () => {
    assert.equal(summarize(["a", "b"], "conflicts"), "a\n\nb");
    assert.equal(summarize([], "conflicts"), undefined);
  });

  it("counts the items that don't fit in one notification", () => {
    const text = summarize(["x".repeat(1000), "y".repeat(1000), "z"], "conflicts");
    assert.equal(text, `${"x".repeat(1000)}\n\n…and 2 more conflicts, see the logs`);
  });
});
