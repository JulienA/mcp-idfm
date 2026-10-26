import { describe, expect, it } from "vitest";
import {
  createApplication,
  SnapshotUnavailableError,
} from "./application/index.js";
import { createPrimTrafficReports } from "./infra/prim-traffic-reports.js";
import type {
  Clock,
  InfoTraficMessage,
  Ligne,
  NavitiaLookup,
} from "./application/index.js";

const RER_B: Ligne = {
  id: "C01742",
  label: "RER B",
  mode: "RER",
  siri_line_ref: "STIF:Line::C01742:",
  navitia_id: "line:IDFM:C01742",
};

const METRO_1: Ligne = {
  id: "C01373",
  label: "Métro 1",
  mode: "Métro",
  siri_line_ref: "STIF:Line::C01373:",
  navitia_id: "line:IDFM:C01373",
};

const BUS_1: Ligne = {
  id: "C01193",
  label: "Bus 1",
  mode: "Bus",
  siri_line_ref: "STIF:Line::C01193:",
  navitia_id: "line:IDFM:C01193",
};

const METRO_1_BLOCKING: InfoTraficMessage = {
  title: "Ligne interrompue",
  text: "Aucune circulation sur l'ensemble de la ligne.",
  severite: "bloquant",
  cause: "incident",
  application_periods: [
    {
      begin: "2026-10-26T08:00:00+01:00",
      end: "2026-10-26T12:00:00+01:00",
    },
  ],
  impacted_lignes: [{ id: "C01373", label: "Métro 1" }],
  impacted_stops: [],
  ligne_ids: ["C01373"],
};

const BUS_1_INFO: InfoTraficMessage = {
  title: "Déviation",
  text: "Arrêt non desservi.",
  severite: "information",
  cause: "travaux",
  application_periods: [
    {
      begin: "2026-10-26T07:00:00+01:00",
      end: "2026-10-26T20:00:00+01:00",
    },
  ],
  impacted_lignes: [{ id: "C01193", label: "Bus 1" }],
  impacted_stops: [{ id: "412345", label: "Nation" }],
  ligne_ids: ["C01193"],
};

const RER_B_WORKS: InfoTraficMessage = {
  title: "Travaux de nuit",
  text: "Interruption entre Gare du Nord et Châtelet.",
  severite: "perturbé",
  cause: "travaux",
  application_periods: [
    {
      begin: "2026-10-26T22:00:00+01:00",
      end: "2026-10-27T05:00:00+01:00",
    },
  ],
  impacted_lignes: [{ id: "C01742", label: "RER B" }],
  impacted_stops: [
    { id: "73626", label: "Gare du Nord" },
    { id: "73641", label: "Châtelet-Les Halles" },
  ],
  ligne_ids: ["C01742"],
};

function fakeLookup(lines: Ligne[]): NavitiaLookup {
  return {
    async searchLines(query) {
      const q = query.trim().toLowerCase();
      return lines.filter(
        (ligne) =>
          ligne.id.toLowerCase() === q ||
          ligne.label.toLowerCase().includes(q),
      );
    },
    async searchStops() {
      return [];
    },
  };
}

function clockAt(iso: string): Clock & { set(next: string): void } {
  let now = new Date(iso);
  return {
    now: () => now,
    set(next) {
      now = new Date(next);
    },
  };
}

function numberedBusLignes(count: number): Ligne[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `C1000${index}`;
    return {
      id,
      label: `Bus ${10 + index}`,
      mode: "Bus",
      siri_line_ref: `STIF:Line::${id}:`,
      navitia_id: `line:IDFM:${id}`,
    };
  });
}

