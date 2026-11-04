import {
  canonicalLineId,
  canonicalStopId,
  formatIsoParis,
  type CalculItineraire,
  type EffetItineraire,
  type EtapeItineraire,
  type Itineraire,
  type Lieu,
  type PerturbationItineraire,
  type Severite,
} from "../domain/index.js";
import type { Logger } from "./logger.js";
import { silentLogger } from "./logger.js";
import { PRIM_FETCH_TIMEOUT_MS, primRequest } from "./prim-fetch.js";

const PRIM_NAVITIA_BASE =
  "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia";

type PrimItineraireOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  log?: Logger;
  timeoutMs?: number;
};

type NavitiaCoord = { lon?: string; lat?: string };

type NavitiaLink = {
  id?: string;
  rel?: string;
  type?: string;
};

type NavitiaStopArea = {
  id?: string;
  name?: string;
  physical_modes?: { name?: string }[];
  commercial_modes?: { name?: string }[];
  coord?: NavitiaCoord;
};

type NavitiaAddress = {
  id?: string;
  name?: string;
  label?: string;
  coord?: NavitiaCoord;
};

type NavitiaPlaceNode = {
  id?: string;
  name?: string;
  embedded_type?: string;
  stop_area?: NavitiaStopArea;
  stop_point?: {
    id?: string;
    name?: string;
    stop_area?: NavitiaStopArea;
  };
  address?: NavitiaAddress;
};

type NavitiaPlace = {
  embedded_type?: string;
  name?: string;
  stop_area?: NavitiaStopArea;
  address?: NavitiaAddress;
};

type NavitiaMessage = {
  text?: string;
  channel?: { id?: string; name?: string; types?: string[] };
};

type NavitiaDisruption = {
  id?: string;
  disruption_id?: string;
  severity?: { name?: string; effect?: string };
  messages?: NavitiaMessage[];
};

type NavitiaSection = {
  type?: string;
  mode?: string;
  duration?: number;
  departure_date_time?: string;
  arrival_date_time?: string;
  from?: NavitiaPlaceNode;
  to?: NavitiaPlaceNode;
  display_informations?: {
    label?: string;
    code?: string;
    name?: string;
    commercial_mode?: string;
    physical_mode?: string;
    headsign?: string;
    direction?: string;
    links?: NavitiaLink[];
  };
  links?: NavitiaLink[];
};

type NavitiaJourney = {
  duration?: number;
  nb_transfers?: number;
  departure_date_time?: string;
  arrival_date_time?: string;
  status?: string;
  sections?: NavitiaSection[];
};

type NavitiaJourneysResponse = {
  journeys?: NavitiaJourney[];
  disruptions?: NavitiaDisruption[];
  error?: { id?: string; message?: string };
};

function navitiaDateToIso(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }
  const wall = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
  for (const offset of ["+01:00", "+02:00"] as const) {
    const date = new Date(`${wall}${offset}`);
    if (formatIsoParis(date).startsWith(wall)) {
      return formatIsoParis(date);
    }
  }
  return `${wall}+01:00`;
}

