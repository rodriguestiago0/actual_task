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

  it("throws with method, path and status, without the query string or body", async (t) => {
    mockFetch(t, new Response("nope", { status: 401 }));
    const write = mock.method(process.stderr, "write", () => true);
    t.after(() => write.mock.restore());
    await assert.rejects(requestJson("https://host/api/v1/account?token=secret"), (err) => {
      assert.equal(err.message, "GET /api/v1/account failed: 401");
      assert.equal(err.status, 401);
      assert.equal(err.body, "nope");
      return true;
    });
    assert.match(
      write.mock.calls[0].arguments[0],
      /WARN GET \/api\/v1\/account answered 401: nope/,
    );
  });
});

describe("requestJson retries", () => {
  const noDelay = { retryDelaysMs: [0, 0] };
  const sequence = (t, ...responses) => {
    const fetch = mock.method(globalThis, "fetch", async () => {
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    });
    t.after(() => fetch.mock.restore());
    return fetch;
  };
  const quiet = (t) => {
    const write = mock.method(process.stderr, "write", () => true);
    t.after(() => write.mock.restore());
  };

  it("retries a GET after a 5xx or a network error", async (t) => {
    quiet(t);
    const fetch = sequence(
      t,
      new Response("down", { status: 503 }),
      new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }),
      new Response('{"ok":true}'),
    );
    assert.deepEqual(await requestJson("https://host/api", {}, noDelay), { ok: true });
    assert.equal(fetch.mock.callCount(), 3);
  });

  it("gives up after the last retry, naming the request and the network error", async (t) => {
    quiet(t);
    const failure = () => new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
    const fetch = sequence(t, failure(), failure(), failure());
    await assert.rejects(requestJson("https://host/api?x=1", {}, noDelay), {
      message: "GET /api failed: ENOTFOUND",
    });
    assert.equal(fetch.mock.callCount(), 3);
  });

  it("never retries a POST", async (t) => {
    const post = sequence(t, new Response("down", { status: 503 }));
    await assert.rejects(requestJson("https://host/login", { method: "POST" }, noDelay), {
      status: 503,
    });
    assert.equal(post.mock.callCount(), 1);
  });

  it("doesn't retry a 4xx", async (t) => {
    const get = sequence(t, new Response("no", { status: 404 }));
    await assert.rejects(requestJson("https://host/api", {}, noDelay), { status: 404 });
    assert.equal(get.mock.callCount(), 1);
  });

  it("says when a response isn't JSON", async (t) => {
    sequence(t, new Response("<html>maintenance</html>"));
    await assert.rejects(requestJson("https://host/api", {}, noDelay), {
      message: "GET /api returned a response that isn't JSON",
    });
  });
});
