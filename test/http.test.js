import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { requestJson } from "../src/http.js";

function mockFetch(t, response) {
  const fetch = mock.method(globalThis, "fetch", async () => response);
  t.after(() => fetch.mock.restore());
  return fetch;
}

describe("requestJson", () => {
  it("parses the JSON response", async (t) => {
    mockFetch(t, new Response('{"ok":true}'));
    assert.deepEqual(await requestJson("https://host/api"), { ok: true });
  });

  it("returns null for an empty body", async (t) => {
    mockFetch(t, new Response(""));
    assert.equal(await requestJson("https://host/api", { method: "POST" }), null);
  });

  it("sends a JSON body with its content type", async (t) => {
    const fetch = mockFetch(t, new Response("{}"));
    await requestJson("https://host/api", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: { a: 1 },
    });
    const [, options] = fetch.mock.calls[0].arguments;
    assert.equal(options.body, '{"a":1}');
    assert.deepEqual(options.headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer x",
    });
  });

  it("throws with method, path and status, without the query string", async (t) => {
    mockFetch(t, new Response("nope", { status: 401 }));
    await assert.rejects(requestJson("https://host/api/v1/account?token=secret"), (err) => {
      assert.equal(err.message, "GET /api/v1/account failed: 401 nope");
      return true;
    });
  });
});
