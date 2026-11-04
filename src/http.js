import { setTimeout as sleep } from "node:timers/promises";
import { log } from "./log.js";

const TIMEOUT_MS = 30_000;
// Waits before each retry of a GET after a network error, a timeout or a 5xx.
const RETRY_DELAYS_MS = [1_000, 5_000];

export async function requestJson(
  url,
  { method = "GET", headers = {}, body } = {},
  { retryDelaysMs = RETRY_DELAYS_MS } = {},
) {
  const where = `${method} ${new URL(url).pathname}`;
  // Only GETs are retried: repeating a login POST could lock the account or send another OTP.
  const delays = method === "GET" ? retryDelaysMs : [];

  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < delays.length;
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json", ...headers } : headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // fetch only says "fetch failed"; the cause has e.g. ENOTFOUND or ECONNRESET.
      const reason = err.cause?.code ?? err.message;
      if (!canRetry) throw new Error(`${where} failed: ${reason}`, { cause: err });
      log.warn(`${where} failed (${reason}), retrying`);
      await sleep(delays[attempt]);
      continue;
    }

    if (response.status >= 500 && canRetry) {
      await response.body?.cancel();
      log.warn(`${where} failed with ${response.status}, retrying`);
      await sleep(delays[attempt]);
      continue;
    }

    const text = await response.text();
    if (!response.ok) {
      // The body stays in the log: it can echo account details, and the message is notified.
      const excerpt = text.slice(0, 200);
      log.warn(`${where} answered ${response.status}: ${excerpt}`);
      const error = new Error(`${where} failed: ${response.status}`);
      error.status = response.status;
      error.body = excerpt;
      throw error;
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`${where} returned a response that isn't JSON`, { cause: err });
    }
  }
}
