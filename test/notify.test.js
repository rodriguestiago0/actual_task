import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import nodemailer from "nodemailer";
import { notify, parseNotificationUrls } from "../src/notify.js";

function mockFetch(t, response = () => new Response("{}")) {
  const fetch = mock.method(globalThis, "fetch", async () => response());
  t.after(() => fetch.mock.restore());
  return fetch;
}

/** Sends text through a single NOTIFICATION_URL and returns the requests made. */
async function send(t, url, text = "❌ title\ndetails") {
  const fetch = mockFetch(t);
  await notify(parseNotificationUrls(url), text);
  return fetch.mock.calls.map(({ arguments: [target, options] }) => ({
    url: String(target),
    headers: options.headers,
    body: JSON.parse(options.body),
  }));
}

describe("parseNotificationUrls", () => {
  it("returns no channels when unset", () => {
    assert.deepEqual(parseNotificationUrls(undefined), []);
    assert.deepEqual(parseNotificationUrls(" "), []);
  });

  it("parses several space-separated URLs", () => {
    const channels = parseNotificationUrls("discord://tok@1  ntfy://ntfy.sh/topic");
    assert.deepEqual(
      channels.map((channel) => channel.name),
      ["discord", "ntfy"],
    );
  });

  it("rejects unknown services and incomplete URLs without echoing secrets", () => {
    assert.throws(
      () => parseNotificationUrls("pushover://secret@x"),
      (err) => {
        assert.match(err.message, /#1: unsupported service "pushover"/);
        assert.doesNotMatch(err.message, /secret/);
        return true;
      },
    );
    assert.throws(
      () => parseNotificationUrls("ntfy://ntfy.sh/t telegram://1:secret@telegram"),
      /#2: expected telegram:\/\/TOKEN@telegram\?chats=CHAT_ID$/,
    );
    assert.throws(() => parseNotificationUrls("not a url"), /#1 is not a valid URL/);
  });
});

describe("notify", () => {
  it("sends to every Telegram chat", async (t) => {
    const requests = await send(t, "telegram://123:AbC@telegram?chats=42,-7", "hi");
    assert.deepEqual(
      requests.map((request) => [request.url, request.body]),
      [
        ["https://api.telegram.org/bot123:AbC/sendMessage", { chat_id: "42", text: "hi" }],
        ["https://api.telegram.org/bot123:AbC/sendMessage", { chat_id: "-7", text: "hi" }],
      ],
    );
  });

  it("accepts channels as an alias for chats", async (t) => {
    const [request] = await send(t, "telegram://123:AbC@telegram?channels=42", "hi");
    assert.deepEqual(request.body, { chat_id: "42", text: "hi" });
  });

  it("posts to Discord and Slack webhooks", async (t) => {
    const [discord] = await send(t, "discord://ToKen@123", "hi");
    assert.equal(discord.url, "https://discord.com/api/webhooks/123/ToKen");
    assert.deepEqual(discord.body, { content: "hi" });

    const [slack] = await send(t, "slack://hook:T1-B2-XyZ@webhook", "hi");
    assert.equal(slack.url, "https://hooks.slack.com/services/T1/B2/XyZ");
    assert.deepEqual(slack.body, { text: "hi" });

    const [legacySlack] = await send(t, "slack://T1/B2/XyZ", "hi");
    assert.equal(legacySlack.url, slack.url);
  });

  it("publishes to ntfy and Gotify with a title", async (t) => {
    const [ntfy] = await send(t, "ntfy://user:pass@ntfy.example.com/alerts");
    assert.equal(ntfy.url, "https://ntfy.example.com/");
    assert.deepEqual(ntfy.body, { topic: "alerts", title: "❌ title", message: "details" });
    assert.equal(ntfy.headers.Authorization, `Basic ${btoa("user:pass")}`);

    const [gotify] = await send(t, "gotify://gotify.example.com/sub/AppToken?disabletls=yes");
    assert.equal(gotify.url, "http://gotify.example.com/sub/message");
    assert.equal(gotify.headers["X-Gotify-Key"], "AppToken");
    assert.deepEqual(gotify.body, { title: "❌ title", message: "details" });
  });

  it("posts JSON to a generic webhook, keeping its own query parameters", async (t) => {
    const [request] = await send(t, "generic+http://hooks.local:8080/In?template=json&key=AbC");
    assert.equal(request.url, "http://hooks.local:8080/In?key=AbC");
    assert.deepEqual(request.body, { title: "❌ title", message: "details" });

    const [defaultHttps] = await send(t, "generic://hooks.local/in");
    assert.equal(defaultHttps.url, "https://hooks.local/in");
  });

  it("emails through SMTP", async (t) => {
    const sent = [];
    const createTransport = mock.method(nodemailer, "createTransport", (options) => ({
      options,
      sendMail: async (mail) => sent.push(mail),
    }));
    t.after(() => createTransport.mock.restore());

    await notify(
      parseNotificationUrls(
        "smtp://me%40x.com:p%40ss@mail.x.com:465/?from=me@x.com&to=a@x.com,b@x.com",
      ),
      "❌ title\ndetails",
    );

    const [options] = createTransport.mock.calls[0].arguments;
    assert.equal(options.secure, true);
    assert.deepEqual(options.auth, { user: "me@x.com", pass: "p@ss" });
    assert.deepEqual(sent, [
      { from: "me@x.com", to: ["a@x.com", "b@x.com"], subject: "❌ title", text: "details" },
    ]);
  });

  it("keeps sending to other channels when one fails", async (t) => {
    const fetch = mockFetch(t, () => new Response("nope", { status: 500 }));
    await notify(parseNotificationUrls("discord://a@1 discord://b@2"), "hi");
    assert.equal(fetch.mock.callCount(), 2);
  });
});
