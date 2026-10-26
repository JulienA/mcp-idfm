import {
  canonicalLineId,
  canonicalStopId,
  type Ligne,
  type ZoneDarret,
} from "../domain/index.js";
import type { Logger } from "./logger.js";
import { silentLogger } from "./logger.js";
import { primRequest } from "./prim-fetch.js";

const PRIM_NAVITIA_BASE =
  "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia";

const PT_OBJECTS_PAGE_SIZE = 1000;
const PLACES_PAGE_SIZE = 200;
const MAX_SEARCH_PAGES = 20;

type NavitiaPagination = {
  items_per_page?: number;
  total_result?: number;
};

function paginationOf(body: unknown): NavitiaPagination {
  const pagination = (body as { pagination?: NavitiaPagination }).pagination;
  return pagination ?? {};
}

function positiveInt(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

type PrimNavitiaLookupOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  log?: Logger;
};

type NavitiaLine = {
  id?: string;
  name?: string;
  code?: string;
  commercial_mode?: { name?: string };
};

type NavitiaPtObject = {
  embedded_type?: string;
  line?: NavitiaLine;
};

type NavitiaStopArea = {
  id?: string;
  name?: string;
  physical_modes?: { name?: string }[];
  commercial_modes?: { name?: string }[];
};

type NavitiaPlace = {
  embedded_type?: string;
  stop_area?: NavitiaStopArea;
};

function toLigne(line: NavitiaLine): Ligne | undefined {
  if (!line.id) {
    return undefined;
  }
  const id = canonicalLineId(line.id);
  return {
    id,
    label: line.name ?? line.code ?? id,
    mode: line.commercial_mode?.name ?? "",
    siri_line_ref: `STIF:Line::${id}:`,
    navitia_id: line.id,
  };
}

function toZoneDarret(stopArea: NavitiaStopArea): ZoneDarret | undefined {
  if (!stopArea.id) {
    return undefined;
  }
  const id = canonicalStopId(stopArea.id);
  return {
    id,
    label: stopArea.name ?? id,
    mode:
      stopArea.physical_modes?.[0]?.name ??
      stopArea.commercial_modes?.[0]?.name ??
      "",
    siri_monitoring_ref: `STIF:StopArea:SP:${id}:`,
    navitia_id: stopArea.id,
  };
}

function collectStops(body: unknown): ZoneDarret[] {
  const places = (body as { places?: NavitiaPlace[] } | undefined)?.places ?? [];
  return places
    .filter((place) => place.embedded_type === "stop_area" && place.stop_area)
    .map((place) => toZoneDarret(place.stop_area!))
    .filter((stop): stop is ZoneDarret => stop !== undefined);
}

function isCanonicalStopId(query: string): boolean {
  return /^\d+$/.test(query);
}

function isCanonicalLineId(query: string): boolean {
  return /^C\d+$/i.test(query);
}

export function createPrimNavitiaLookup(
  options: PrimNavitiaLookupOptions,
): {
  searchLines(query: string): Promise<Ligne[]>;
  searchStops(query: string): Promise<ZoneDarret[]>;
} {
  const fetchFn = options.fetch ?? fetch;
  const log = options.log ?? silentLogger;

  async function requestJson(url: URL): Promise<unknown | undefined> {
    const response = await primRequest(url, options.apiKey, fetchFn, log);
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`PRIM Navitia lookup failed: ${response.status}`);
    }
    return response.json();
  }

  async function searchPage(
    path: string,
    query: string,
    startPage: number,
  ): Promise<unknown> {
    const url = new URL(`${PRIM_NAVITIA_BASE}${path}`);
    url.searchParams.set("q", query);
    url.searchParams.set(
      "count",
      String(path === "/places" ? PLACES_PAGE_SIZE : PT_OBJECTS_PAGE_SIZE),
    );
    if (path === "/pt_objects") {
      url.searchParams.append("type[]", "line");
    } else {
      url.searchParams.append("type[]", "stop_area");
    }
    if (startPage > 0) {
      url.searchParams.set("start_page", String(startPage));
    }
    return (await requestJson(url)) ?? {};
  }

  async function searchAllPages<T>(
    path: string,
    query: string,
    collect: (body: unknown) => T[],
  ): Promise<T[]> {
    const first = await searchPage(path, query, 0);
    const pages = [first];
    const firstItems = collect(first);
    const pagination = paginationOf(first);
    const total = positiveInt(pagination.total_result) ?? firstItems.length;
    const pageSize =
      positiveInt(pagination.items_per_page) ?? firstItems.length;
    if (pageSize > 0 && total > pageSize) {
      const pageCount = Math.min(Math.ceil(total / pageSize), MAX_SEARCH_PAGES);
      for (let page = 1; page < pageCount; page += 1) {
        pages.push(await searchPage(path, query, page));
      }
    }
    return pages.flatMap(collect);
  }

  async function resourceJson(path: string): Promise<unknown | undefined> {
    return requestJson(new URL(`${PRIM_NAVITIA_BASE}${path}`));
  }

  return {
    async searchLines(query) {
      let matches: Ligne[];
      if (isCanonicalLineId(query)) {
        const body = (await resourceJson(
          `/lines/${encodeURIComponent(`line:IDFM:${query.toUpperCase()}`)}`,
        )) as { lines?: NavitiaLine[] } | undefined;
        matches = (body?.lines ?? [])
          .map(toLigne)
          .filter((ligne): ligne is Ligne => ligne !== undefined);
      } else {
        matches = await searchAllPages("/pt_objects", query, (body) => {
          const objects =
            (body as { pt_objects?: NavitiaPtObject[] }).pt_objects ?? [];
          return objects
            .filter((object) => object.embedded_type === "line" && object.line)
            .map((object) => toLigne(object.line!))
            .filter((ligne): ligne is Ligne => ligne !== undefined);
        });
      }
      log.info({ query, matches: matches.length }, "PRIM Navitia line lookup");
      return matches;
    },
    async searchStops(query) {
      const matches = isCanonicalStopId(query)
        ? collectStops(
            await resourceJson(
              `/places/${encodeURIComponent(`stop_area:IDFM:${query}`)}`,
            ),
          )
        : await searchAllPages("/places", query, collectStops);
      log.info({ query, matches: matches.length }, "PRIM Navitia stop lookup");
      return matches;
    },
  };
}
