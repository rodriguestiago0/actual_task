import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { withBudget } from "../src/actual.js";
import { runTasks } from "../src/engine.js";
import { notify } from "../src/notify.js";
import { callsTo, fakeApi } from "./fake-api.js";

const telegram = { botToken: "token", chatId: "42" };
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
});

describe("notify", () => {
  it("does nothing without Telegram settings", async (t) => {
    const fetch = mockFetch();
    t.after(() => fetch.mock.restore());
    await notify(null, "hi");
    assert.equal(fetch.mock.callCount(), 0);
  });

  it("posts the message to the chat", async (t) => {
    const fetch = mockFetch();
    t.after(() => fetch.mock.restore());
    await notify(telegram, "hi");
    const [url, options] = fetch.mock.calls[0].arguments;
    assert.equal(url, "https://api.telegram.org/bottoken/sendMessage");
    assert.deepEqual(JSON.parse(options.body), { chat_id: "42", text: "hi" });
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

    const ok = await runTasks({ telegram }, ["first", "second"], registry);

    assert.equal(ok, false);
    assert.deepEqual(ran, ["second"]);
    assert.match(JSON.parse(fetch.mock.calls[0].arguments[1].body).text, /first failed\nbroken/);
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
});
