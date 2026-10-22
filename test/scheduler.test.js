import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scheduleGroups, unknownCronVariables } from "../src/engine.js";

const config = (taskCronExpressions = {}) => ({
  cronExpression: "0 */4 * * *",
  taskCronExpressions,
});

describe("scheduleGroups", () => {
  it("puts tasks without their own schedule on CRON_EXPRESSION", () => {
    const groups = scheduleGroups(config({ "fix-payees": "*/5 * * * *" }), [
      "calculate-mortgage",
      "fix-payees",
      "bank-sync",
    ]);
    assert.deepEqual(
      [...groups],
      [
        ["0 */4 * * *", ["calculate-mortgage", "bank-sync"]],
        ["*/5 * * * *", ["fix-payees"]],
      ],
    );
  });

  it("rejects an invalid cron expression", () => {
    assert.throws(
      () => scheduleGroups(config({ "bank-sync": "every day" }), ["bank-sync"]),
      /Invalid cron expression: "every day"/,
    );
  });
});

describe("unknownCronVariables", () => {
  it("names the variables that match no task", () => {
    const names = unknownCronVariables(
      config({ "fix-payee": "* * * * *", "bank-sync": "* * * * *" }),
    );
    assert.deepEqual(names, ["FIX_PAYEE_CRON"]);
  });
});

describe("index-cron.js", () => {
  it(
    "schedules enabled tasks, warns about unknown _CRON variables and stops on SIGTERM",
    { timeout: 10_000 },
    async (t) => {
      // Run in an empty directory so a local .env isn't loaded.
      const cwd = await mkdtemp(join(tmpdir(), "actual-tasks-"));
      t.after(() => rm(cwd, { recursive: true, force: true }));

      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("../index-cron.js", import.meta.url))],
        {
          cwd,
          env: {
            PATH: process.env.PATH,
            ACTUAL_SERVER_URL: "http://localhost:1",
            ACTUAL_SERVER_PASSWORD: "p",
            ACTUAL_SYNC_ID: "s",
            ENABLE_BANK_SYNC: "true",
            BANK_SYNC_CRON: "0 0 1 1 *",
            FIX_PAYEE_CRON: "* * * * *",
          },
        },
      );
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));

      while (!output.includes("Scheduled")) await once(child.stdout, "data");
      child.kill("SIGTERM");
      const [code] = await once(child, "exit");

      assert.equal(code, 0);
      assert.match(output, /WARN Ignoring FIX_PAYEE_CRON: no task with that name/);
      assert.match(output, /INFO Scheduled bank-sync \(0 0 1 1 \*\)/);
      assert.match(output, /INFO Received SIGTERM, stopping/);
    },
  );
});
