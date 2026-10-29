import { describe, expect, it } from "vitest";
import { createPrimZoneCorrespondanceLookup } from "./prim-zone-correspondance.js";

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

describe("createPrimZoneCorrespondanceLookup", () => {
  it("resolves a Zone de correspondance by name", async () => {
    const urls: string[] = [];
    const lookup = createPrimZoneCorrespondanceLookup({
      fetch: async (url) => {
        const href = hrefOf(url);
        urls.push(href);
        return jsonResponse({
          total_count: 1,
          results: [
            {
              zdcid: "71264",
              zdcname: "Châtelet",
              zdctown: "Paris 4e",
              zdctype: "metroStation",
            },
          ],
        });
      },
    });

    await expect(lookup.search("Châtelet")).resolves.toEqual([
      {
        id: "71264",
        label: "Châtelet",
        mode: "Métro",
        siri_monitoring_ref: "STIF:StopArea:SP:71264:",
      },
    ]);
    expect(urls).toEqual([
      "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/zones-de-correspondance/records?where=zdcname+like+%22%25Ch%C3%A2telet%25%22&select=zdcid%2Czdcname%2Czdctype&limit=100",
    ]);
  });

  it("resolves a Zone de correspondance by its own id", async () => {
    const urls: string[] = [];
    const lookup = createPrimZoneCorrespondanceLookup({
      fetch: async (url) => {
        urls.push(hrefOf(url));
        return jsonResponse({
          total_count: 1,
          results: [
            {
              zdcid: "474151",
              zdcname: "Châtelet - Les Halles",
              zdctown: "Paris 1er",
              zdctype: "railStation",
            },
          ],
        });
      },
    });

    await expect(lookup.search("474151")).resolves.toEqual([
      {
        id: "474151",
        label: "Châtelet - Les Halles",
        mode: "Ferroviaire",
        siri_monitoring_ref: "STIF:StopArea:SP:474151:",
      },
    ]);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("zones-de-correspondance");
    expect(urls[0]).toContain("zdcid");
  });

  it("rolls a Zone d'arrêt id up to its Zone de correspondance", async () => {
    const lookup = createPrimZoneCorrespondanceLookup({
      fetch: async (url) => {
        const href = hrefOf(url);
        if (href.includes("relations")) {
          return jsonResponse({
            total_count: 10,
            results: [{ zdcid: "71264", zdaid: "42587" }],
          });
        }
        const where = new URL(href).searchParams.get("where") ?? "";
        if (where.includes("42587")) {
          return jsonResponse({ total_count: 0, results: [] });
        }
        return jsonResponse({
          total_count: 1,
          results: [
            {
              zdcid: "71264",
              zdcname: "Châtelet",
              zdctown: "Paris 4e",
              zdctype: "metroStation",
            },
          ],
        });
      },
    });

    await expect(lookup.search("42587")).resolves.toEqual([
      {
        id: "71264",
        label: "Châtelet",
        mode: "Métro",
        siri_monitoring_ref: "STIF:StopArea:SP:71264:",
      },
    ]);
  });

  it("returns no Zone de correspondance when the id is unknown", async () => {
    const lookup = createPrimZoneCorrespondanceLookup({
      fetch: async () => jsonResponse({ total_count: 0, results: [] }),
    });

    await expect(lookup.search("00000")).resolves.toEqual([]);
  });

  it("returns every matching Zone de correspondance across pages", async () => {
    const lookup = createPrimZoneCorrespondanceLookup({
      fetch: async (url) => {
        const offset = new URL(hrefOf(url)).searchParams.get("offset");
        if (!offset) {
          return jsonResponse({
            total_count: 101,
            results: Array.from({ length: 100 }, (_, index) => ({
              zdcid: String(1000 + index),
              zdcname: `Nation ${index}`,
              zdctown: "Paris",
              zdctype: "onstreetBus",
            })),
          });
        }
        return jsonResponse({
          total_count: 101,
          results: [
            {
              zdcid: "71673",
              zdcname: "Nation",
              zdctown: "Paris 11e",
              zdctype: "railStation",
            },
          ],
        });
      },
    });

    const matches = await lookup.search("Nation");
    expect(matches).toHaveLength(101);
    expect(matches[100]).toEqual({
      id: "71673",
      label: "Nation",
      mode: "Ferroviaire",
      siri_monitoring_ref: "STIF:StopArea:SP:71673:",
    });
  });

  it("keeps paging when the référentiel omits total_count", async () => {
    const lookup = createPrimZoneCorrespondanceLookup({
      fetch: async (url) => {
        const offset = new URL(hrefOf(url)).searchParams.get("offset");
        if (!offset) {
          return jsonResponse({
            results: Array.from({ length: 100 }, (_, index) => ({
              zdcid: String(1000 + index),
              zdcname: `Nation ${index}`,
              zdctype: "onstreetBus",
            })),
          });
        }
        return jsonResponse({
          results: [
            {
              zdcid: "71673",
              zdcname: "Nation",
              zdctype: "railStation",
            },
          ],
        });
      },
    });

    const matches = await lookup.search("Nation");
    expect(matches).toHaveLength(101);
    expect(matches[100]?.id).toBe("71673");
  });
});
