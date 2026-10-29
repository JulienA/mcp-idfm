import { afterEach, describe, expect, it, vi } from "vitest";
import { primFetchInit } from "./prim-fetch.js";
import { createPrimItineraire } from "./prim-itineraire.js";
import { createPrimNavitiaLookup } from "./prim-navitia-lookup.js";
import { createPrimSiriStopMonitoring } from "./prim-siri-stop-monitoring.js";
import { createPrimTrafficReports } from "./prim-traffic-reports.js";

const TIMEOUT_MS = 50_000;

describe("PRIM token header", () => {
  it("uses a Fetch-legal header name that PRIM accepts", () => {
    const init = primFetchInit("test-key");
    expect(() => new Headers(init.headers)).not.toThrow();
    const headers = new Headers(init.headers);
    expect(headers.get("apiKey")).toBe("test-key");
  });
});

describe("PRIM fetch timeout option", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults AbortSignal.timeout to 50 seconds", () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    primFetchInit("test-key");
    expect(timeout).toHaveBeenCalledWith(50_000);
  });

  it("uses the injected timeout", () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    primFetchInit("test-key", 12_000);
    expect(timeout).toHaveBeenCalledWith(12_000);
  });

  it("aborts Navitia lookup with an injected timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const lookup = createPrimNavitiaLookup({
      apiKey: "test-key",
      timeoutMs: 12_000,
      fetch: async () => okJson({ pt_objects: [] }),
    });
    await lookup.searchLines("RER B");
    expect(timeout).toHaveBeenCalledWith(12_000);
  });
});

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("PRIM fetch timeouts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts Navitia lookup after about 50 seconds", async () => {
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

  it("aborts SIRI stop-monitoring after about 50 seconds", async () => {
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

  it("aborts traffic_reports after about 50 seconds", async () => {
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

  it("aborts journeys after about 50 seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    let signal: AbortSignal | undefined;
    const itineraires = createPrimItineraire({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return okJson({ journeys: [] });
      },
    });

    await itineraires.plan({
      depart: {
        id: "2.37;48.84",
        label: "2.37;48.84",
        genre: "coordonnees",
      },
      arrivee: {
        id: "2.29;48.85",
        label: "2.29;48.85",
        genre: "coordonnees",
      },
      horaire: new Date("2026-10-29T18:00:00+01:00"),
      sens: "depart",
      count: 1,
    });

    expect(timeout).toHaveBeenCalledWith(TIMEOUT_MS);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
