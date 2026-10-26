import type { Logger } from "./logger.js";
import { silentLogger } from "./logger.js";

export const PRIM_FETCH_TIMEOUT_MS = 10_000;

export function primFetchInit(apiKey: string): RequestInit {
  return {
    headers: { apiKey: apiKey },
    signal: AbortSignal.timeout(PRIM_FETCH_TIMEOUT_MS),
  };
}

export async function primRequest(
  url: URL,
  apiKey: string,
  fetchFn: typeof fetch,
  log: Logger = silentLogger,
): Promise<Response> {
  const started = Date.now();
  const path = `${url.pathname}${url.search}`;
  try {
    const response = await fetchFn(url, primFetchInit(apiKey));
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
