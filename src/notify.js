import { log } from "./log.js";

/** Sends a Telegram message when TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are configured. Never throws. */
export async function notify(telegram, text) {
  if (!telegram) return;
  try {
    // The bot token is part of the URL, so errors below never include it.
    const response = await fetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegram.chatId, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      log.warn(`Telegram notification failed: ${response.status} ${await response.text()}`);
    }
  } catch (err) {
    log.warn(`Telegram notification failed: ${err.message}`);
  }
}
