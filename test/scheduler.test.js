import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { enabledTaskNames, scheduleGroups, unknownCronVariables } from "../src/engine.js";

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

describe("index-cron.js configuration errors", () => {
  const indexCron = fileURLToPath(new URL("../index-cron.js", import.meta.url));
  const run = async (cwd, env) => {
    const child = spawn(process.execPath, [indexCron], {
      cwd,
      env: { PATH: process.env.PATH, ...env },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const [code] = await once(child, "exit");
    return { code, output };
  };

  it("exits with status 1 when no task is enabled", { timeout: 10_000 }, async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), "actual-tasks-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const { code, output } = await run(cwd, {
      ACTUAL_SERVER_URL: "http://localhost:1",
      ACTUAL_SERVER_PASSWORD: "p",
      ACTUAL_SYNC_ID: "s",
    });
    assert.equal(code, 1);
    assert.match(output, /ERROR Invalid configuration: No tasks enabled/);
    assert.doesNotMatch(output, /at .*\.js:\d+/);
  });

  it("notifies a configuration error once until it changes", { timeout: 10_000 }, async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), "actual-tasks-"));
    const received = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.end();
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      server.close();
      return rm(cwd, { recursive: true, force: true });
    });
    const env = {
      NOTIFICATION_URL: `generic+http://127.0.0.1:${server.address().port}/hook`,
    };

    for (let i = 0; i < 2; i++) assert.equal((await run(cwd, env)).code, 1);
    await run(cwd, { ...env, ACTUAL_SERVER_URL: "http://localhost:1" });

    assert.deepEqual(
      received.map(({ message }) => message),
      [
        "Missing environment variable(s): ACTUAL_SERVER_URL, ACTUAL_SERVER_PASSWORD, ACTUAL_SYNC_ID",
        "Missing environment variable(s): ACTUAL_SERVER_PASSWORD, ACTUAL_SYNC_ID",
      ],
    );
  });
});

describe("enabledTaskNames", () => {
  it("runs bank sync before the tasks that read its transactions", () => {
    const names = enabledTaskNames({
      bankSync: true,
      mortgage: {},
      payeeRename: {},
      ruleMerge: true,
    });
    assert.deepEqual(names, ["bank-sync", "calculate-mortgage", "fix-payees", "merge-rules"]);
  });
});
