import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrimNavitiaLookup } from "./prim-navitia-lookup.js";
import { createPrimSiriStopMonitoring } from "./prim-siri-stop-monitoring.js";
import { createPrimTrafficReports } from "./prim-traffic-reports.js";

const TIMEOUT_MS = 10_000;

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("PRIM fetch timeouts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts Navitia lookup after about 10 seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    let signal: AbortSignal | undefined;
    const lookup = createPrimNavitiaLookup({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return okJson({ pt_objects: [] });
      },
    });

    await lookup.searchLines("RER B");

    expect(timeout).toHaveBeenCalledWith(TIMEOUT_MS);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts SIRI stop-monitoring after about 10 seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    let signal: AbortSignal | undefined;
    const siri = createPrimSiriStopMonitoring({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return okJson({ Siri: { ServiceDelivery: { StopMonitoringDelivery: {} } } });
      },
    });

    await siri.getPassages("STIF:StopArea:SP:73641:");

    expect(timeout).toHaveBeenCalledWith(TIMEOUT_MS);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts traffic_reports after about 10 seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    let signal: AbortSignal | undefined;
    const snapshot = createPrimTrafficReports({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return okJson({ disruptions: [], traffic_reports: [] });
      },
    });

    await snapshot.fetch();

    expect(timeout).toHaveBeenCalledWith(TIMEOUT_MS);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