describe("get_info_trafic", () => {
  it("does not dump the network when the Ligne query is missing", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B, METRO_1]),
      snapshot: {
        fetch: async () => [RER_B_WORKS],
      },
    });
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("  ");

    expect(result).toEqual({
      status: "not_found",
      message: "Aucune Ligne correspondante",
      source: "Île-de-France Mobilités",
    });
  });

  it("returns trafic normal when the Ligne has no messages", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: {
        fetch: async () => [],
      },
      clock: clockAt("2026-10-26T10:00:00.000Z"),
    });
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("RER B");

    expect(result).toEqual({
      status: "ok",
      messages: [],
      summary: "Aucune perturbation",
      updated_at: "2026-10-26T11:00:00+01:00",
      stale: false,
      source: "Île-de-France Mobilités",
    });
  });

  it("uses the titre channel as the Info Trafic title, not severity name", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: createPrimTrafficReports({
        apiKey: "test-key",
        fetch: async () =>
          new Response(
            JSON.stringify({
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
            }),
            { status: 200 },
          ),
      }),
      clock: clockAt("2026-10-26T10:00:00.000Z"),
    });
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("RER B");

    expect(result).toMatchObject({
      status: "ok",
      messages: [
        {
          title: "Travaux de nuit",
          text: "Interruption entre Gare du Nord et Châtelet.",
        },
      ],
    });
  });

  it("returns Info Trafic messages for the resolved Ligne", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B, METRO_1]),
      snapshot: {
        fetch: async () => [RER_B_WORKS, METRO_1_BLOCKING],
      },
      clock: clockAt("2026-10-26T10:00:00.000Z"),
    });
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("RER B");

    expect(result).toEqual({
      status: "ok",
      messages: [
        {
          title: "Travaux de nuit",
          text: "Interruption entre Gare du Nord et Châtelet.",
          severite: "perturbé",
          cause: "travaux",
          application_periods: [
            {
              begin: "2026-10-26T22:00:00+01:00",
              end: "2026-10-27T05:00:00+01:00",
            },
          ],
          impacted_lignes: [{ id: "C01742", label: "RER B" }],
          impacted_stops: [
            { id: "73626", label: "Gare du Nord" },
            { id: "73641", label: "Châtelet-Les Halles" },
          ],
        },
      ],
      updated_at: "2026-10-26T11:00:00+01:00",
      stale: false,
      source: "Île-de-France Mobilités",
    });
  });

  it("returns a stop-only Info Trafic message for the Ligne in that report", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: createPrimTrafficReports({
        apiKey: "test-key",
        fetch: async () =>
          new Response(
            JSON.stringify({
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
            }),
            { status: 200 },
          ),
      }),
      clock: clockAt("2026-10-26T10:00:00.000Z"),
    });
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("RER B");

    expect(result).toEqual({
      status: "ok",
      messages: [
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
        },
      ],
      updated_at: "2026-10-26T11:00:00+01:00",
      stale: false,
      source: "Île-de-France Mobilités",
    });
  });

  it("returns stop-level messages for the Ligne", async () => {
    const closedStation: InfoTraficMessage = {
      title: "Gare du Nord fermée",
      text: "Station inaccessible.",
      severite: "bloquant",
      cause: "incident",
      application_periods: [
        {
          begin: "2026-10-26T09:00:00+01:00",
          end: "2026-10-26T18:00:00+01:00",
        },
      ],
      impacted_lignes: [],
      impacted_stops: [{ id: "73626", label: "Gare du Nord" }],
      ligne_ids: ["C01742"],
    };
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: {
        fetch: async () => [closedStation],
      },
      clock: clockAt("2026-10-26T10:00:00.000Z"),
    });
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("RER B");

    expect(result).toEqual({
      status: "ok",
      messages: [
        {
          title: "Gare du Nord fermée",
          text: "Station inaccessible.",
          severite: "bloquant",
          cause: "incident",
          application_periods: [
            {
              begin: "2026-10-26T09:00:00+01:00",
              end: "2026-10-26T18:00:00+01:00",
            },
          ],
          impacted_lignes: [],
          impacted_stops: [{ id: "73626", label: "Gare du Nord" }],
        },
      ],
      updated_at: "2026-10-26T11:00:00+01:00",
      stale: false,
      source: "Île-de-France Mobilités",
    });
  });

  it("returns not found when no Ligne matches", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: {
        fetch: async () => [RER_B_WORKS],
      },
    });
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("Ligne inexistante");

    expect(result).toEqual({
      status: "not_found",
      message: "Aucune Ligne correspondante",
      source: "Île-de-France Mobilités",
    });
  });

  it("returns the Ligne Info Trafic when queried by canonical id", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: {
        fetch: async () => [RER_B_WORKS],
      },
      clock: clockAt("2026-10-26T10:00:00.000Z"),
    });
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("C01742");

    expect(result).toMatchObject({
      status: "ok",
      messages: [{ title: "Travaux de nuit" }],
    });
  });

  it("returns the Ligne Info Trafic when queried by Navitia id", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: {
        fetch: async () => [RER_B_WORKS],
      },
      clock: clockAt("2026-10-26T10:00:00.000Z"),
    });
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("line:IDFM:C01742");

    expect(result).toMatchObject({
      status: "ok",
      messages: [{ title: "Travaux de nuit" }],
    });
  });

  it("returns the Ligne Info Trafic when queried by SIRI LineRef", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: {
        fetch: async () => [RER_B_WORKS],
      },
      clock: clockAt("2026-10-26T10:00:00.000Z"),
    });
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("STIF:Line::C01742:");

    expect(result).toMatchObject({
      status: "ok",
      messages: [{ title: "Travaux de nuit" }],
    });
  });

  it("returns the union of Info Trafic when two Lignes match", async () => {
    const app = createApplication({
      lookup: fakeLookup([METRO_1, BUS_1]),
      snapshot: {
        fetch: async () => [METRO_1_BLOCKING, BUS_1_INFO, RER_B_WORKS],
      },
      clock: clockAt("2026-10-26T10:00:00.000Z"),
    });
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("1");

    expect(result).toEqual({
      status: "ok",
      messages: [
        {
          title: "Ligne interrompue",
          text: "Aucune circulation sur l'ensemble de la ligne.",
          severite: "bloquant",
          cause: "incident",
          application_periods: [
            {
              begin: "2026-10-26T08:00:00+01:00",
              end: "2026-10-26T12:00:00+01:00",
            },
          ],
          impacted_lignes: [{ id: "C01373", label: "Métro 1" }],
          impacted_stops: [],
        },
        {
          title: "Déviation",
          text: "Arrêt non desservi.",
          severite: "information",
          cause: "travaux",
          application_periods: [
            {
              begin: "2026-10-26T07:00:00+01:00",
              end: "2026-10-26T20:00:00+01:00",
            },
          ],
          impacted_lignes: [{ id: "C01193", label: "Bus 1" }],
          impacted_stops: [{ id: "412345", label: "Nation" }],
        },
      ],
      updated_at: "2026-10-26T11:00:00+01:00",
      stale: false,
      source: "Île-de-France Mobilités",
    });
  });

  it("asks for clarification when more than five Lignes match", async () => {
    const fiches = numberedBusLignes(6);
    const app = createApplication({
      lookup: fakeLookup(fiches),
      snapshot: {
        fetch: async () => [RER_B_WORKS],
      },
    });
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("Bus");

    expect(result).toEqual({
      status: "needs_clarification",
      candidates: fiches.map(({ id, label, mode }) => ({ id, label, mode })),
      source: "Île-de-France Mobilités",
    });
  });

  it("fails when PRIM is down and there is no snapshot", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: {
        fetch: async () => {
          throw new Error("PRIM down");
        },
      },
    });
    await app.refreshSnapshot();

    await expect(app.getInfoTrafic("RER B")).rejects.toBeInstanceOf(
      SnapshotUnavailableError,
    );
  });

  it("answers from the last snapshot with stale true when a refresh fails", async () => {
    let fail = false;
    const clock = clockAt("2026-10-26T10:00:00.000Z");
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: {
        fetch: async () => {
          if (fail) {
            throw new Error("PRIM down");
          }
          return [RER_B_WORKS];
        },
      },
      clock,
    });
    await app.refreshSnapshot();
    fail = true;
    clock.set("2026-10-26T10:02:00.000Z");
    await app.refreshSnapshot();

    const result = await app.getInfoTrafic("RER B");

    expect(result).toEqual({
      status: "ok",
      messages: [
        {
          title: "Travaux de nuit",
          text: "Interruption entre Gare du Nord et Châtelet.",
          severite: "perturbé",
          cause: "travaux",
          application_periods: [
            {
              begin: "2026-10-26T22:00:00+01:00",
              end: "2026-10-27T05:00:00+01:00",
            },
          ],
          impacted_lignes: [{ id: "C01742", label: "RER B" }],
          impacted_stops: [
            { id: "73626", label: "Gare du Nord" },
            { id: "73641", label: "Châtelet-Les Halles" },
          ],
        },
      ],
      updated_at: "2026-10-26T11:00:00+01:00",
      stale: true,
      source: "Île-de-France Mobilités",
    });
  });
});

