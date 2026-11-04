import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { log } from "../src/log.js";
import { fetchGhostfolioBalances } from "../src/tasks/portfolio.js";

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
    assert.equal(accountUrl, "https://gf/api/v1/account");
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
});
