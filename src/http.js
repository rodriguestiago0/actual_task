const TIMEOUT_MS = 30_000;

export async function requestJson(url, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json", ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${method} ${new URL(url).pathname} failed: ${response.status} ${text.slice(0, 200)}`,
    );
  }
  return text ? JSON.parse(text) : null;
}