describe("health", () => {
  it("reflects the Info Trafic snapshot after a successful refresh", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: {
        fetch: async () => [RER_B_WORKS],
      },
      clock: clockAt("2026-10-26T10:00:00.000Z"),
    });
    await app.refreshSnapshot();

    expect(app.getHealth()).toEqual({
      ok: true,
      trafic_updated_at: "2026-10-26T11:00:00+01:00",
      stale: false,
    });
  });

  it("reflects stale after a failed refresh", async () => {
    let fail = false;
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: {
        fetch: async () => {
          if (fail) {
            throw new Error("PRIM down");
          }
          return [RER_B_WORKS];
        },
      },
      clock: clockAt("2026-10-26T10:00:00.000Z"),
    });
    await app.refreshSnapshot();
    fail = true;
    await app.refreshSnapshot();

    expect(app.getHealth()).toEqual({
      ok: true,
      trafic_updated_at: "2026-10-26T11:00:00+01:00",
      stale: true,
    });
  });

  it("clears stale after a later successful refresh", async () => {
    let fail = false;
    const clock = clockAt("2026-10-26T10:00:00.000Z");
    const app = createApplication({
      lookup: fakeLookup([RER_B]),
      snapshot: {
        fetch: async () => {
          if (fail) {
            throw new Error("PRIM down");
          }
          return [RER_B_WORKS];
        },
      },
      clock,
    });
    await app.refreshSnapshot();
    fail = true;
    await app.refreshSnapshot();
    fail = false;
    clock.set("2026-10-26T10:02:00.000Z");
    await app.refreshSnapshot();

    expect(app.getHealth()).toEqual({
      ok: true,
      trafic_updated_at: "2026-10-26T11:02:00+01:00",
      stale: false,
    });
  });
});
