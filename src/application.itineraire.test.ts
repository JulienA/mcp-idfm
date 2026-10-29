import { describe, expect, it } from "vitest";
import {
  createApplication,
  LookupUnavailableError,
  type Clock,
  type Itineraire,
  type ItinerairePlanning,
  type Lieu,
  type NavitiaLookup,
} from "./application/index.js";
import { createPrimItineraire } from "./infra/prim-itineraire.js";

const emptyLookup: NavitiaLookup = {
  searchLines: async () => [],
  searchStops: async () => [],
};

const CHATELET: Lieu = {
  id: "71264",
  label: "Châtelet",
  genre: "zone_d_arret",
  mode: "Métro",
};

const NATION: Lieu = {
  id: "71673",
  label: "Nation",
  genre: "zone_d_arret",
  mode: "Métro",
};

const NATION_RER: Lieu = {
  id: "70002",
  label: "Nation RER",
  genre: "zone_d_arret",
  mode: "RER",
};

const RIVOLI: Lieu = {
  id: "2.36041;48.8555",
  label: "10 Rue de Rivoli (Paris)",
  genre: "adresse",
};

const SAMPLE: Itineraire = {
  depart: "2026-10-29T18:28:00+01:00",
  arrivee: "2026-10-29T18:42:00+01:00",
  duree_secondes: 840,
  changements: 0,
  effet: "retards",
  etapes: [
    {
      genre: "marche",
      duree_secondes: 120,
      de: "Nation",
      vers: "Nation",
    },
    {
      genre: "ligne",
      ligne: { id: "C01373", label: "Métro 1", mode: "Métro" },
      destination: "La Défense",
      de: "Nation",
      vers: "Châtelet",
      de_id: "71673",
      vers_id: "71264",
      depart: "2026-10-29T18:30:00+01:00",
      arrivee: "2026-10-29T18:42:00+01:00",
      perturbations: [
        {
          title: "Retard",
          text: "Train ralenti.",
          severite: "perturbé",
        },
      ],
    },
  ],
};

function clockAt(iso: string): Clock & { set(next: string): void } {
  let now = new Date(iso);
  return {
    now: () => now,
    set(next) {
      now = new Date(next);
    },
  };
}

function numberedLieux(count: number, label = "Nation"): Lieu[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `8000${index}`,
    label: `${label} ${index}`,
    genre: "zone_d_arret" as const,
    mode: "Bus",
  }));
}

function fakePlanning(catalog: {
  lieux?: Record<string, Lieu[]>;
  plan?: ItinerairePlanning["plan"];
}) {
  const searchCalls: { query: string; limit: number }[] = [];
  const planInputs: Parameters<ItinerairePlanning["plan"]>[0][] = [];
  const planning: ItinerairePlanning = {
    async searchLieux(query, limit) {
      searchCalls.push({ query, limit });
      return catalog.lieux?.[query] ?? [];
    },
    async plan(input) {
      planInputs.push(input);
      if (catalog.plan) {
        return catalog.plan(input);
      }
      return { kind: "ok", itineraires: [SAMPLE] };
    },
  };
  return { planning, searchCalls, planInputs };
}

function appFor(
  catalog: Parameters<typeof fakePlanning>[0],
  extras: {
    clock?: Clock;
    maxCandidates?: number;
    lookup?: NavitiaLookup;
  } = {},
) {
  const fake = fakePlanning(catalog);
  return {
    ...fake,
    app: createApplication({
      lookup: extras.lookup ?? emptyLookup,
      itineraires: fake.planning,
      clock: extras.clock ?? clockAt("2026-10-29T16:00:00.000Z"),
      maxCandidates: extras.maxCandidates,
    }),
  };
}

