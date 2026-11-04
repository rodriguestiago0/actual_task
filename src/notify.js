import nodemailer from "nodemailer";
import { stringToBoolean } from "./bool.js";
import { describeError, log } from "./log.js";

// Notification URLs use the Shoutrrr format, so URLs written for Watchtower work here too.
// Query parameter names ignore case, as in Shoutrrr.

const TIMEOUT_MS = 10_000;
// Shoutrrr's smtp encryption values, lowercased.
const ENCRYPTIONS = ["auto", "explicittls", "implicittls", "none"];

const decode = decodeURIComponent;
const list = (value) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** The URL's query parameters by lowercased name. */
const paramsOf = (url) =>
  new Map([...url.searchParams].map(([key, value]) => [key.toLowerCase(), value]));

const basicAuth = (url) =>
  `Basic ${Buffer.from(`${decode(url.username)}:${decode(url.password)}`).toString("base64")}`;

/** First line of the text is the title, the rest is the message. */
function split(text) {
  const [title, ...rest] = text.split("\n");
  return { title, message: rest.join("\n") || title };
}

/** Splits a URL path into its leading segments and the last one, e.g. a topic or token. */
function lastSegment(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  const last = segments.pop();
  return { prefix: segments.map((segment) => `${segment}/`).join(""), last: last && decode(last) };
}

async function post(url, body, headers = {}, method = "POST") {
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
}

const postJson = (url, data, headers = {}, method = "POST") =>
  post(url, JSON.stringify(data), { "Content-Type": "application/json", ...headers }, method);

