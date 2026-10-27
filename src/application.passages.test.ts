import { describe, expect, it } from "vitest";
import {
  createApplication,
  LookupUnavailableError,
} from "./application/index.js";
import type {
  Clock,
  CorrespondanceLookup,
  Ligne,
  NavitiaLookup,
  ProchainPassage,
  StopMonitoring,
  ZoneDeCorrespondance,
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

const CHATELET_PARIS: ZoneDeCorrespondance = {
  id: "71264",
  label: "Châtelet (Paris 4e)",
  mode: "Métro",
  siri_monitoring_ref: "STIF:StopArea:SP:71264:",
};

const CHATELET_LES_HALLES: ZoneDeCorrespondance = {
  id: "474151",
  label: "Châtelet - Les Halles (Paris 1er)",
  mode: "Ferroviaire",
  siri_monitoring_ref: "STIF:StopArea:SP:474151:",
};

function numberedZones(count: number): ZoneDeCorrespondance[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `9000${index}`;
    return {
      id,
      label: `Nation ${index}`,
      mode: "Bus",
      siri_monitoring_ref: `STIF:StopArea:SP:${id}:`,
    };
  });
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

function fakeCorrespondances(
  zones: ZoneDeCorrespondance[],
): CorrespondanceLookup {
  return {
    async search(query) {
      const q = query.trim().toLowerCase();
      return zones.filter(
        (zone) =>
          zone.id.toLowerCase() === q || zone.label.toLowerCase().includes(q),
      );
    },
  };
}

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

function fakeStopMonitoring(
  passagesByRef: Record<string, ProchainPassage[]>,
): StopMonitoring {
  return {
    async getPassages(monitoringRef) {
      return passagesByRef[monitoringRef] ?? [];
    },
  };
}

function passagesApp(
  deps: Parameters<typeof createApplication>[0],
) {
  return createApplication({
    clock: clockAt("2026-07-01T10:00:00.000Z"),
    ...deps,
  });
}

