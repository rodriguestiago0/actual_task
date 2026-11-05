import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, it, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { runTasks, truncate } from "../src/engine.js";
import { describeError, log } from "../src/log.js";
import { notify, parseNotificationUrls } from "../src/notify.js";

describe("describeError", () => {
  it("adds the error's code, or its cause's, unless the message has it", () => {
    const fetchFailed = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
    });
    assert.equal(describeError(fetchFailed), "fetch failed (ECONNREFUSED)");
    const actual = Object.assign(new Error("Could not get remote files"), {
      code: "network-failure",
    });
    assert.equal(
      describeError(new Error(`Actual Budget error: ${actual.message}`, { cause: actual })),
      "Actual Budget error: Could not get remote files (network-failure)",
    );
    const inMessage = Object.assign(new Error("Authentication failed: network-failure"), {
      code: "network-failure",
    });
    assert.equal(describeError(inMessage), "Authentication failed: network-failure");
  });
});

describe("failure details", () => {
  it("logs why a notification failed", async (t) => {
    const warn = mock.method(log, "warn", () => {});
    const fetch = mock.method(globalThis, "fetch", async () => {
      throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
    });
    t.after(() => {
      warn.mock.restore();
      fetch.mock.restore();
    });
    await notify(parseNotificationUrls("ntfy://ntfy.example/topic"), "hi");
    assert.deepEqual(warn.mock.calls[0].arguments, [
      "ntfy notification failed: fetch failed (ENOTFOUND)",
    ]);
  });

  it("cuts a long failure to fit in one notification", async (t) => {
    const error = mock.method(log, "error", () => {});
    const fetch = mock.method(globalThis, "fetch", async () => new Response("{}"));
    t.after(() => {
      error.mock.restore();
      fetch.mock.restore();
    });
    const registry = { long: { run: async () => Promise.reject(new Error("x".repeat(5000))) } };
    await runTasks(
      { notifications: parseNotificationUrls("discord://token@123") },
      ["long"],
      registry,
    );
    const { content } = JSON.parse(fetch.mock.calls[0].arguments[1].body);
    assert.ok(content.length < 2000);
    assert.equal(content, `❌ actual-tasks: long failed\n${truncate("x".repeat(5000))}`);
    assert.match(content, /… \(see the logs\)$/);
  });

  it("the CLI reports an unknown option without a stack trace", { timeout: 10_000 }, async () => {
    const child = spawn(process.execPath, [
      fileURLToPath(new URL("../index.js", import.meta.url)),
      "--bogus",
    ]);
    let output = "";
    child.stderr.on("data", (chunk) => (output += chunk));
    const [code] = await once(child, "exit");
    assert.equal(code, 1);
    assert.match(output, /Unknown option '--bogus'/);
    assert.doesNotMatch(output, /at .*\.js:\d+/);
  });
});
