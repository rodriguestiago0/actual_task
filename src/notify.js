import nodemailer from "nodemailer";
import { log } from "./log.js";

// Notification URLs use the Shoutrrr format, so URLs written for Watchtower work here too.

const TIMEOUT_MS = 10_000;

const decode = decodeURIComponent;
const list = (value) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const isYes = (value) => ["yes", "true", "1"].includes(value?.toLowerCase());

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

async function post(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
}

const postJson = (url, data, headers = {}) =>
  post(url, JSON.stringify(data), { "Content-Type": "application/json", ...headers });

/** Each service turns a parsed URL into send(text), throwing with the expected format if invalid. */
const services = {
  telegram(url) {
    // Shoutrrr also accepts "channels", which older Watchtower URLs use.
    const chats = list(url.searchParams.get("chats") ?? url.searchParams.get("channels"));
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
    const from = url.searchParams.get("from");
    const to = list(url.searchParams.get("to"));
    if (!url.hostname || !from || to.length === 0) {
      throw new Error("expected smtp://USER:PASSWORD@HOST:PORT/?from=ADDRESS&to=ADDRESS");
    }
    const port = Number(url.port || 25);
    const encryption = url.searchParams.get("encryption")?.toLowerCase() ?? "auto";
    const transport = nodemailer.createTransport({
      host: url.hostname,
      port,
      secure: encryption === "implicittls" || (encryption === "auto" && port === 465),
      ignoreTLS: encryption === "none",
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
    const scheme = url.searchParams.get("scheme") === "http" ? "http" : "https";
    const headers = url.username
      ? {
          Authorization: `Basic ${Buffer.from(`${decode(url.username)}:${decode(url.password)}`).toString("base64")}`,
        }
      : {};
    // JSON publishing keeps emoji titles out of HTTP headers.
    return (text) =>
      postJson(`${scheme}://${url.host}/${prefix}`, { topic, ...split(text) }, headers);
  },

  gotify(url) {
    const { prefix, last: token } = lastSegment(url.pathname);
    if (!url.host || !token) throw new Error("expected gotify://HOST/TOKEN");
    const scheme = isYes(url.searchParams.get("disabletls")) ? "http" : "https";
    return (text) =>
      postJson(`${scheme}://${url.host}/${prefix}message`, split(text), { "X-Gotify-Key": token });
  },

  generic(url, transport) {
    if (!url.host) throw new Error("expected generic+https://HOST/PATH");
    const scheme = transport ?? (isYes(url.searchParams.get("disabletls")) ? "http" : "https");
    if (!["http", "https"].includes(scheme)) throw new Error("expected generic+https://HOST/PATH");
    const target = new URL(`${scheme}://${url.host}${url.pathname}`);
    for (const [key, value] of url.searchParams) {
      if (!["template", "disabletls"].includes(key.toLowerCase()))
        target.searchParams.append(key, value);
    }
    return (text) => postJson(target, split(text));
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
        log.warn(`${name} notification failed: ${err.message}`);
      }
    }),
  );
}
