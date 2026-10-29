import { describe, expect, it } from "vitest";
import { createPrimTrafficReports } from "./prim-traffic-reports.js";

function adapterFor(body: unknown) {
  return createPrimTrafficReports({
    apiKey: "test-key",
    fetch: async () =>
      new Response(JSON.stringify(body), { status: 200 }),
  });
}

describe("createPrimTrafficReports", () => {
  it("uses the titre channel as the Info Trafic title, not severity name", async () => {
    const adapter = adapterFor({
      disruptions: [
        {
          id: "disruption-travaux",
          status: "active",
          cause: "travaux",
          severity: { name: "perturbé", effect: "SIGNIFICANT_DELAYS" },
          messages: [
            {
              text: "Travaux de nuit",
              channel: { name: "titre" },
            },
            {
              text: "Interruption entre Gare du Nord et Châtelet.",
              channel: { name: "web" },
            },
          ],
          application_periods: [
            { begin: "20261026T220000", end: "20261027T050000" },
          ],
        },
      ],
      traffic_reports: [
        {
          lines: [
            {
              id: "line:IDFM:C01742",
              name: "RER B",
              links: [
                {
                  id: "disruption-travaux",
                  type: "disruption",
                },
              ],
            },
          ],
        },
      ],
    });

    const messages = await adapter.fetch();
    expect(messages).toMatchObject([
      {
        title: "Travaux de nuit",
        text: "Interruption entre Gare du Nord et Châtelet.",
      },
    ]);
  });

  it("returns a stop-only Info Trafic message for the Ligne in that report", async () => {
    const adapter = adapterFor({
      disruptions: [
        {
          id: "disruption-station-closed",
          status: "active",
          cause: "incident",
          severity: { name: "Bloquant", effect: "NO_SERVICE" },
          messages: [{ text: "Station inaccessible." }],
          application_periods: [
            { begin: "20261026T090000", end: "20261026T180000" },
          ],
          impacted_objects: [
            {
              pt_object: {
                embedded_type: "stop_area",
                id: "stop_area:IDFM:73626",
                name: "Gare du Nord",
                stop_area: {
                  id: "stop_area:IDFM:73626",
                  name: "Gare du Nord",
                },
              },
            },
          ],
        },
      ],
      traffic_reports: [
        {
          lines: [
            {
              id: "line:IDFM:C01742",
              name: "RER B",
              links: [],
            },
          ],
          stop_areas: [
            {
              id: "stop_area:IDFM:73626",
              name: "Gare du Nord",
              links: [
                {
                  id: "disruption-station-closed",
                  rel: "disruptions",
                  type: "disruption",
                },
              ],
            },
          ],
        },
      ],
    });

    const messages = await adapter.fetch();
    expect(messages).toEqual([
      {
        title: "Info Trafic",
        text: "Station inaccessible.",
        severite: "bloquant",
        cause: "incident",
        application_periods: [
          {
            begin: "2026-10-26T09:00:00+01:00",
            end: "2026-10-26T18:00:00+01:00",
          },
        ],
        impacted_lignes: [{ id: "C01742", label: "RER B" }],
        impacted_stops: [{ id: "73626", label: "Gare du Nord" }],
        ligne_ids: ["C01742"],
      },
    ]);
  });

  it("does not attach a stop-only disruption to sibling Lignes in the same report", async () => {
    const adapter = adapterFor({
      disruptions: [
        {
          id: "disruption-station-closed",
          status: "active",
          cause: "incident",
          severity: { name: "Bloquant", effect: "NO_SERVICE" },
          messages: [{ text: "Station inaccessible." }],
          application_periods: [
            { begin: "20261026T090000", end: "20261026T180000" },
          ],
          impacted_objects: [
            {
              pt_object: {
                embedded_type: "stop_area",
                id: "stop_area:IDFM:73626",
                name: "Gare du Nord",
                stop_area: {
                  id: "stop_area:IDFM:73626",
                  name: "Gare du Nord",
                },
              },
            },
          ],
        },
      ],
      traffic_reports: [
        {
          lines: [
            {
              id: "line:IDFM:C01742",
              name: "RER B",
              links: [],
            },
            {
              id: "line:IDFM:C01193",
              name: "Bus 1",
              links: [],
            },
          ],
          stop_areas: [
            {
              id: "stop_area:IDFM:73626",
              name: "Gare du Nord",
              links: [
                {
                  id: "disruption-station-closed",
                  rel: "disruptions",
                  type: "disruption",
                },
              ],
            },
          ],
        },
      ],
    });

    const messages = await adapter.fetch();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ligne_ids ?? []).not.toContain("C01193");
    expect(
      messages[0]?.impacted_lignes.map((ligne) => ligne.id) ?? [],
    ).not.toContain("C01193");
  });

  it("associates a stop-only disruption with lines listed on the stop object", async () => {
    const adapter = adapterFor({
      disruptions: [
        {
          id: "disruption-station-closed",
          status: "active",
          cause: "incident",
          severity: { name: "Bloquant", effect: "NO_SERVICE" },
          messages: [{ text: "Station inaccessible." }],
          application_periods: [
            { begin: "20261026T090000", end: "20261026T180000" },
          ],
          impacted_objects: [
            {
              pt_object: {
                embedded_type: "stop_area",
                id: "stop_area:IDFM:73626",
                name: "Gare du Nord",
                stop_area: {
                  id: "stop_area:IDFM:73626",
                  name: "Gare du Nord",
                },
              },
            },
          ],
        },
      ],
      traffic_reports: [
        {
          lines: [
            {
              id: "line:IDFM:C01742",
              name: "RER B",
              links: [],
            },
            {
              id: "line:IDFM:C01193",
              name: "Bus 1",
              links: [],
            },
          ],
          stop_areas: [
            {
              id: "stop_area:IDFM:73626",
              name: "Gare du Nord",
              links: [
                {
                  id: "disruption-station-closed",
                  rel: "disruptions",
                  type: "disruption",
                },
              ],
              lines: [
                {
                  id: "line:IDFM:C01742",
                  name: "RER B",
                },
              ],
            },
          ],
        },
      ],
    });

    const messages = await adapter.fetch();
    expect(messages).toEqual([
      {
        title: "Info Trafic",
        text: "Station inaccessible.",
        severite: "bloquant",
        cause: "incident",
        application_periods: [
          {
            begin: "2026-10-26T09:00:00+01:00",
            end: "2026-10-26T18:00:00+01:00",
          },
        ],
        impacted_lignes: [{ id: "C01742", label: "RER B" }],
        impacted_stops: [{ id: "73626", label: "Gare du Nord" }],
        ligne_ids: ["C01742"],
      },
    ]);
  });
});
