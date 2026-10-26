import { describe, expect, it } from "vitest";
import { createApplication } from "./application/index.js";
import { createPrimSiriStopMonitoring } from "./infra/prim-siri-stop-monitoring.js";
import type {
  Ligne,
  NavitiaLookup,
  ProchainPassage,
  StopMonitoring,
  ZoneDarret,
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

const NATION_METRO: ZoneDarret = {
  id: "70001",
  label: "Nation Métro",
  mode: "Métro",
  siri_monitoring_ref: "STIF:StopArea:SP:70001:",
  navitia_id: "stop_area:IDFM:70001",
};

const NATION_RER: ZoneDarret = {
  id: "70002",
  label: "Nation RER",
  mode: "RER",
  siri_monitoring_ref: "STIF:StopArea:SP:70002:",
  navitia_id: "stop_area:IDFM:70002",
};

const CHATELET_RER: ZoneDarret = {
  id: "73641",
  label: "Châtelet-Les Halles",
  mode: "RER",
  siri_monitoring_ref: "STIF:StopArea:SP:73641:",
  navitia_id: "stop_area:IDFM:73641",
};

function numberedStops(count: number): ZoneDarret[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `8000${index}`;
    return {
      id,
      label: `Nation ${index}`,
      mode: "Bus",
      siri_monitoring_ref: `STIF:StopArea:SP:${id}:`,
      navitia_id: `stop_area:IDFM:${id}`,
    };
  });
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