/** Each service turns a parsed URL into send(text), throwing with the expected format if invalid. */
const services = {
  telegram(url) {
    // Shoutrrr also accepts "channels", which older Watchtower URLs use.
    const params = paramsOf(url);
    const chats = list(params.get("chats") ?? params.get("channels"));
    if (!url.password || chats.length === 0)
      throw new Error("expected telegram://TOKEN@telegram?chats=CHAT_ID");
    const token = `${decode(url.username)}:${decode(url.password)}`;
    return (text) =>
      Promise.all(
        chats.map((chat_id) =>
          postJson(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id, text }),
        ),
      );
  },

  discord(url) {
    if (!url.username || !url.hostname) throw new Error("expected discord://TOKEN@WEBHOOK_ID");
    const webhook = `https://discord.com/api/webhooks/${url.hostname}/${decode(url.username)}`;
    return (text) => postJson(webhook, { content: text });
  },

  slack(url) {
    // slack://hook:T-B-X@webhook or the older slack://T/B/X
    const tokens =
      url.hostname === "webhook"
        ? decode(url.password).split("-")
        : [url.hostname, ...url.pathname.split("/").filter(Boolean)];
    if (tokens.length !== 3 || tokens.some((token) => !token)) {
      throw new Error("expected slack://hook:T-B-X@webhook");
    }
    const webhook = `https://hooks.slack.com/services/${tokens.join("/")}`;
    return (text) => postJson(webhook, { text });
  },

  smtp(url) {
    // Shoutrrr's names, or the shorter from/to
    const params = paramsOf(url);
    const from = params.get("fromaddress") ?? params.get("from");
    const to = list(params.get("toaddresses") ?? params.get("to"));
    if (!url.hostname || !from || to.length === 0) {
      throw new Error(
        "expected smtp://USER:PASSWORD@HOST:PORT/?fromaddress=ADDRESS&toaddresses=ADDRESS",
      );
    }
    const port = Number(url.port || 25);
    const encryption = params.get("encryption")?.toLowerCase() ?? "auto";
    if (!ENCRYPTIONS.includes(encryption)) {
      throw new Error("expected encryption=Auto, ExplicitTLS, ImplicitTLS or None");
    }
    const implicit = encryption === "implicittls" || (encryption === "auto" && port === 465);
    // Shoutrrr's usestarttls=No turns STARTTLS off, like encryption=None.
    const startTls = stringToBoolean(params.get("usestarttls") || "yes");
    const plain = encryption === "none" || (!implicit && !startTls);
    const transport = nodemailer.createTransport({
      host: url.hostname,
      port,
      secure: implicit,
      // STARTTLS is required, not opportunistic, so credentials never go out in clear text.
      requireTLS: !implicit && !plain,
      ignoreTLS: plain,
      auth: url.username ? { user: decode(url.username), pass: decode(url.password) } : undefined,
      connectionTimeout: TIMEOUT_MS,
    });
    return async (text) => {
      const { title, message } = split(text);
      await transport.sendMail({ from, to, subject: title, text: message });
    };
  },

  ntfy(url) {
    const { prefix, last: topic } = lastSegment(url.pathname);
    if (!url.host || !topic) throw new Error("expected ntfy://HOST/TOPIC");
    const scheme = paramsOf(url).get("scheme")?.toLowerCase() === "http" ? "http" : "https";
    const headers = url.username ? { Authorization: basicAuth(url) } : {};
    // JSON publishing keeps emoji titles out of HTTP headers.
    return (text) =>
      postJson(`${scheme}://${url.host}/${prefix}`, { topic, ...split(text) }, headers);
  },

  gotify(url) {
    const { prefix, last: token } = lastSegment(url.pathname);
    if (!url.host || !token) throw new Error("expected gotify://HOST/TOKEN");
    const scheme = stringToBoolean(paramsOf(url).get("disabletls")) ? "http" : "https";
    return (text) =>
      postJson(`${scheme}://${url.host}/${prefix}message`, split(text), { "X-Gotify-Key": token });
  },

  generic(url, transport) {
    if (!url.host) throw new Error("expected generic+https://HOST/PATH");
    const params = paramsOf(url);
    const scheme = transport ?? (stringToBoolean(params.get("disabletls")) ? "http" : "https");
    if (!["http", "https"].includes(scheme)) throw new Error("expected generic+https://HOST/PATH");
    // As in Shoutrrr: @Name=value is a header, $name=value an extra field in the JSON, credentials
    // in the URL are sent as Basic auth, and these parameters configure the request. The rest are
    // the target's own query parameters.
    const options = [
      "template",
      "disabletls",
      "titlekey",
      "messagekey",
      "requestmethod",
      "contenttype",
    ];
    const target = new URL(`${scheme}://${url.host}${url.pathname}`);
    const headers = url.username ? { Authorization: basicAuth(url) } : {};
    const extra = {};
    for (const [key, value] of url.searchParams) {
      if (key.startsWith("@")) headers[key.slice(1)] = value;
      else if (key.startsWith("$")) extra[key.slice(1)] = value;
      else if (!options.includes(key.toLowerCase())) target.searchParams.append(key, value);
    }
    const titleKey = params.get("titlekey") || "title";
    const messageKey = params.get("messagekey") || "message";
    const method = (params.get("requestmethod") || "POST").toUpperCase();
    return (text) => {
      const { title, message } = split(text);
      return postJson(
        target,
        { ...extra, [titleKey]: title, [messageKey]: message },
        headers,
        method,
      );
    };
  },
};

/**
 * Parses NOTIFICATION_URL (space-separated URLs) into [{ name, send(text) }].
 * Errors never include the URL itself, since it holds credentials.
 */
export function parseNotificationUrls(value = "") {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((raw, index) => {
      const label = `NOTIFICATION_URL #${index + 1}`;
      let url;
      try {
        url = new URL(raw);
      } catch {
        throw new Error(`${label} is not a valid URL`);
      }
      const [name, transport] = url.protocol.slice(0, -1).toLowerCase().split("+");
      if (!Object.hasOwn(services, name)) {
        throw new Error(
          `${label}: unsupported service "${name}" (use ${Object.keys(services).join(", ")})`,
        );
      }
      try {
        return { name, send: services[name](url, transport) };
      } catch (err) {
        throw new Error(`${label}: ${err.message}`, { cause: err });
      }
    });
}

/** Sends text to every configured channel. Never throws. */
export async function notify(channels = [], text) {
  await Promise.all(
    channels.map(async ({ name, send }) => {
      try {
        await send(text);
      } catch (err) {
        log.warn(`${name} notification failed: ${describeError(err)}`);
      }
    }),
  );
}