describe("itineraire", () => {
  it("computes one Itinéraire when both Lieux are unique", async () => {
    const { app, searchCalls, planInputs } = appFor({
      lieux: { Châtelet: [CHATELET], Nation: [NATION] },
    });

    const result = await app.itineraire("Nation", "Châtelet");
    expect(result).toEqual({
      status: "ok",
      horaires: "temps_reel",
      itineraires: [SAMPLE],
      source: "Île-de-France Mobilités",
    });
    expect(searchCalls).toEqual([
      { query: "Nation", limit: 5 },
      { query: "Châtelet", limit: 5 },
    ]);
    expect(planInputs).toEqual([
      {
        depart: NATION,
        arrivee: CHATELET,
        horaire: new Date("2026-10-29T16:00:00.000Z"),
        sens: "depart",
        count: 3,
      },
    ]);
  });

  it("keeps at most three Itinéraires", async () => {
    const extra: Itineraire = { ...SAMPLE, duree_secondes: 900 };
    const { app } = appFor({
      lieux: { Nation: [NATION], Châtelet: [CHATELET] },
      plan: async () => ({
        kind: "ok",
        itineraires: [SAMPLE, extra, extra, extra],
      }),
    });
    const result = await app.itineraire("Nation", "Châtelet");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    expect(result.itineraires).toHaveLength(3);
  });

  it("forwards horaire with offset and sens arrivee to plan", async () => {
    const { app, planInputs } = appFor({
      lieux: { Châtelet: [CHATELET], Nation: [NATION] },
    });

    await app.itineraire("Nation", "Châtelet", {
      horaire: "2026-10-29T18:30:00+01:00",
      sens: "arrivee",
    });
    expect(planInputs).toEqual([
      {
        depart: NATION,
        arrivee: CHATELET,
        horaire: new Date("2026-10-29T18:30:00+01:00"),
        sens: "arrivee",
        count: 3,
      },
    ]);
  });

  it("does not search Lieux for coordinates", async () => {
    const { app, searchCalls, planInputs } = appFor({
      lieux: { "Gare de Lyon": [CHATELET] },
    });

    const result = await app.itineraire(
      "2.2945;48.8584",
      "2.3588;48.8556",
    );
    expect(result.status).toBe("ok");
    expect(searchCalls).toEqual([]);
    expect(planInputs).toEqual([
      {
        depart: {
          id: "2.2945;48.8584",
          label: "2.2945;48.8584",
          genre: "coordonnees",
        },
        arrivee: {
          id: "2.3588;48.8556",
          label: "2.3588;48.8556",
          genre: "coordonnees",
        },
        horaire: new Date("2026-10-29T16:00:00.000Z"),
        sens: "depart",
        count: 3,
      },
    ]);
  });

  it("rejects malformed coordinates without I/O", async () => {
    const { app, searchCalls, planInputs } = appFor({
      lieux: { Nation: [NATION] },
    });
    const result = await app.itineraire("Nation;Est", "Châtelet");
    expect(result).toEqual({
      status: "not_found",
      message: "Coordonnées invalides (départ)",
      source: "Île-de-France Mobilités",
    });
    expect(searchCalls).toEqual([]);
    expect(planInputs).toEqual([]);
  });

  it("accepts an horaire with offset and without seconds", async () => {
    const { app, planInputs } = appFor({
      lieux: { Nation: [NATION], Châtelet: [CHATELET] },
    });
    await app.itineraire("Nation", "Châtelet", {
      horaire: "2026-10-29T18:30+01:00",
    });
    expect(planInputs[0]?.horaire).toEqual(new Date("2026-10-29T18:30+01:00"));
  });

  it("rejects an horaire without offset without I/O", async () => {
    const { app, searchCalls, planInputs } = appFor({
      lieux: { Nation: [NATION], Châtelet: [CHATELET] },
    });
    const result = await app.itineraire("Nation", "Châtelet", {
      horaire: "2026-10-29T18:30:00",
    });
    expect(result).toEqual({
      status: "not_found",
      message: "Horaire invalide",
      source: "Île-de-France Mobilités",
    });
    expect(searchCalls).toEqual([]);
    expect(planInputs).toEqual([]);
  });

  it("rejects an unknown sens without I/O", async () => {
    const { app, searchCalls, planInputs } = appFor({
      lieux: { Nation: [NATION], Châtelet: [CHATELET] },
    });
    const result = await app.itineraire("Nation", "Châtelet", {
      sens: "retour",
    });
    expect(result).toEqual({
      status: "not_found",
      message: "Sens invalide",
      source: "Île-de-France Mobilités",
    });
    expect(searchCalls).toEqual([]);
    expect(planInputs).toEqual([]);
  });

  it("rejects a blank end without I/O", async () => {
    const { app, searchCalls, planInputs } = appFor({
      lieux: { Nation: [NATION] },
    });
    const result = await app.itineraire("  ", "Nation");
    expect(result).toEqual({
      status: "not_found",
      message: "Aucun Lieu de départ correspondant",
      source: "Île-de-France Mobilités",
    });
    expect(searchCalls).toEqual([]);
    expect(planInputs).toEqual([]);
  });

  it("asks for clarification when two départs match and does not plan", async () => {
    const { app, planInputs } = appFor({
      lieux: {
        Nation: [NATION, NATION_RER],
        Châtelet: [CHATELET],
      },
    });
    const result = await app.itineraire("Nation", "Châtelet");
    expect(result).toEqual({
      status: "needs_clarification",
      depart: { candidats: [NATION, NATION_RER] },
      arrivee: { lieu: CHATELET },
      source: "Île-de-France Mobilités",
    });
    expect(planInputs).toEqual([]);
  });

  it("asks for clarification on a 2×2 match without a cartesian product of plans", async () => {
    const { app, planInputs } = appFor({
      lieux: {
        Nation: [NATION, NATION_RER],
        Rivoli: [RIVOLI, { ...RIVOLI, id: "2.36;48.85", label: "Rivoli" }],
      },
    });
    const result = await app.itineraire("Nation", "Rivoli");
    expect(result.status).toBe("needs_clarification");
    if (result.status !== "needs_clarification") {
      throw new Error("expected clarification");
    }
    expect("candidats" in result.depart && result.depart.candidats).toEqual([
      NATION,
      NATION_RER,
    ]);
    expect("candidats" in result.arrivee && result.arrivee.candidats).toHaveLength(
      2,
    );
    expect(planInputs).toEqual([]);
  });

  it("caps clarification candidats at maxCandidates", async () => {
    const { app, planInputs } = appFor(
      { lieux: { Nation: numberedLieux(9), Châtelet: [CHATELET] } },
      { maxCandidates: 8 },
    );
    const result = await app.itineraire("Nation", "Châtelet");
    expect(result.status).toBe("needs_clarification");
    if (result.status !== "needs_clarification") {
      throw new Error("expected clarification");
    }
    expect("candidats" in result.depart && result.depart.candidats).toHaveLength(
      8,
    );
    expect(planInputs).toEqual([]);
  });

  it("hides the other side when one end has zero matches", async () => {
    const { app, planInputs } = appFor({
      lieux: { Nation: [NATION, NATION_RER] },
    });
    const result = await app.itineraire("Inconnu", "Nation");
    expect(result).toEqual({
      status: "not_found",
      message: "Aucun Lieu de départ correspondant",
      source: "Île-de-France Mobilités",
    });
    expect(planInputs).toEqual([]);
  });

  it("fails lookup the same way as the other tools", async () => {
    let planCalls = 0;
    const failing = createApplication({
      lookup: emptyLookup,
      itineraires: {
        async searchLieux() {
          throw new Error("PRIM down");
        },
        async plan() {
          planCalls += 1;
          return { kind: "ok", itineraires: [] };
        },
      },
    });
    await expect(failing.itineraire("Nation", "Châtelet")).rejects.toBeInstanceOf(
      LookupUnavailableError,
    );
    expect(planCalls).toBe(0);
  });

  it("returns an error envelope when plan is indisponible, without throwing", async () => {
    const { app } = appFor({
      lieux: { Nation: [NATION], Châtelet: [CHATELET] },
      plan: async () => ({ kind: "indisponible" }),
    });
    await expect(app.itineraire("Nation", "Châtelet")).resolves.toEqual({
      status: "error",
      message: "Impossible de calculer l'Itinéraire",
      source: "Île-de-France Mobilités",
    });
  });

  it("returns an empty list when Navitia has no solution", async () => {
    const { app } = appFor({
      lieux: { Nation: [NATION], Châtelet: [CHATELET] },
      plan: async () => ({ kind: "aucun" }),
    });
    await expect(app.itineraire("Nation", "Châtelet")).resolves.toEqual({
      status: "ok",
      horaires: "temps_reel",
      itineraires: [],
      summary: "Aucun itinéraire",
      source: "Île-de-France Mobilités",
    });
  });

  it("returns not found when the horaire is outside the coverage calendar", async () => {
    const { app } = appFor({
      lieux: { Nation: [NATION], Châtelet: [CHATELET] },
      plan: async () => ({ kind: "hors_calendrier" }),
    });
    await expect(app.itineraire("Nation", "Châtelet")).resolves.toEqual({
      status: "not_found",
      message: "Horaire hors calendrier",
      source: "Île-de-France Mobilités",
    });
  });

  it("returns not found when Navitia does not know a Lieu id", async () => {
    const { app } = appFor({
      lieux: { Nation: [NATION], Châtelet: [CHATELET] },
      plan: async () => ({ kind: "lieu_inconnu" }),
    });
    await expect(app.itineraire("Nation", "Châtelet")).resolves.toEqual({
      status: "not_found",
      message: "Aucun Lieu correspondant",
      source: "Île-de-France Mobilités",
    });
  });

  it("returns an error envelope when plan throws", async () => {
    const { app } = appFor({
      lieux: { Nation: [NATION], Châtelet: [CHATELET] },
      plan: async () => {
        throw new Error("timeout");
      },
    });
    await expect(app.itineraire("Nation", "Châtelet")).resolves.toEqual({
      status: "error",
      message: "Impossible de calculer l'Itinéraire",
      source: "Île-de-France Mobilités",
    });
  });

  it("reuses a Lieu search within 24 hours but never caches the calculation", async () => {
    const catalog = {
      lieux: { Nation: [NATION], Châtelet: [CHATELET] } as Record<string, Lieu[]>,
    };
    const clock = clockAt("2026-10-29T16:00:00.000Z");
    const { app, searchCalls, planInputs } = appFor(catalog, { clock });

    await app.itineraire("Nation", "Châtelet");
    catalog.lieux.Nation = [{ ...NATION, label: "Nation (mis à jour)" }];
    await app.itineraire("Nation", "Châtelet");
    expect(searchCalls).toHaveLength(2);
    expect(planInputs).toHaveLength(2);

    clock.set("2026-10-30T16:00:00.000Z");
    const result = await app.itineraire("Nation", "Châtelet");
    expect(searchCalls).toHaveLength(4);
    expect(planInputs).toHaveLength(3);
    expect(result.status).toBe("ok");
  });

  it("recalls a clarification with a numeric id and lon;lat without a second text search", async () => {
    const { app, searchCalls, planInputs } = appFor({
      lieux: { "71673": [NATION] },
    });
    const result = await app.itineraire("71673", "2.36041;48.8555");
    expect(result.status).toBe("ok");
    expect(searchCalls).toEqual([{ query: "71673", limit: 5 }]);
    expect(planInputs).toEqual([
      {
        depart: NATION,
        arrivee: {
          id: "2.36041;48.8555",
          label: "2.36041;48.8555",
          genre: "coordonnees",
        },
        horaire: new Date("2026-10-29T16:00:00.000Z"),
        sens: "depart",
        count: 3,
      },
    ]);
  });

  it("copies Effet d'itinéraire and Perturbations d'itinéraire onto the payload", async () => {
    const { app } = appFor({
      lieux: { Nation: [NATION], Châtelet: [CHATELET] },
    });
    const result = await app.itineraire("Nation", "Châtelet");
    expect(result).toMatchObject({
      status: "ok",
      itineraires: [
        {
          effet: "retards",
          etapes: [
            { genre: "marche" },
            {
              genre: "ligne",
              ligne: { id: "C01373" },
              perturbations: [
                {
                  title: "Retard",
                  text: "Train ralenti.",
                  severite: "perturbé",
                },
              ],
            },
          ],
        },
      ],
    });
  });
});

const live = Boolean(process.env.PRIM_API_KEY?.trim()) && process.env.CI !== "true";

describe.skipIf(!live)("itineraire live", () => {
  it("computes a realtime Itinéraire from coordinates", { timeout: 50_000 }, async () => {
    const app = createApplication({
      lookup: emptyLookup,
      itineraires: createPrimItineraire({
        apiKey: process.env.PRIM_API_KEY!,
      }),
    });
    const result = await app.itineraire(
      "2.3749036;48.8467927",
      "2.2922926;48.8583736",
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    expect(result.horaires).toBe("temps_reel");
    expect(result.itineraires.length).toBeGreaterThanOrEqual(1);
    expect(result.itineraires[0]?.duree_secondes).toBeGreaterThan(0);
  });
});