describe("prochain_passage", () => {
  it("returns live Prochains Passages for a unique Zone de correspondance", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": [
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date("2026-07-01T10:04:00.000Z"),
            statut: "onTime",
          },
        ],
      }),
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Robinson",
          passages: [
            {
              expected_at: "2026-07-01T12:04:00+02:00",
              statut: "onTime",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("states the absence of realtime instead of falling back to a schedule", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": [],
      }),
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [],
      summary: "Pas de temps réel",
      source: "Île-de-France Mobilités",
    });
  });

  it("returns an error when SIRI fails with no usable payload", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: {
        async getPassages() {
          throw new Error("PRIM SIRI unavailable");
        },
      },
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "error",
      message: "Impossible de récupérer les Prochains Passages",
      source: "Île-de-France Mobilités",
    });
  });

  it("filters Prochains Passages by an optional Ligne after resolution", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B, METRO_1]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": [
          {
            ligneId: "C01373",
            ligneLabel: "Métro 1",
            destination: "La Défense",
            expectedAt: new Date("2026-07-01T10:03:00.000Z"),
            statut: "onTime",
          },
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date("2026-07-01T10:04:00.000Z"),
            statut: "delayed",
          },
        ],
      }),
    });

    const result = await app.prochainPassage("Châtelet - Les Halles", "RER B");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Robinson",
          passages: [
            {
              expected_at: "2026-07-01T12:04:00+02:00",
              statut: "delayed",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("returns at most five Prochains Passages per Ligne and destination", async () => {
    const live = [1, 2, 3, 4, 5, 6].map((minute) => ({
      ligneId: "C01742",
      ligneLabel: "RER B",
      destination: "Robinson",
      expectedAt: new Date(`2026-07-01T10:0${minute}:00.000Z`),
      statut: "onTime",
    }));
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": live,
      }),
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Robinson",
          passages: [1, 2, 3, 4, 5].map((minute) => ({
            expected_at: `2026-07-01T12:0${minute}:00+02:00`,
            statut: "onTime",
            zone_de_correspondance: {
              id: "474151",
              label: "Châtelet - Les Halles (Paris 1er)",
            },
          })),
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("keeps Prochains Passages of several destinations instead of five overall", async () => {
    const destinations = [
      "Robinson",
      "Aéroport Charles de Gaulle 2 TGV",
      "Saint-Rémy-lès-Chevreuse",
      "Mitry-Claye",
    ];
    const live = destinations.flatMap((destination, index) =>
      [0, 1].map((offset) => ({
        ligneId: "C01742",
        ligneLabel: "RER B",
        destination,
        expectedAt: new Date(
          `2026-07-01T10:0${index * 2 + offset + 1}:00.000Z`,
        ),
        statut: "onTime",
      })),
    );
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": live,
      }),
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: destinations.map((destination, index) => ({
        ligne: { id: "C01742", label: "RER B" },
        destination,
        passages: [0, 1].map((offset) => ({
          expected_at: `2026-07-01T12:0${index * 2 + offset + 1}:00+02:00`,
          statut: "onTime",
          zone_de_correspondance: {
            id: "474151",
            label: "Châtelet - Les Halles (Paris 1er)",
          },
        })),
      })),
      source: "Île-de-France Mobilités",
    });
  });

  it("drops already-passed Prochains Passages so later ones remain", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": [1, 2, 3, 4, 6, 7, 8].map((minute) => ({
          ligneId: "C01742",
          ligneLabel: "RER B",
          destination: "Robinson",
          expectedAt: new Date(`2026-07-01T10:0${minute}:00.000Z`),
          statut: "onTime",
        })),
      }),
      clock: clockAt("2026-07-01T10:05:00.000Z"),
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Robinson",
          passages: [6, 7, 8].map((minute) => ({
            expected_at: `2026-07-01T12:0${minute}:00+02:00`,
            statut: "onTime",
            zone_de_correspondance: {
              id: "474151",
              label: "Châtelet - Les Halles (Paris 1er)",
            },
          })),
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("does not let already-passed cancelled Prochains Passages hide later ones", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": [
          ...[1, 2, 3, 4].map((minute) => ({
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date(`2026-07-01T10:0${minute}:00.000Z`),
            statut: "cancelled",
          })),
          ...[6, 7, 8].map((minute) => ({
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date(`2026-07-01T10:0${minute}:00.000Z`),
            statut: "onTime",
          })),
        ],
      }),
      clock: clockAt("2026-07-01T10:05:00.000Z"),
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Robinson",
          passages: [
            ...[6, 7, 8].map((minute) => ({
              expected_at: `2026-07-01T12:0${minute}:00+02:00`,
              statut: "onTime",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            })),
            ...[1, 2].map((minute) => ({
              expected_at: `2026-07-01T12:0${minute}:00+02:00`,
              statut: "cancelled",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            })),
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("does not call an empty leftover of already-passed visits a coverage gap", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": [
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date("2026-07-01T10:01:00.000Z"),
            statut: "onTime",
          },
        ],
      }),
      clock: clockAt("2026-07-01T10:05:00.000Z"),
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [],
      source: "Île-de-France Mobilités",
    });
  });

  it("honours a configured per-destination Prochain Passage cap", async () => {
    const live = [1, 2, 3, 4].map((minute) => ({
      ligneId: "C01742",
      ligneLabel: "RER B",
      destination: "Robinson",
      expectedAt: new Date(`2026-07-01T10:0${minute}:00.000Z`),
      statut: "onTime",
    }));
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": live,
      }),
      maxPassagesPerGroup: 2,
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Robinson",
          passages: [1, 2].map((minute) => ({
            expected_at: `2026-07-01T12:0${minute}:00+02:00`,
            statut: "onTime",
            zone_de_correspondance: {
              id: "474151",
              label: "Châtelet - Les Halles (Paris 1er)",
            },
          })),
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("honours a configured overall Prochain Passage cap", async () => {
    const destinations = ["Robinson", "Mitry-Claye", "Saint-Rémy-lès-Chevreuse"];
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": destinations.map((destination, index) => ({
          ligneId: "C01742",
          ligneLabel: "RER B",
          destination,
          expectedAt: new Date(`2026-07-01T10:0${index + 1}:00.000Z`),
          statut: "onTime",
        })),
      }),
      maxPassages: 2,
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: destinations.slice(0, 2).map((destination, index) => ({
        ligne: { id: "C01742", label: "RER B" },
        destination,
        passages: [
          {
            expected_at: `2026-07-01T12:0${index + 1}:00+02:00`,
            statut: "onTime",
            zone_de_correspondance: {
              id: "474151",
              label: "Châtelet - Les Halles (Paris 1er)",
            },
          },
        ],
      })),
      source: "Île-de-France Mobilités",
    });
  });

  it("returns at most 30 Prochains Passages across destinations", async () => {
    const destinations = Array.from(
      { length: 31 },
      (_, index) => `Destination ${index + 1}`,
    );
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": destinations.map((destination, index) => ({
          ligneId: "C01742",
          ligneLabel: "RER B",
          destination,
          expectedAt: new Date(Date.UTC(2026, 6, 1, 10, index + 1, 0)),
          statut: "onTime",
        })),
      }),
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    const count = result.groups.reduce(
      (total, group) => total + group.passages.length,
      0,
    );
    expect(count).toBe(30);
    expect(result.groups).toHaveLength(30);
    expect(result.groups.at(-1)?.destination).toBe("Destination 30");
  });

  it("keeps a cancelled Prochain Passage that has already passed", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": [
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date("2026-07-01T10:02:00.000Z"),
            statut: "cancelled",
          },
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date("2026-07-01T10:06:00.000Z"),
            statut: "onTime",
          },
        ],
      }),
      clock: clockAt("2026-07-01T10:05:00.000Z"),
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Robinson",
          passages: [
            {
              expected_at: "2026-07-01T12:06:00+02:00",
              statut: "onTime",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            },
            {
              expected_at: "2026-07-01T12:02:00+02:00",
              statut: "cancelled",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("keeps a cancelled Prochain Passage with its Statut de passage", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": [
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date("2026-07-01T10:04:00.000Z"),
            statut: "cancelled",
          },
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Aéroport Charles de Gaulle 2 TGV",
            expectedAt: new Date("2026-07-01T10:06:00.000Z"),
            statut: "early",
          },
        ],
      }),
    });

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Robinson",
          passages: [
            {
              expected_at: "2026-07-01T12:04:00+02:00",
              statut: "cancelled",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            },
          ],
        },
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Aéroport Charles de Gaulle 2 TGV",
          passages: [
            {
              expected_at: "2026-07-01T12:06:00+02:00",
              statut: "early",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("unions Prochains Passages of matching Zones de correspondance", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B, METRO_1]),
      correspondances: fakeCorrespondances([
        CHATELET_PARIS,
        CHATELET_LES_HALLES,
      ]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:71264:": [
          {
            ligneId: "C01373",
            ligneLabel: "Métro 1",
            destination: "La Défense",
            expectedAt: new Date("2026-07-01T10:01:00.000Z"),
            statut: "onTime",
          },
          {
            ligneId: "C01373",
            ligneLabel: "Métro 1",
            destination: "Château de Vincennes",
            expectedAt: new Date("2026-07-01T10:04:00.000Z"),
            statut: "delayed",
          },
          {
            ligneId: "C01373",
            ligneLabel: "Métro 1",
            destination: "La Défense",
            expectedAt: new Date("2026-07-01T10:07:00.000Z"),
            statut: "onTime",
          },
        ],
        "STIF:StopArea:SP:474151:": [
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date("2026-07-01T10:02:00.000Z"),
            statut: "cancelled",
          },
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Aéroport Charles de Gaulle 2 TGV",
            expectedAt: new Date("2026-07-01T10:03:00.000Z"),
            statut: "arrived",
          },
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date("2026-07-01T10:05:00.000Z"),
            statut: "departed",
          },
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date("2026-07-01T10:08:00.000Z"),
            statut: "onTime",
          },
        ],
      }),
    });

    const result = await app.prochainPassage("Châtelet");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01373", label: "Métro 1" },
          destination: "La Défense",
          passages: [
            {
              expected_at: "2026-07-01T12:01:00+02:00",
              statut: "onTime",
              zone_de_correspondance: {
                id: "71264",
                label: "Châtelet (Paris 4e)",
              },
            },
            {
              expected_at: "2026-07-01T12:07:00+02:00",
              statut: "onTime",
              zone_de_correspondance: {
                id: "71264",
                label: "Châtelet (Paris 4e)",
              },
            },
          ],
        },
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Robinson",
          passages: [
            {
              expected_at: "2026-07-01T12:02:00+02:00",
              statut: "cancelled",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            },
            {
              expected_at: "2026-07-01T12:05:00+02:00",
              statut: "departed",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            },
            {
              expected_at: "2026-07-01T12:08:00+02:00",
              statut: "onTime",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            },
          ],
        },
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Aéroport Charles de Gaulle 2 TGV",
          passages: [
            {
              expected_at: "2026-07-01T12:03:00+02:00",
              statut: "arrived",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            },
          ],
        },
        {
          ligne: { id: "C01373", label: "Métro 1" },
          destination: "Château de Vincennes",
          passages: [
            {
              expected_at: "2026-07-01T12:04:00+02:00",
              statut: "delayed",
              zone_de_correspondance: {
                id: "71264",
                label: "Châtelet (Paris 4e)",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("returns not found for an empty Zone de correspondance query without calling SIRI", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: {
        async getPassages() {
          throw new Error("SIRI should not be called");
        },
      },
    });

    const result = await app.prochainPassage("  ");
    expect(result).toEqual({
      status: "not_found",
      message: "Aucune Zone de correspondance correspondante",
      source: "Île-de-France Mobilités",
    });
  });

  it("asks for clarification when more than five Zones de correspondance match", async () => {
    const zones = numberedZones(6);
    const app = passagesApp({
      lookup: fakeLookup([]),
      correspondances: fakeCorrespondances(zones),
      stopMonitoring: {
        async getPassages() {
          throw new Error("SIRI should not be called");
        },
      },
    });

    const result = await app.prochainPassage("Nation");
    expect(result).toEqual({
      status: "needs_clarification",
      candidates: zones.map(({ id, label, mode }) => ({ id, label, mode })),
      source: "Île-de-France Mobilités",
    });
  });

  it("asks for clarification when more than five Lignes match the optional filter", async () => {
    const lignes = numberedBusLignes(6);
    const app = passagesApp({
      lookup: fakeLookup(lignes),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: {
        async getPassages() {
          throw new Error("SIRI should not be called");
        },
      },
    });

    const result = await app.prochainPassage("Châtelet - Les Halles", "Bus");
    expect(result).toEqual({
      status: "needs_clarification",
      candidates: lignes.map(({ id, label, mode }) => ({ id, label, mode })),
      source: "Île-de-France Mobilités",
    });
  });

  it("returns not found when the optional Ligne matches nothing", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: {
        async getPassages() {
          throw new Error("SIRI should not be called");
        },
      },
    });

    const result = await app.prochainPassage(
      "Châtelet - Les Halles",
      "Ligne inexistante",
    );
    expect(result).toEqual({
      status: "not_found",
      message: "Aucune Ligne correspondante",
      source: "Île-de-France Mobilités",
    });
  });

  it("does not cache live Prochains Passages", async () => {
    const catalog: Record<string, ProchainPassage[]> = {
      "STIF:StopArea:SP:474151:": [
        {
          ligneId: "C01742",
          ligneLabel: "RER B",
          destination: "Robinson",
          expectedAt: new Date("2026-07-01T10:04:00.000Z"),
          statut: "onTime",
        },
      ],
    };
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: fakeCorrespondances([CHATELET_LES_HALLES]),
      stopMonitoring: fakeStopMonitoring(catalog),
    });

    await app.prochainPassage("Châtelet - Les Halles");
    catalog["STIF:StopArea:SP:474151:"] = [
      {
        ligneId: "C01742",
        ligneLabel: "RER B",
        destination: "Saint-Rémy-lès-Chevreuse",
        expectedAt: new Date("2026-07-01T10:09:00.000Z"),
        statut: "delayed",
      },
    ];

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Saint-Rémy-lès-Chevreuse",
          passages: [
            {
              expected_at: "2026-07-01T12:09:00+02:00",
              statut: "delayed",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("asks SIRI for the Zone de correspondance of a Zone d'arrêt id", async () => {
    const app = passagesApp({
      lookup: fakeLookup([METRO_1]),
      correspondances: {
        async search(query) {
          return query === "42587" ? [CHATELET_PARIS] : [];
        },
      },
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:71264:": [
          {
            ligneId: "C01373",
            ligneLabel: "Métro 1",
            destination: "La Défense",
            expectedAt: new Date("2026-07-01T10:04:00.000Z"),
            statut: "onTime",
          },
        ],
      }),
    });

    const result = await app.prochainPassage("stop_area:IDFM:42587");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01373", label: "Métro 1" },
          destination: "La Défense",
          passages: [
            {
              expected_at: "2026-07-01T12:04:00+02:00",
              statut: "onTime",
              zone_de_correspondance: {
                id: "71264",
                label: "Châtelet (Paris 4e)",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("reuses a referential Zone de correspondance match within 24 hours", async () => {
    const catalog = { zones: [CHATELET_LES_HALLES] };
    const clock = clockAt("2026-10-26T10:00:00Z");
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: {
        async search() {
          return catalog.zones;
        },
      },
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": [
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date("2026-10-26T10:04:00.000Z"),
            statut: "onTime",
          },
        ],
      }),
      clock,
    });

    await app.prochainPassage("Châtelet - Les Halles");
    catalog.zones = [
      {
        ...CHATELET_LES_HALLES,
        label: "Châtelet - Les Halles (renommée)",
      },
    ];

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Robinson",
          passages: [
            {
              expected_at: "2026-10-26T11:04:00+01:00",
              statut: "onTime",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (Paris 1er)",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("refreshes a referential Zone de correspondance match after 24 hours", async () => {
    const catalog = { zones: [CHATELET_LES_HALLES] };
    const clock = clockAt("2026-10-26T10:00:00Z");
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: {
        async search() {
          return catalog.zones;
        },
      },
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:474151:": [
          {
            ligneId: "C01742",
            ligneLabel: "RER B",
            destination: "Robinson",
            expectedAt: new Date("2026-10-27T10:04:00.000Z"),
            statut: "onTime",
          },
        ],
      }),
      clock,
    });

    await app.prochainPassage("Châtelet - Les Halles");
    catalog.zones = [
      {
        ...CHATELET_LES_HALLES,
        label: "Châtelet - Les Halles (renommée)",
      },
    ];
    clock.set("2026-10-27T10:00:00Z");

    const result = await app.prochainPassage("Châtelet - Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Robinson",
          passages: [
            {
              expected_at: "2026-10-27T11:04:00+01:00",
              statut: "onTime",
              zone_de_correspondance: {
                id: "474151",
                label: "Châtelet - Les Halles (renommée)",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("fails when the Zone de correspondance lookup is down", async () => {
    const app = passagesApp({
      lookup: fakeLookup([RER_B]),
      correspondances: {
        async search() {
          throw new Error("referential down");
        },
      },
    });

    await expect(
      app.prochainPassage("Châtelet - Les Halles"),
    ).rejects.toBeInstanceOf(LookupUnavailableError);
  });
});
