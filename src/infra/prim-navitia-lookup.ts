import type { Ligne, NavitiaLookup, ZoneDarret } from "../application/index.js";

const PRIM_NAVITIA_BASE =
  "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia";

type PrimNavitiaLookupOptions = {
  apiKey: string;
  fetch?: typeof fetch;
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

function canonicalLineId(navitiaId: string): string {
  const match = /(C\d+)$/i.exec(navitiaId);
  return match?.[1]?.toUpperCase() ?? navitiaId;
}

function canonicalStopId(navitiaId: string): string {
  return navitiaId.replace(/^stop_area:IDFM:/i, "");
}

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

export function createPrimNavitiaLookup(
  options: PrimNavitiaLookupOptions,
): NavitiaLookup {
  const fetchFn = options.fetch ?? fetch;

  async function getJson(path: string, query: string): Promise<unknown> {
    const url = new URL(`${PRIM_NAVITIA_BASE}${path}`);
    url.searchParams.set("q", query);
    if (path === "/pt_objects") {
      url.searchParams.append("type[]", "line");
    } else {
      url.searchParams.append("type[]", "stop_area");
    }
    const response = await fetchFn(url, {
      headers: { "API Key": options.apiKey },
    });
    if (!response.ok) {
      throw new Error(`PRIM Navitia lookup failed: ${response.status}`);
    }
    return response.json();
  }

  return {
    async searchLines(query) {
      const body = (await getJson("/pt_objects", query)) as {
        pt_objects?: NavitiaPtObject[];
      };
      return (body.pt_objects ?? [])
        .filter((object) => object.embedded_type === "line" && object.line)
        .map((object) => toLigne(object.line!))
        .filter((ligne): ligne is Ligne => ligne !== undefined);
    },
    async searchStops(query) {
      const body = (await getJson("/places", query)) as {
        places?: NavitiaPlace[];
      };
      return (body.places ?? [])
        .filter((place) => place.embedded_type === "stop_area" && place.stop_area)
        .map((place) => toZoneDarret(place.stop_area!))
        .filter((stop): stop is ZoneDarret => stop !== undefined);
    },
  };
}