function toNavitiaDatetime(date: Date): string {
  const iso = formatIsoParis(date);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!match) {
    return iso;
  }
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6]}`;
}

function isTitleChannel(channel: NavitiaMessage["channel"]): boolean {
  const tokens = [channel?.id, channel?.name, ...(channel?.types ?? [])]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  return tokens.some((token) => token === "titre" || token === "title");
}

function disruptionTitleAndText(disruption: NavitiaDisruption): {
  title: string;
  text: string;
} {
  const messages = disruption.messages ?? [];
  const titleMessage = messages.find((message) =>
    isTitleChannel(message.channel),
  );
  const bodyMessages = messages.filter((message) => message !== titleMessage);
  return {
    title: titleMessage?.text?.trim() || "Perturbation",
    text: bodyMessages
      .map((message) => message.text)
      .filter((text): text is string => Boolean(text))
      .join("\n"),
  };
}

function toSeverite(effect: string | undefined): Severite {
  switch (effect) {
    case "NO_SERVICE":
      return "bloquant";
    case "SIGNIFICANT_DELAYS":
    case "REDUCED_SERVICE":
    case "DETOUR":
    case "MODIFIED_SERVICE":
    case "ADDITIONAL_SERVICE":
    case "STOP_MOVED":
      return "perturbé";
    default:
      return "information";
  }
}

function toEffet(status: string | undefined): EffetItineraire | undefined {
  switch (status) {
    case "NO_SERVICE":
      return "aucun_service";
    case "MODIFIED_SERVICE":
      return "service_modifie";
    case "SIGNIFICANT_DELAYS":
      return "retards";
    default:
      return undefined;
  }
}

function isCanonicalStopId(query: string): boolean {
  return /^\d+$/.test(query);
}

function coordId(coord: NavitiaCoord | undefined): string | undefined {
  if (coord?.lon == null || coord?.lat == null) {
    return undefined;
  }
  return `${coord.lon};${coord.lat}`;
}

function toStopLieu(stopArea: NavitiaStopArea): Lieu | undefined {
  if (!stopArea.id) {
    return undefined;
  }
  const id = canonicalStopId(stopArea.id);
  return {
    id,
    label: stopArea.name ?? id,
    genre: "zone_d_arret",
    mode:
      stopArea.physical_modes?.[0]?.name ??
      stopArea.commercial_modes?.[0]?.name ??
      "",
  };
}

function toAddressLieu(place: NavitiaPlace): Lieu | undefined {
  const address = place.address;
  const id = coordId(address?.coord);
  if (!id) {
    return undefined;
  }
  return {
    id,
    label: address?.label ?? place.name ?? address?.name ?? id,
    genre: "adresse",
  };
}

function collectLieux(body: unknown): Lieu[] {
  const places =
    (body as { places?: NavitiaPlace[] } | undefined)?.places ?? [];
  const lieux: Lieu[] = [];
  for (const place of places) {
    if (place.embedded_type === "stop_area" && place.stop_area) {
      const lieu = toStopLieu(place.stop_area);
      if (lieu) {
        lieux.push(lieu);
      }
    } else if (place.embedded_type === "address") {
      const lieu = toAddressLieu(place);
      if (lieu) {
        lieux.push(lieu);
      }
    }
  }
  return lieux;
}

function lieuRef(lieu: Lieu): string {
  return lieu.genre === "zone_d_arret" ? `stop_area:IDFM:${lieu.id}` : lieu.id;
}

function placeName(node: NavitiaPlaceNode | undefined): string {
  if (!node) {
    return "";
  }
  return (
    node.stop_point?.stop_area?.name ??
    node.stop_area?.name ??
    node.stop_point?.name ??
    node.address?.label ??
    node.address?.name ??
    node.name ??
    ""
  );
}

function placeStopId(node: NavitiaPlaceNode | undefined): string | undefined {
  const navitiaId = node?.stop_point?.stop_area?.id ?? node?.stop_area?.id;
  if (!navitiaId) {
    return undefined;
  }
  const id = canonicalStopId(navitiaId);
  return id || undefined;
}

function lineIdOf(section: NavitiaSection): string {
  const link = (section.links ?? []).find(
    (item) => item.type === "line" && item.id,
  );
  if (!link?.id) {
    return "";
  }
  const id = canonicalLineId(link.id);
  return /^C\d+$/i.test(id) ? id : "";
}

function isWalk(section: NavitiaSection): boolean {
  if (section.type === "transfer") {
    return true;
  }
  if (section.type === "crow_fly") {
    return (section.duration ?? 0) > 0;
  }
  return section.type === "street_network" && section.mode === "walking";
}

function isDropped(section: NavitiaSection): boolean {
  const type = section.type ?? "";
  if (type === "crow_fly" && (section.duration ?? 0) === 0) {
    return true;
  }
  return (
    type === "stay_in" ||
    type === "boarding" ||
    type === "alighting" ||
    type === "park" ||
    type.startsWith("bss_") ||
    type === "ridesharing"
  );
}

function disruptionIndex(
  disruptions: NavitiaDisruption[],
): Map<string, NavitiaDisruption> {
  const byId = new Map<string, NavitiaDisruption>();
  for (const disruption of disruptions) {
    for (const key of [disruption.id, disruption.disruption_id]) {
      if (key) {
        byId.set(key, disruption);
      }
    }
  }
  return byId;
}

function perturbationsOf(
  section: NavitiaSection,
  byId: Map<string, NavitiaDisruption>,
): PerturbationItineraire[] | undefined {
  const links = section.display_informations?.links ?? [];
  const seen = new Set<NavitiaDisruption>();
  const perturbations: PerturbationItineraire[] = [];
  for (const link of links) {
    if (link.type !== "disruption" && link.rel !== "disruptions") {
      continue;
    }
    if (!link.id) {
      continue;
    }
    const disruption = byId.get(link.id);
    if (!disruption || seen.has(disruption)) {
      continue;
    }
    seen.add(disruption);
    const { title, text } = disruptionTitleAndText(disruption);
    perturbations.push({
      title,
      text,
      severite: toSeverite(disruption.severity?.effect),
    });
  }
  return perturbations.length > 0 ? perturbations : undefined;
}

function foldSections(
  sections: NavitiaSection[],
  byId: Map<string, NavitiaDisruption>,
): EtapeItineraire[] {
  const etapes: EtapeItineraire[] = [];
  let lastPlace = "";
  for (const section of sections) {
    if (isDropped(section)) {
      continue;
    }
    if (isWalk(section)) {
      const duree = section.duration ?? 0;
      if (duree <= 0) {
        continue;
      }
      const de = placeName(section.from) || lastPlace;
      const vers = placeName(section.to) || de;
      const previous = etapes.at(-1);
      if (previous?.genre === "marche") {
        previous.duree_secondes += duree;
        previous.vers = vers;
      } else {
        etapes.push({ genre: "marche", duree_secondes: duree, de, vers });
      }
      lastPlace = vers;
      continue;
    }
    if (section.type === "waiting") {
      const lieu =
        placeName(section.from) || placeName(section.to) || lastPlace;
      etapes.push({
        genre: "attente",
        duree_secondes: section.duration ?? 0,
        lieu,
      });
      continue;
    }
    if (
      section.type === "public_transport" ||
      section.type === "on_demand_transport"
    ) {
      const de = placeName(section.from);
      const vers = placeName(section.to);
      const deId = placeStopId(section.from);
      const versId = placeStopId(section.to);
      const info = section.display_informations;
      const etape: Extract<EtapeItineraire, { genre: "ligne" }> = {
        genre: "ligne",
        ligne: {
          id: lineIdOf(section),
          label: info?.name ?? info?.label ?? info?.code ?? "",
          mode: info?.commercial_mode ?? info?.physical_mode ?? "",
        },
        destination: info?.headsign ?? info?.direction ?? "",
        de,
        vers,
        depart: section.departure_date_time
          ? navitiaDateToIso(section.departure_date_time)
          : "",
        arrivee: section.arrival_date_time
          ? navitiaDateToIso(section.arrival_date_time)
          : "",
      };
      if (deId) {
        etape.de_id = deId;
      }
      if (versId) {
        etape.vers_id = versId;
      }
      const perturbations = perturbationsOf(section, byId);
      if (perturbations) {
        etape.perturbations = perturbations;
      }
      etapes.push(etape);
      lastPlace = vers;
    }
  }
  return etapes;
}

function toItineraire(
  journey: NavitiaJourney,
  byId: Map<string, NavitiaDisruption>,
): Itineraire {
  const itineraire: Itineraire = {
    depart: journey.departure_date_time
      ? navitiaDateToIso(journey.departure_date_time)
      : "",
    arrivee: journey.arrival_date_time
      ? navitiaDateToIso(journey.arrival_date_time)
      : "",
    duree_secondes: journey.duration ?? 0,
    changements: journey.nb_transfers ?? 0,
    etapes: foldSections(journey.sections ?? [], byId),
  };
  const effet = toEffet(journey.status);
  if (effet) {
    itineraire.effet = effet;
  }
  return itineraire;
}

function calculationOf(body: NavitiaJourneysResponse): CalculItineraire {
  const errorId = body.error?.id;
  if (errorId === "no_solution") {
    return { kind: "aucun" };
  }
  if (errorId === "date_out_of_bounds") {
    return { kind: "hors_calendrier" };
  }
  if (
    errorId === "no_origin" ||
    errorId === "no_destination" ||
    errorId === "unknown_object"
  ) {
    return { kind: "lieu_inconnu" };
  }
  if (errorId) {
    return { kind: "indisponible" };
  }
  const journeys = body.journeys ?? [];
  if (journeys.length === 0) {
    return { kind: "aucun" };
  }
  const byId = disruptionIndex(body.disruptions ?? []);
  return {
    kind: "ok",
    itineraires: journeys.map((journey) => toItineraire(journey, byId)),
  };
}

export function createPrimItineraire(options: PrimItineraireOptions): {
  searchLieux(query: string, limit: number): Promise<Lieu[]>;
  plan(input: {
    depart: Lieu;
    arrivee: Lieu;
    horaire: Date;
    sens: "depart" | "arrivee";
    count: number;
  }): Promise<CalculItineraire>;
} {
  const fetchFn = options.fetch ?? fetch;
  const log = options.log ?? silentLogger;
  const timeoutMs = options.timeoutMs ?? PRIM_FETCH_TIMEOUT_MS;

  async function requestJson(
    url: URL,
  ): Promise<{ ok: true; body: unknown } | { ok: false; status: number; body: unknown }> {
    const response = await primRequest(
      url,
      options.apiKey,
      fetchFn,
      log,
      timeoutMs,
    );
    let body: unknown = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (response.ok) {
      return { ok: true, body };
    }
    return { ok: false, status: response.status, body };
  }

  return {
    async searchLieux(query, limit) {
      if (isCanonicalStopId(query)) {
        const url = new URL(
          `${PRIM_NAVITIA_BASE}/places/${encodeURIComponent(`stop_area:IDFM:${query}`)}`,
        );
        const result = await requestJson(url);
        if (!result.ok) {
          if (result.status === 404) {
            return [];
          }
          throw new Error(`PRIM Navitia places failed: ${result.status}`);
        }
        const matches = collectLieux(result.body);
        log.info({ query, matches: matches.length }, "PRIM Navitia lieu lookup");
        return matches;
      }
      const url = new URL(`${PRIM_NAVITIA_BASE}/places`);
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(limit));
      url.searchParams.append("type[]", "stop_area");
      url.searchParams.append("type[]", "address");
      const result = await requestJson(url);
      if (!result.ok) {
        if (result.status === 404) {
          return [];
        }
        throw new Error(`PRIM Navitia places failed: ${result.status}`);
      }
      const matches = collectLieux(result.body);
      log.info({ query, matches: matches.length }, "PRIM Navitia lieu lookup");
      return matches;
    },

    async plan(input) {
      const url = new URL(`${PRIM_NAVITIA_BASE}/journeys`);
      url.searchParams.set("from", lieuRef(input.depart));
      url.searchParams.set("to", lieuRef(input.arrivee));
      url.searchParams.set("datetime", toNavitiaDatetime(input.horaire));
      url.searchParams.set(
        "datetime_represents",
        input.sens === "arrivee" ? "arrival" : "departure",
      );
      url.searchParams.set("count", String(input.count));
      url.searchParams.set("data_freshness", "realtime");
      url.searchParams.append("first_section_mode[]", "walking");
      url.searchParams.append("last_section_mode[]", "walking");
      url.searchParams.set("disable_geojson", "true");
      url.searchParams.set("depth", "1");
      let result: Awaited<ReturnType<typeof requestJson>>;
      try {
        result = await requestJson(url);
      } catch {
        return { kind: "indisponible" };
      }
      if (!result.ok && result.status !== 404) {
        return { kind: "indisponible" };
      }
      const calculation = calculationOf(result.body as NavitiaJourneysResponse);
      log.info(
        {
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          kind: calculation.kind,
        },
        "PRIM Navitia journeys",
      );
      return calculation;
    },
  };
}
