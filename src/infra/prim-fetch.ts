import type { Logger } from "./logger.js";
import { silentLogger } from "./logger.js";

export const PRIM_FETCH_TIMEOUT_MS = 50_000;

export function primFetchInit(
  apiKey: string,
  timeoutMs: number = PRIM_FETCH_TIMEOUT_MS,
): RequestInit {
  return {
    headers: { apiKey: apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  };
}

export async function primRequest(
  url: URL,
  apiKey: string,
  fetchFn: typeof fetch,
  log: Logger = silentLogger,
  timeoutMs: number = PRIM_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const started = Date.now();
  const path = `${url.pathname}${url.search}`;
  try {
    const response = await fetchFn(url, primFetchInit(apiKey, timeoutMs));
    const ms = Date.now() - started;
    const fields = { path, status: response.status, ms };
    if (response.ok) {
      log.info(fields, "PRIM request");
    } else {
      log.warn(fields, "PRIM request failed");
    }
    return response;
  } catch (error) {
    log.error(
      { err: error, path, ms: Date.now() - started },
      "PRIM request error",
    );
    throw error;
  }
}
