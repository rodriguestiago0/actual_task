import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { log } from "../src/log.js";
import { fetchGhostfolioBalances, fetchWealthfolioBalances } from "../src/tasks/portfolio.js";

const accounts = { accounts: [{ id: "g", value: 12.5, valueInBaseCurrency: 11 }] };

function mockFetch(t, ...responses) {
  const fetch = mock.method(globalThis, "fetch", async () => responses.shift());
  t.after(() => fetch.mock.restore());
  return fetch;
}

describe("fetchGhostfolioBalances", () => {
  it("exchanges the security token for a JWT, then reads account values", async (t) => {
    const fetch = mockFetch(t, Response.json({ authToken: "jwt" }), Response.json(accounts));
    const balances = await fetchGhostfolioBalances({
      serverURL: "https://gf",
      accessToken: "secret",
      token: null,
    });

    assert.deepEqual([...balances], [["g", 12.5]]);
    const [[authUrl, auth], [accountUrl, account]] = fetch.mock.calls.map((c) => c.arguments);
    assert.equal(authUrl, "https://gf/api/v1/auth/anonymous");
    assert.equal(auth.method, "POST");
    assert.equal(auth.body, '{"accessToken":"secret"}');
    assert.equal(accountUrl, "https://gf/api/v1/accounts");
    assert.equal(account.headers.Authorization, "Bearer jwt");
  });

  it("uses the legacy GHOSTFOLIO_TOKEN directly, with a warning", async (t) => {
    const warn = mock.method(log, "warn", () => {});
    t.after(() => warn.mock.restore());
    const fetch = mockFetch(t, Response.json(accounts));

    await fetchGhostfolioBalances({ serverURL: "https://gf", accessToken: null, token: "jwt" });

    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(fetch.mock.calls[0].arguments[1].headers.Authorization, "Bearer jwt");
    assert.match(warn.mock.calls[0].arguments[0], /GHOSTFOLIO_ACCESS_TOKEN/);
  });

  it("falls back to /api/v1/account on Ghostfolio before 3.94.0", async (t) => {
    const fetch = mockFetch(t, new Response("Not Found", { status: 404 }), Response.json(accounts));
    const balances = await fetchGhostfolioBalances({ serverURL: "https://gf", token: "jwt" });

    assert.deepEqual([...balances], [["g", 12.5]]);
    assert.deepEqual(
      fetch.mock.calls.map((c) => c.arguments[0]),
      ["https://gf/api/v1/accounts", "https://gf/api/v1/account"],
    );
  });

  it("doesn't fall back on other errors", async (t) => {
    mockFetch(t, new Response("Unauthorized", { status: 401 }));
    await assert.rejects(
      fetchGhostfolioBalances({ serverURL: "https://gf", token: "jwt" }),
      /GET \/api\/v1\/accounts failed: 401/,
    );
  });

  it("warns when Restricted view hides the values", async (t) => {
    const warn = mock.method(log, "warn", () => {});
    t.after(() => warn.mock.restore());
    mockFetch(t, Response.json({ accounts: [{ id: "g", value: null }] }));

    const balances = await fetchGhostfolioBalances({ serverURL: "https://gf", token: "jwt" });

    assert.equal(balances.get("g"), null);
    assert.ok(warn.mock.calls.some((c) => /Restricted view/.test(c.arguments[0])));
  });
});

describe("unexpected responses", () => {
  it("fails clearly when Ghostfolio returns no account list", async (t) => {
    mockFetch(t, new Response(""));
    await assert.rejects(
      fetchGhostfolioBalances({ serverURL: "https://gf", accessToken: null, token: "jwt" }),
      /Ghostfolio returned no account list/,
    );
  });

  it("fails clearly when Wealthfolio returns no valuation list", async (t) => {
    mockFetch(t, Response.json({}), Response.json({ error: "x" }));
    await assert.rejects(
      fetchWealthfolioBalances({ serverURL: "https://wf" }),
      /Wealthfolio returned no valuation list/,
    );
  });
});
