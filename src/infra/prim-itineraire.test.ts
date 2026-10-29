import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPrimItineraire } from "./prim-itineraire.js";

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

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
}

const placesSearch = loadFixture("places-search.json");
const journeysOk = loadFixture("journeys-ok.json");
const journeysNoSolution = loadFixture("journeys-no-solution.json");
const journeysDateOutOfBounds = loadFixture("journeys-date-out-of-bounds.json");

const NATION: Parameters<
  ReturnType<typeof createPrimItineraire>["plan"]
>[0]["depart"] = {
  id: "71673",
  label: "Nation",
  genre: "zone_d_arret",
  mode: "Métro",
};

const CHATELET = {
  id: "71264",
  label: "Châtelet",
  genre: "zone_d_arret" as const,
  mode: "Métro",
};

describe("createPrimItineraire", () => {
  it("searches Lieux with stop_area and address types on one page", async () => {
    let requested: URL | undefined;
    const adapter = createPrimItineraire({
      apiKey: "test-key",
      fetch: async (url) => {
        requested = new URL(hrefOf(url));
        return jsonResponse(placesSearch);
      },
    });

    const lieux = await adapter.searchLieux("Nation", 5);
    expect(requested?.pathname).toBe("/marketplace/v2/navitia/places");
    expect(requested?.searchParams.get("q")).toBe("Nation");
    expect(requested?.searchParams.get("count")).toBe("5");
    expect(requested?.searchParams.getAll("type[]")).toEqual([
      "stop_area",
      "address",
    ]);
    expect(requested?.searchParams.has("start_page")).toBe(false);
    expect(lieux).toEqual([
      {
        id: "71673",
        label: "Nation",
        genre: "zone_d_arret",
        mode: "Bus",
      },
      {
        id: "461864",
        label: "One Nation Paris",
        genre: "zone_d_arret",
        mode: "Bus",
      },
      {
        id: "2.36041;48.8555",
        label: "10 Rue de Rivoli (Paris)",
        genre: "adresse",
      },
    ]);
  });

  it("resolves a canonical Zone d'arrêt id and treats 404 as empty", async () => {
    const adapter = createPrimItineraire({
      apiKey: "test-key",
      fetch: async (url) => {
        const path = decodeURIComponent(new URL(hrefOf(url)).pathname);
        if (path.endsWith("/places/stop_area:IDFM:71673")) {
          return jsonResponse({
            places: [
              {
                embedded_type: "stop_area",
                stop_area: { id: "stop_area:IDFM:71673", name: "Nation" },
              },
            ],
          });
        }
        if (path.endsWith("/places/stop_area:IDFM:00000")) {
          return jsonResponse({ error: { message: "missing" } }, 404);
        }
        return jsonResponse({ message: `unexpected ${hrefOf(url)}` }, 500);
      },
    });

    await expect(adapter.searchLieux("71673", 5)).resolves.toEqual([
      {
        id: "71673",
        label: "Nation",
        genre: "zone_d_arret",
        mode: "",
      },
    ]);
    await expect(adapter.searchLieux("00000", 5)).resolves.toEqual([]);
  });

  it("drops an address without coordinates", async () => {
    const adapter = createPrimItineraire({
      apiKey: "test-key",
      fetch: async () =>
        jsonResponse({
          places: [
            {
              embedded_type: "address",
              name: "Somewhere",
              address: { name: "Somewhere" },
            },
          ],
        }),
    });
    await expect(adapter.searchLieux("Somewhere", 5)).resolves.toEqual([]);
  });

  it("plans a realtime Itinéraire and folds Étapes without geojson", async () => {
    let requested: URL | undefined;
    const adapter = createPrimItineraire({
      apiKey: "test-key",
      fetch: async (url) => {
        requested = new URL(hrefOf(url));
        return jsonResponse(journeysOk);
      },
    });

    const result = await adapter.plan({
      depart: NATION,
      arrivee: CHATELET,
      horaire: new Date("2026-10-29T18:30:00+01:00"),
      sens: "depart",
      count: 3,
    });

    expect(requested?.pathname).toBe("/marketplace/v2/navitia/journeys");
    expect(requested?.searchParams.get("from")).toBe("stop_area:IDFM:71673");
    expect(requested?.searchParams.get("to")).toBe("stop_area:IDFM:71264");
    expect(requested?.searchParams.get("datetime")).toBe("20261029T183000");
    expect(requested?.searchParams.get("datetime_represents")).toBe("departure");
    expect(requested?.searchParams.get("count")).toBe("3");
    expect(requested?.searchParams.get("data_freshness")).toBe("realtime");
    expect(requested?.searchParams.getAll("first_section_mode[]")).toEqual([
      "walking",
    ]);
    expect(requested?.searchParams.getAll("last_section_mode[]")).toEqual([
      "walking",
    ]);
    expect(requested?.searchParams.get("disable_geojson")).toBe("true");
    expect(requested?.searchParams.get("depth")).toBe("1");

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("expected ok");
    }
    expect(result.itineraires).toHaveLength(1);
    const itinerary = result.itineraires[0]!;
    expect(itinerary).toMatchObject({
      depart: "2026-10-29T17:19:08+01:00",
      arrivee: "2026-10-29T17:34:12+01:00",
      duree_secondes: 904,
      changements: 1,
    });
    expect(itinerary.effet).toBeUndefined();
    expect(JSON.stringify(itinerary.etapes)).not.toContain("geojson");
    expect(itinerary.etapes).toEqual([
      {
        genre: "ligne",
        ligne: { id: "C01382", label: "12", mode: "Métro" },
        destination: "Mairie d'Aubervilliers",
        de: "Falguière",
        vers: "Gare Montparnasse",
        de_id: "73641",
        vers_id: "71139",
        depart: "2026-10-29T17:19:08+01:00",
        arrivee: "2026-10-29T17:20:04+01:00",
        perturbations: [
          {
            title: "Panne d'un ascenseur",
            text: "Montparnasse-Bienvenue Panne ascenseur situé Parking Oceane niveau -1 <> Hall 1 niveau 2, dir. Toutes Directions + TGV\nMontparnasse-Bienvenue Panne de l'ascenseur situé Parking Oceane niveau -1 <> Hall 1 niveau 2, direction Toutes Directions + TGV\nMontparnasse-Bienvenue Panne de l'ascenseur situé Parking Oceane niveau -1 <> Hall 1 niveau 2, direction Toutes Directions + TGV",
            severite: "perturbé",
          },
          {
            title: "Panne d'un ascenseur",
            text: "Montparnasse-Bienvenue Panne ascenseur situé Parking Oceane niveau -1 <> Hall 1 niveau 2, dir. Toutes Directions + TGV\nMontparnasse-Bienvenue Panne de l'ascenseur situé Parking Oceane niveau -1 <> Hall 1 niveau 2, direction Toutes Directions + TGV\nMontparnasse-Bienvenue Panne de l'ascenseur situé Parking Oceane niveau -1 <> Hall 1 niveau 2, direction Toutes Directions + TGV",
            severite: "perturbé",
          },
        ],
      },
      {
        genre: "marche",
        duree_secondes: 108,
        de: "Gare Montparnasse",
        vers: "Gare Montparnasse",
      },
      {
        genre: "attente",
        duree_secondes: 234,
        lieu: "Gare Montparnasse",
      },
      {
        genre: "ligne",
        ligne: { id: "C01374", label: "4", mode: "Métro" },
        destination: "Porte de Clignancourt",
        de: "Gare Montparnasse",
        vers: "Châtelet",
        de_id: "71139",
        vers_id: "71264",
        depart: "2026-10-29T17:25:46+01:00",
        arrivee: "2026-10-29T17:34:12+01:00",
        perturbations: [
          {
            title: "Panne d'un ascenseur",
            text: "Montparnasse-Bienvenue Panne ascenseur situé Parking Oceane niveau -1 <> Hall 1 niveau 2, dir. Toutes Directions + TGV\nMontparnasse-Bienvenue Panne de l'ascenseur situé Parking Oceane niveau -1 <> Hall 1 niveau 2, direction Toutes Directions + TGV\nMontparnasse-Bienvenue Panne de l'ascenseur situé Parking Oceane niveau -1 <> Hall 1 niveau 2, direction Toutes Directions + TGV",
            severite: "perturbé",
          },
          {
            title: "Panne d'un ascenseur",
            text: "Montparnasse-Bienvenue Panne ascenseur situé Parking Oceane niveau -1 <> Hall 1 niveau 2, dir. Toutes Directions + TGV\nMontparnasse-Bienvenue Panne de l'ascenseur situé Parking Oceane niveau -1 <> Hall 1 niveau 2, direction Toutes Directions + TGV\nMontparnasse-Bienvenue Panne de l'ascenseur situé Parking Oceane niveau -1 <> Hall 1 niveau 2, direction Toutes Directions + TGV",
            severite: "perturbé",
          },
        ],
      },
    ]);
    expect(JSON.stringify(itinerary)).not.toContain(
      "Arrêt intermédiaire perturbé",
    );
  });

  it("uses an empty Ligne id when Navitia has no Cxxxxx", async () => {
    const adapter = createPrimItineraire({
      apiKey: "test-key",
      fetch: async () =>
        jsonResponse({
          journeys: [
            {
              duration: 60,
              nb_transfers: 0,
              departure_date_time: "20261029T180000",
              arrival_date_time: "20261029T180100",
              status: "",
              sections: [
                {
                  type: "public_transport",
                  duration: 60,
                  departure_date_time: "20261029T180000",
                  arrival_date_time: "20261029T180100",
                  from: { name: "A" },
                  to: { name: "B" },
                  display_informations: {
                    name: "Navette",
                    commercial_mode: "Bus",
                    headsign: "Terminus",
                  },
                  links: [{ id: "line:IDFM:not-a-code", type: "line" }],
                },
              ],
            },
          ],
        }),
    });
    const result = await adapter.plan({
      depart: NATION,
      arrivee: CHATELET,
      horaire: new Date("2026-10-29T18:00:00+01:00"),
      sens: "depart",
      count: 3,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("expected ok");
    }
    expect(result.itineraires[0]?.etapes[0]).toMatchObject({
      genre: "ligne",
      ligne: { id: "", label: "Navette", mode: "Bus" },
    });
  });

  it("falls back to Perturbation when a disruption has no title channel", async () => {
    const adapter = createPrimItineraire({
      apiKey: "test-key",
      fetch: async () =>
        jsonResponse({
          journeys: [
            {
              duration: 60,
              nb_transfers: 0,
              departure_date_time: "20261029T180000",
              arrival_date_time: "20261029T180100",
              status: "",
              sections: [
                {
                  type: "public_transport",
                  duration: 60,
                  departure_date_time: "20261029T180000",
                  arrival_date_time: "20261029T180100",
                  from: { name: "A" },
                  to: { name: "B" },
                  display_informations: {
                    name: "1",
                    commercial_mode: "Métro",
                    headsign: "Terminus",
                    links: [{ id: "d1", type: "disruption", rel: "disruptions" }],
                  },
                  links: [{ id: "line:IDFM:C01373", type: "line" }],
                },
              ],
            },
          ],
          disruptions: [
            {
              id: "d1",
              severity: { effect: "NO_SERVICE" },
              messages: [{ text: "Station fermée.", channel: { name: "web" } }],
            },
          ],
        }),
    });
    const result = await adapter.plan({
      depart: NATION,
      arrivee: CHATELET,
      horaire: new Date("2026-10-29T18:00:00+01:00"),
      sens: "depart",
      count: 3,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("expected ok");
    }
    expect(result.itineraires[0]?.etapes[0]).toMatchObject({
      perturbations: [
        { title: "Perturbation", text: "Station fermée.", severite: "bloquant" },
      ],
    });
  });

  it("maps journey.status to Effet d'itinéraire", async () => {
    async function effetOf(status: string) {
      const adapter = createPrimItineraire({
        apiKey: "test-key",
        fetch: async () =>
          jsonResponse({
            journeys: [
              {
                duration: 1,
                nb_transfers: 0,
                departure_date_time: "20261029T180000",
                arrival_date_time: "20261029T180001",
                status,
                sections: [],
              },
            ],
          }),
      });
      const result = await adapter.plan({
        depart: NATION,
        arrivee: CHATELET,
        horaire: new Date("2026-10-29T18:00:00+01:00"),
        sens: "depart",
        count: 1,
      });
      if (result.kind !== "ok") {
        throw new Error("expected ok");
      }
      return result.itineraires[0]?.effet;
    }

    await expect(effetOf("NO_SERVICE")).resolves.toBe("aucun_service");
    await expect(effetOf("MODIFIED_SERVICE")).resolves.toBe("service_modifie");
    await expect(effetOf("SIGNIFICANT_DELAYS")).resolves.toBe("retards");
    await expect(effetOf("")).resolves.toBeUndefined();
  });

  it("maps no_solution, date_out_of_bounds and 500", async () => {
    const noSolution = createPrimItineraire({
      apiKey: "test-key",
      fetch: async () => jsonResponse(journeysNoSolution, 404),
    });
    await expect(
      noSolution.plan({
        depart: NATION,
        arrivee: CHATELET,
        horaire: new Date("2026-10-29T18:00:00+01:00"),
        sens: "depart",
        count: 3,
      }),
    ).resolves.toEqual({ kind: "aucun" });

    const outOfBounds = createPrimItineraire({
      apiKey: "test-key",
      fetch: async () => jsonResponse(journeysDateOutOfBounds, 404),
    });
    await expect(
      outOfBounds.plan({
        depart: NATION,
        arrivee: CHATELET,
        horaire: new Date("1990-01-01T08:00:00+01:00"),
        sens: "depart",
        count: 3,
      }),
    ).resolves.toEqual({ kind: "hors_calendrier" });

    const down = createPrimItineraire({
      apiKey: "test-key",
      fetch: async () => jsonResponse({ error: { message: "boom" } }, 500),
    });
    await expect(
      down.plan({
        depart: NATION,
        arrivee: CHATELET,
        horaire: new Date("2026-10-29T18:00:00+01:00"),
        sens: "depart",
        count: 3,
      }),
    ).resolves.toEqual({ kind: "indisponible" });
  });

  it("uses lon;lat for an address or coordinates Lieu", async () => {
    let requested: URL | undefined;
    const adapter = createPrimItineraire({
      apiKey: "test-key",
      fetch: async (url) => {
        requested = new URL(hrefOf(url));
        return jsonResponse({ journeys: [] });
      },
    });
    await adapter.plan({
      depart: {
        id: "2.36041;48.8555",
        label: "10 Rue de Rivoli (Paris)",
        genre: "adresse",
      },
      arrivee: {
        id: "2.2945;48.8584",
        label: "2.2945;48.8584",
        genre: "coordonnees",
      },
      horaire: new Date("2026-10-29T18:30:00+01:00"),
      sens: "arrivee",
      count: 3,
    });
    expect(requested?.searchParams.get("from")).toBe("2.36041;48.8555");
    expect(requested?.searchParams.get("to")).toBe("2.2945;48.8584");
    expect(requested?.searchParams.get("datetime_represents")).toBe("arrival");
  });
});
