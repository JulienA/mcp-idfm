import { describe, expect, it } from "vitest";
import { createPrimNavitiaLookup } from "./prim-navitia-lookup.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function hrefOf(url: URL | RequestInfo | string): string {
  if (typeof url === "string") {
    return url;
  }
  if (url instanceof URL) {
    return url.href;
  }
  return String(url);
}

describe("createPrimNavitiaLookup", () => {
  it("resolves a Zone d'arrêt by canonical id when /places search is empty", async () => {
    const lookup = createPrimNavitiaLookup({
      apiKey: "test-key",
      fetch: async (url) => {
        const href = hrefOf(url);
        const path = decodeURIComponent(new URL(href).pathname);
        if (path.endsWith("/places/stop_area:IDFM:68916")) {
          return jsonResponse({
            places: [
              {
                embedded_type: "stop_area",
                stop_area: {
                  id: "stop_area:IDFM:68916",
                  name: "Villeparisis - Mitry-le-Neuf",
                },
              },
            ],
          });
        }
        if (path.endsWith("/places")) {
          return jsonResponse({ places: [] });
        }
        return jsonResponse({ message: `unexpected ${href}` }, 500);
      },
    });

    await expect(lookup.searchStops("68916")).resolves.toEqual([
      {
        id: "68916",
        label: "Villeparisis - Mitry-le-Neuf",
        mode: "",
        siri_monitoring_ref: "STIF:StopArea:SP:68916:",
        navitia_id: "stop_area:IDFM:68916",
      },
    ]);
  });

  it("returns no Zone d'arrêt when the canonical id does not exist", async () => {
    const lookup = createPrimNavitiaLookup({
      apiKey: "test-key",
      fetch: async (url) => {
        const path = decodeURIComponent(new URL(hrefOf(url)).pathname);
        if (path.endsWith("/places/stop_area:IDFM:00000")) {
          return jsonResponse(
            { error: { message: "The object stop_area:IDFM:00000 doesn't exist" } },
            404,
          );
        }
        return jsonResponse({ message: `unexpected ${hrefOf(url)}` }, 500);
      },
    });

    await expect(lookup.searchStops("00000")).resolves.toEqual([]);
  });

  it("resolves a Ligne by canonical id when /pt_objects search is empty", async () => {
    const lookup = createPrimNavitiaLookup({
      apiKey: "test-key",
      fetch: async (url) => {
        const href = hrefOf(url);
        const path = decodeURIComponent(new URL(href).pathname);
        if (path.endsWith("/lines/line:IDFM:C01743")) {
          return jsonResponse({
            lines: [
              {
                id: "line:IDFM:C01743",
                name: "B",
                code: "B",
                commercial_mode: { name: "RER" },
              },
            ],
          });
        }
        if (path.endsWith("/pt_objects")) {
          return jsonResponse({});
        }
        return jsonResponse({ message: `unexpected ${href}` }, 500);
      },
    });

    await expect(lookup.searchLines("C01743")).resolves.toEqual([
      {
        id: "C01743",
        label: "B",
        mode: "RER",
        siri_line_ref: "STIF:Line::C01743:",
        navitia_id: "line:IDFM:C01743",
      },
    ]);
  });

  it("returns no Ligne when the canonical id does not exist", async () => {
    const lookup = createPrimNavitiaLookup({
      apiKey: "test-key",
      fetch: async (url) => {
        const path = decodeURIComponent(new URL(hrefOf(url)).pathname);
        if (path.endsWith("/lines/line:IDFM:C99999")) {
          return jsonResponse(
            { error: { message: "ptref : Filters: Unable to find object" } },
            404,
          );
        }
        return jsonResponse({ message: `unexpected ${hrefOf(url)}` }, 500);
      },
    });

    await expect(lookup.searchLines("C99999")).resolves.toEqual([]);
  });

  it("returns every matching Ligne across Navitia pages", async () => {
    const lookup = createPrimNavitiaLookup({
      apiKey: "test-key",
      fetch: async (url) => {
        const parsed = new URL(hrefOf(url));
        if (!parsed.pathname.endsWith("/pt_objects")) {
          return jsonResponse({ message: `unexpected ${hrefOf(url)}` }, 500);
        }
        if (parsed.searchParams.get("count") !== "1000") {
          return jsonResponse({ message: "expected count=1000" }, 500);
        }
        const startPage = parsed.searchParams.get("start_page") ?? "0";
        if (startPage === "0") {
          return jsonResponse({
            pagination: { items_per_page: 1000, total_result: 1001 },
            pt_objects: [
              {
                embedded_type: "line",
                line: {
                  id: "line:IDFM:C10001",
                  name: "Bus 10",
                  commercial_mode: { name: "Bus" },
                },
              },
            ],
          });
        }
        if (startPage === "1") {
          return jsonResponse({
            pagination: { items_per_page: 1000, total_result: 1001 },
            pt_objects: [
              {
                embedded_type: "line",
                line: {
                  id: "line:IDFM:C10002",
                  name: "Bus 11",
                  commercial_mode: { name: "Bus" },
                },
              },
            ],
          });
        }
        return jsonResponse({ message: `unexpected page ${startPage}` }, 500);
      },
    });

    await expect(lookup.searchLines("Bus")).resolves.toEqual([
      {
        id: "C10001",
        label: "Bus 10",
        mode: "Bus",
        siri_line_ref: "STIF:Line::C10001:",
        navitia_id: "line:IDFM:C10001",
      },
      {
        id: "C10002",
        label: "Bus 11",
        mode: "Bus",
        siri_line_ref: "STIF:Line::C10002:",
        navitia_id: "line:IDFM:C10002",
      },
    ]);
  });

  it("returns every matching Zone d'arrêt across Navitia pages", async () => {
    const lookup = createPrimNavitiaLookup({
      apiKey: "test-key",
      fetch: async (url) => {
        const parsed = new URL(hrefOf(url));
        if (!parsed.pathname.endsWith("/places")) {
          return jsonResponse({ message: `unexpected ${hrefOf(url)}` }, 500);
        }
        if (parsed.searchParams.get("count") !== "200") {
          return jsonResponse({ message: "expected count=200" }, 500);
        }
        const startPage = parsed.searchParams.get("start_page") ?? "0";
        if (startPage === "0") {
          return jsonResponse({
            pagination: { items_per_page: 200, total_result: 250 },
            places: [
              {
                embedded_type: "stop_area",
                stop_area: {
                  id: "stop_area:IDFM:70001",
                  name: "Nation Métro",
                  physical_modes: [{ name: "Métro" }],
                },
              },
            ],
          });
        }
        if (startPage === "1") {
          return jsonResponse({
            pagination: { items_per_page: 200, total_result: 250 },
            places: [
              {
                embedded_type: "stop_area",
                stop_area: {
                  id: "stop_area:IDFM:70002",
                  name: "Nation RER",
                  physical_modes: [{ name: "RER" }],
                },
              },
            ],
          });
        }
        return jsonResponse({ message: `unexpected page ${startPage}` }, 500);
      },
    });

    await expect(lookup.searchStops("Nation")).resolves.toEqual([
      {
        id: "70001",
        label: "Nation Métro",
        mode: "Métro",
        siri_monitoring_ref: "STIF:StopArea:SP:70001:",
        navitia_id: "stop_area:IDFM:70001",
      },
      {
        id: "70002",
        label: "Nation RER",
        mode: "RER",
        siri_monitoring_ref: "STIF:StopArea:SP:70002:",
        navitia_id: "stop_area:IDFM:70002",
      },
    ]);
  });
});
