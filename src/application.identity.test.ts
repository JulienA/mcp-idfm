import { describe, expect, it } from "vitest";
import {
  createApplication,
  LookupUnavailableError,
} from "./application/index.js";
import type {
  Clock,
  Ligne,
  NavitiaLookup,
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

const BUS_1: Ligne = {
  id: "C01193",
  label: "Bus 1",
  mode: "Bus",
  siri_line_ref: "STIF:Line::C01193:",
  navitia_id: "line:IDFM:C01193",
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

const CHATELET_RER: ZoneDarret = {
  id: "73641",
  label: "Châtelet-Les Halles",
  mode: "RER",
  siri_monitoring_ref: "STIF:StopArea:SP:73641:",
  navitia_id: "stop_area:IDFM:73641",
};

const CHATELET_RER_FICHE = {
  id: "73641",
  label: "Châtelet-Les Halles",
  siri_monitoring_ref: "STIF:StopArea:SP:73641:",
  navitia_id: "stop_area:IDFM:73641",
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

function fakeLookup(lines: Ligne[], stops: ZoneDarret[] = []): NavitiaLookup {
  return mutableFakeLookup({ lines, stops });
}

function mutableFakeLookup(catalog: {
  lines: Ligne[];
  stops?: ZoneDarret[];
}): NavitiaLookup {
  return {
    async searchLines(query) {
      const q = query.trim().toLowerCase();
      return catalog.lines.filter(
        (ligne) =>
          ligne.id.toLowerCase() === q ||
          ligne.label.toLowerCase().includes(q),
      );
    },
    async searchStops(query) {
      const q = query.trim().toLowerCase();
      return (catalog.stops ?? []).filter(
        (stop) =>
          stop.id.toLowerCase() === q || stop.label.toLowerCase().includes(q),
      );
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

describe("get_line_id", () => {
  it("returns the Ligne fiche when the query matches uniquely", async () => {
    const app = createApplication({ lookup: fakeLookup([RER_B]) });
    const result = await app.getLineId("RER B");
    expect(result).toEqual({
      status: "ok",
      fiche: RER_B,
      source: "Île-de-France Mobilités",
    });
  });

  it("returns the Ligne fiche when queried by canonical id", async () => {
    const app = createApplication({ lookup: fakeLookup([RER_B]) });
    const result = await app.getLineId("C01742");
    expect(result).toEqual({
      status: "ok",
      fiche: RER_B,
      source: "Île-de-France Mobilités",
    });
  });

  it("returns the Ligne fiche when queried by Navitia id", async () => {
    const app = createApplication({ lookup: fakeLookup([RER_B]) });
    const result = await app.getLineId("line:IDFM:C01742");
    expect(result).toEqual({
      status: "ok",
      fiche: RER_B,
      source: "Île-de-France Mobilités",
    });
  });

  it("returns the Ligne fiche when queried by SIRI LineRef", async () => {
    const app = createApplication({ lookup: fakeLookup([RER_B]) });
    const result = await app.getLineId("STIF:Line::C01742:");
    expect(result).toEqual({
      status: "ok",
      fiche: RER_B,
      source: "Île-de-France Mobilités",
    });
  });

  it("returns not found when the Ligne query is empty", async () => {
    const app = createApplication({ lookup: fakeLookup([RER_B]) });
    const result = await app.getLineId("  ");
    expect(result).toEqual({
      status: "not_found",
      message: "Aucune Ligne correspondante",
      source: "Île-de-France Mobilités",
    });
  });

  it("returns not found when no Ligne matches", async () => {
    const app = createApplication({ lookup: fakeLookup([RER_B]) });
    const result = await app.getLineId("Ligne inexistante");
    expect(result).toEqual({
      status: "not_found",
      message: "Aucune Ligne correspondante",
      source: "Île-de-France Mobilités",
    });
  });

  it("returns the union of fiches when two Lignes match", async () => {
    const app = createApplication({
      lookup: fakeLookup([METRO_1, BUS_1]),
    });
    const result = await app.getLineId("1");
    expect(result).toEqual({
      status: "ok",
      fiches: [METRO_1, BUS_1],
      source: "Île-de-France Mobilités",
    });
  });

  it("returns the union of fiches when five Lignes match", async () => {
    const fiches = numberedBusLignes(5);
    const app = createApplication({ lookup: fakeLookup(fiches) });
    const result = await app.getLineId("Bus");
    expect(result).toEqual({
      status: "ok",
      fiches,
      source: "Île-de-France Mobilités",
    });
  });

  it("reuses a referential match within 24 hours", async () => {
    const catalog = { lines: [RER_B] };
    const clock = clockAt("2026-10-26T10:00:00Z");
    const app = createApplication({
      lookup: mutableFakeLookup(catalog),
      clock,
    });

    await app.getLineId("RER B");
    catalog.lines = [
      {
        ...RER_B,
        label: "RER B (mis à jour)",
      },
    ];

    const result = await app.getLineId("RER B");
    expect(result).toEqual({
      status: "ok",
      fiche: RER_B,
      source: "Île-de-France Mobilités",
    });
  });

  it("refreshes a referential match after 24 hours", async () => {
    const catalog = { lines: [RER_B] };
    const clock = clockAt("2026-10-26T10:00:00Z");
    const app = createApplication({
      lookup: mutableFakeLookup(catalog),
      clock,
    });

    await app.getLineId("RER B");
    const updated = { ...RER_B, label: "RER B (mis à jour)" };
    catalog.lines = [updated];
    clock.set("2026-10-27T10:00:00Z");

    const result = await app.getLineId("RER B");
    expect(result).toEqual({
      status: "ok",
      fiche: updated,
      source: "Île-de-France Mobilités",
    });
  });

  it("fails when PRIM lookup cannot search Lignes", async () => {
    const app = createApplication({
      lookup: {
        searchLines: async () => {
          throw new Error("PRIM down");
        },
        searchStops: async () => [],
      },
    });

    await expect(app.getLineId("RER B")).rejects.toBeInstanceOf(
      LookupUnavailableError,
    );
  });

  it("asks for clarification when more than five Lignes match", async () => {
    const fiches = numberedBusLignes(6);
    const app = createApplication({ lookup: fakeLookup(fiches) });
    const result = await app.getLineId("Bus");
    expect(result).toEqual({
      status: "needs_clarification",
      candidates: fiches.map(({ id, label, mode }) => ({ id, label, mode })),
      source: "Île-de-France Mobilités",
    });
  });

  it("returns the union of fiches up to the configured candidate limit", async () => {
    const fiches = numberedBusLignes(8);
    const app = createApplication({
      lookup: fakeLookup(fiches),
      maxCandidates: 8,
    });
    const result = await app.getLineId("Bus");
    expect(result).toEqual({
      status: "ok",
      fiches,
      source: "Île-de-France Mobilités",
    });
  });

  it("asks for clarification when matches exceed the configured candidate limit", async () => {
    const fiches = numberedBusLignes(9);
    const app = createApplication({
      lookup: fakeLookup(fiches),
      maxCandidates: 8,
    });
    const result = await app.getLineId("Bus");
    expect(result).toEqual({
      status: "needs_clarification",
      candidates: fiches.map(({ id, label, mode }) => ({ id, label, mode })),
      source: "Île-de-France Mobilités",
    });
  });
});

describe("get_stop_id", () => {
  it("returns the Zone d'arrêt fiche when the query matches uniquely", async () => {
    const app = createApplication({
      lookup: fakeLookup([], [CHATELET_RER]),
    });
    const result = await app.getStopId("Châtelet-Les Halles");
    expect(result).toEqual({
      status: "ok",
      fiche: CHATELET_RER_FICHE,
      source: "Île-de-France Mobilités",
    });
  });

  it("returns the Zone d'arrêt fiche when queried by canonical id", async () => {
    const app = createApplication({
      lookup: fakeLookup([], [CHATELET_RER]),
    });
    const result = await app.getStopId("73641");
    expect(result).toEqual({
      status: "ok",
      fiche: CHATELET_RER_FICHE,
      source: "Île-de-France Mobilités",
    });
  });

  it("returns the Zone d'arrêt fiche when queried by Navitia id", async () => {
    const app = createApplication({
      lookup: fakeLookup([], [CHATELET_RER]),
    });
    const result = await app.getStopId("stop_area:IDFM:73641");
    expect(result).toEqual({
      status: "ok",
      fiche: CHATELET_RER_FICHE,
      source: "Île-de-France Mobilités",
    });
  });

  it("returns the Zone d'arrêt fiche when queried by SIRI MonitoringRef", async () => {
    const app = createApplication({
      lookup: fakeLookup([], [CHATELET_RER]),
    });
    const result = await app.getStopId("STIF:StopArea:SP:73641:");
    expect(result).toEqual({
      status: "ok",
      fiche: CHATELET_RER_FICHE,
      source: "Île-de-France Mobilités",
    });
  });

  it("returns not found when the Zone d'arrêt query is empty", async () => {
    const app = createApplication({
      lookup: fakeLookup([], [CHATELET_RER]),
    });
    const result = await app.getStopId("  ");
    expect(result).toEqual({
      status: "not_found",
      message: "Aucune Zone d'arrêt correspondante",
      source: "Île-de-France Mobilités",
    });
  });

  it("returns not found when no Zone d'arrêt matches", async () => {
    const app = createApplication({
      lookup: fakeLookup([], [CHATELET_RER]),
    });
    const result = await app.getStopId("Arrêt inexistant");
    expect(result).toEqual({
      status: "not_found",
      message: "Aucune Zone d'arrêt correspondante",
      source: "Île-de-France Mobilités",
    });
  });

  it("returns the union of fiches when two Zones d'arrêt match", async () => {
    const app = createApplication({
      lookup: fakeLookup([], [NATION_METRO, NATION_RER]),
    });
    const result = await app.getStopId("Nation");
    expect(result).toEqual({
      status: "ok",
      fiches: [
        {
          id: "70001",
          label: "Nation Métro",
          siri_monitoring_ref: "STIF:StopArea:SP:70001:",
          navitia_id: "stop_area:IDFM:70001",
        },
        {
          id: "70002",
          label: "Nation RER",
          siri_monitoring_ref: "STIF:StopArea:SP:70002:",
          navitia_id: "stop_area:IDFM:70002",
        },
      ],
      source: "Île-de-France Mobilités",
    });
  });

  it("returns the union of fiches when five Zones d'arrêt match", async () => {
    const stops = numberedStops(5);
    const app = createApplication({ lookup: fakeLookup([], stops) });
    const result = await app.getStopId("Nation");
    expect(result).toEqual({
      status: "ok",
      fiches: stops.map((stop) => ({
        id: stop.id,
        label: stop.label,
        siri_monitoring_ref: stop.siri_monitoring_ref,
        navitia_id: stop.navitia_id,
      })),
      source: "Île-de-France Mobilités",
    });
  });

  it("reuses a referential Zone d'arrêt match within 24 hours", async () => {
    const catalog = { lines: [] as Ligne[], stops: [CHATELET_RER] };
    const clock = clockAt("2026-10-26T10:00:00Z");
    const app = createApplication({
      lookup: mutableFakeLookup(catalog),
      clock,
    });

    await app.getStopId("Châtelet-Les Halles");
    catalog.stops = [{ ...CHATELET_RER, label: "Châtelet-Les Halles (mis à jour)" }];

    const result = await app.getStopId("Châtelet-Les Halles");
    expect(result).toEqual({
      status: "ok",
      fiche: CHATELET_RER_FICHE,
      source: "Île-de-France Mobilités",
    });
  });

  it("refreshes a referential Zone d'arrêt match after 24 hours", async () => {
    const catalog = { lines: [] as Ligne[], stops: [CHATELET_RER] };
    const clock = clockAt("2026-10-26T10:00:00Z");
    const app = createApplication({
      lookup: mutableFakeLookup(catalog),
      clock,
    });

    await app.getStopId("Châtelet-Les Halles");
    const updated = {
      ...CHATELET_RER,
      label: "Châtelet-Les Halles (mis à jour)",
    };
    catalog.stops = [updated];
    clock.set("2026-10-27T10:00:00Z");

    const result = await app.getStopId("Châtelet-Les Halles");
    expect(result).toEqual({
      status: "ok",
      fiche: {
        id: "73641",
        label: "Châtelet-Les Halles (mis à jour)",
        siri_monitoring_ref: "STIF:StopArea:SP:73641:",
        navitia_id: "stop_area:IDFM:73641",
      },
      source: "Île-de-France Mobilités",
    });
  });

  it("fails when PRIM lookup cannot search Zones d'arrêt", async () => {
    const app = createApplication({
      lookup: {
        searchLines: async () => [],
        searchStops: async () => {
          throw new Error("PRIM down");
        },
      },
    });

    await expect(app.getStopId("Châtelet-Les Halles")).rejects.toBeInstanceOf(
      LookupUnavailableError,
    );
  });

  it("asks for clarification when more than five Zones d'arrêt match", async () => {
    const stops = numberedStops(6);
    const app = createApplication({ lookup: fakeLookup([], stops) });
    const result = await app.getStopId("Nation");
    expect(result).toEqual({
      status: "needs_clarification",
      candidates: stops.map(({ id, label, mode }) => ({ id, label, mode })),
      source: "Île-de-France Mobilités",
    });
  });
});
