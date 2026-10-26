export const PRIM_FETCH_TIMEOUT_MS = 10_000;

export function primFetchInit(apiKey: string): RequestInit {
  return {
    headers: { apiKey: apiKey },
    signal: AbortSignal.timeout(PRIM_FETCH_TIMEOUT_MS),
  };
}