function fakeLookup(lines: Ligne[], stops: ZoneDarret[] = []): NavitiaLookup {
  return {
    async searchLines(query) {
      const q = query.trim().toLowerCase();
      return lines.filter(
        (ligne) =>
          ligne.id.toLowerCase() === q ||
          ligne.label.toLowerCase().includes(q),
      );
    },
    async searchStops(query) {
      const q = query.trim().toLowerCase();
      return stops.filter(
        (stop) =>
          stop.id.toLowerCase() === q || stop.label.toLowerCase().includes(q),
      );
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

describe("prochain_passage", () => {
  it("returns live Prochains Passages for a unique Zone d'arrêt", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B], [CHATELET_RER]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:73641:": [
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

    const result = await app.prochainPassage("Châtelet-Les Halles");
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
              zone_darret: {
                id: "73641",
                label: "Châtelet-Les Halles",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("treats a SIRI visit with only Aimed times as no realtime", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B], [CHATELET_RER]),
      stopMonitoring: createPrimSiriStopMonitoring({
        apiKey: "test-key",
        fetch: async () =>
          new Response(
            JSON.stringify({
              Siri: {
                ServiceDelivery: {
                  StopMonitoringDelivery: {
                    MonitoredStopVisit: [
                      {
                        MonitoredVehicleJourney: {
                          LineRef: "STIF:Line::C01742:",
                          PublishedLineName: "B",
                          DestinationName: "Robinson",
                          MonitoredCall: {
                            AimedDepartureTime: "2026-07-01T10:04:00.000Z",
                            AimedArrivalTime: "2026-07-01T10:04:00.000Z",
                            DepartureStatus: "onTime",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            }),
            { status: 200 },
          ),
      }),
    });

    const result = await app.prochainPassage("Châtelet-Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [],
      summary: "Pas de temps réel",
      source: "Île-de-France Mobilités",
    });
  });

  it("states the absence of realtime instead of falling back to a schedule", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B], [CHATELET_RER]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:73641:": [],
      }),
    });

    const result = await app.prochainPassage("Châtelet-Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [],
      summary: "Pas de temps réel",
      source: "Île-de-France Mobilités",
    });
  });

  it("returns an error when SIRI fails with no usable payload", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B], [CHATELET_RER]),
      stopMonitoring: {
        async getPassages() {
          throw new Error("PRIM SIRI unavailable");
        },
      },
    });

    const result = await app.prochainPassage("Châtelet-Les Halles");
    expect(result).toEqual({
      status: "error",
      message: "Impossible de récupérer les Prochains Passages",
    });
  });

  it("filters Prochains Passages by an optional Ligne after resolution", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B, METRO_1], [CHATELET_RER]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:73641:": [
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

    const result = await app.prochainPassage("Châtelet-Les Halles", "RER B");
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
              zone_darret: {
                id: "73641",
                label: "Châtelet-Les Halles",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("returns at most five Prochains Passages", async () => {
    const live = [1, 2, 3, 4, 5, 6].map((minute) => ({
      ligneId: "C01742",
      ligneLabel: "RER B",
      destination: "Robinson",
      expectedAt: new Date(`2026-07-01T10:0${minute}:00.000Z`),
      statut: "onTime",
    }));
    const app = createApplication({
      lookup: fakeLookup([RER_B], [CHATELET_RER]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:73641:": live,
      }),
    });

    const result = await app.prochainPassage("Châtelet-Les Halles");
    expect(result).toEqual({
      status: "ok",
      groups: [
        {
          ligne: { id: "C01742", label: "RER B" },
          destination: "Robinson",
          passages: [1, 2, 3, 4, 5].map((minute) => ({
            expected_at: `2026-07-01T12:0${minute}:00+02:00`,
            statut: "onTime",
            zone_darret: {
              id: "73641",
              label: "Châtelet-Les Halles",
            },
          })),
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("keeps a cancelled Prochain Passage with its Statut de passage", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B], [CHATELET_RER]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:73641:": [
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

    const result = await app.prochainPassage("Châtelet-Les Halles");
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
              zone_darret: {
                id: "73641",
                label: "Châtelet-Les Halles",
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
              zone_darret: {
                id: "73641",
                label: "Châtelet-Les Halles",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("unions Prochains Passages of matching Zones d'arrêt and still caps at five", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B, METRO_1], [NATION_METRO, NATION_RER]),
      stopMonitoring: fakeStopMonitoring({
        "STIF:StopArea:SP:70001:": [
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
        "STIF:StopArea:SP:70002:": [
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

    const result = await app.prochainPassage("Nation");
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
              zone_darret: { id: "70001", label: "Nation Métro" },
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
              zone_darret: { id: "70002", label: "Nation RER" },
            },
            {
              expected_at: "2026-07-01T12:05:00+02:00",
              statut: "departed",
              zone_darret: { id: "70002", label: "Nation RER" },
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
              zone_darret: { id: "70002", label: "Nation RER" },
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
              zone_darret: { id: "70001", label: "Nation Métro" },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("returns not found for an empty Zone d'arrêt query without calling SIRI", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B], [CHATELET_RER]),
      stopMonitoring: {
        async getPassages() {
          throw new Error("SIRI should not be called");
        },
      },
    });

    const result = await app.prochainPassage("  ");
    expect(result).toEqual({
      status: "not_found",
      message: "Aucune Zone d'arrêt correspondante",
      source: "Île-de-France Mobilités",
    });
  });

  it("asks for clarification when more than five Zones d'arrêt match", async () => {
    const stops = numberedStops(6);
    const app = createApplication({
      lookup: fakeLookup([], stops),
      stopMonitoring: {
        async getPassages() {
          throw new Error("SIRI should not be called");
        },
      },
    });

    const result = await app.prochainPassage("Nation");
    expect(result).toEqual({
      status: "needs_clarification",
      candidates: stops.map(({ id, label, mode }) => ({ id, label, mode })),
      source: "Île-de-France Mobilités",
    });
  });

  it("asks for clarification when more than five Lignes match the optional filter", async () => {
    const lignes = numberedBusLignes(6);
    const app = createApplication({
      lookup: fakeLookup(lignes, [CHATELET_RER]),
      stopMonitoring: {
        async getPassages() {
          throw new Error("SIRI should not be called");
        },
      },
    });

    const result = await app.prochainPassage("Châtelet-Les Halles", "Bus");
    expect(result).toEqual({
      status: "needs_clarification",
      candidates: lignes.map(({ id, label, mode }) => ({ id, label, mode })),
      source: "Île-de-France Mobilités",
    });
  });

  it("returns not found when the optional Ligne matches nothing", async () => {
    const app = createApplication({
      lookup: fakeLookup([RER_B], [CHATELET_RER]),
      stopMonitoring: {
        async getPassages() {
          throw new Error("SIRI should not be called");
        },
      },
    });

    const result = await app.prochainPassage(
      "Châtelet-Les Halles",
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
      "STIF:StopArea:SP:73641:": [
        {
          ligneId: "C01742",
          ligneLabel: "RER B",
          destination: "Robinson",
          expectedAt: new Date("2026-07-01T10:04:00.000Z"),
          statut: "onTime",
        },
      ],
    };
    const app = createApplication({
      lookup: fakeLookup([RER_B], [CHATELET_RER]),
      stopMonitoring: fakeStopMonitoring(catalog),
    });

    await app.prochainPassage("Châtelet-Les Halles");
    catalog["STIF:StopArea:SP:73641:"] = [
      {
        ligneId: "C01742",
        ligneLabel: "RER B",
        destination: "Saint-Rémy-lès-Chevreuse",
        expectedAt: new Date("2026-07-01T10:09:00.000Z"),
        statut: "delayed",
      },
    ];

    const result = await app.prochainPassage("Châtelet-Les Halles");
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
              zone_darret: {
                id: "73641",
                label: "Châtelet-Les Halles",
              },
            },
          ],
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });
});
