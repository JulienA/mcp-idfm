import type { ZoneDeCorrespondance } from "../domain/index.js";
import type { Logger } from "./logger.js";
import { silentLogger } from "./logger.js";

const DATASETS =
  "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

const MODE_LABELS: Record<string, string> = {
  metroStation: "Métro",
  railStation: "Ferroviaire",
  onstreetBus: "Bus",
  busStation: "Bus",
  tramStation: "Tramway",
};

type PrimZoneCorrespondanceOptions = {
  fetch?: typeof fetch;
  log?: Logger;
};

type CorrespondanceRecord = {
  zdcid?: string;
  zdcname?: string;
  zdctype?: string;
};

type RecordsBody = {
  total_count?: number;
  results?: CorrespondanceRecord[];
};

function odsString(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function isReferentialId(query: string): boolean {
  return /^\d+$/.test(query);
}

function toZone(record: CorrespondanceRecord): ZoneDeCorrespondance | undefined {
  if (!record.zdcid) {
    return undefined;
  }
  const name = record.zdcname ?? record.zdcid;
  const type = record.zdctype ?? "";
  return {
    id: record.zdcid,
    label: name,
    mode: MODE_LABELS[type] ?? type,
    siri_monitoring_ref: `STIF:StopArea:SP:${record.zdcid}:`,
  };
}

export function createPrimZoneCorrespondanceLookup(
  options: PrimZoneCorrespondanceOptions = {},
): { search(query: string): Promise<ZoneDeCorrespondance[]> } {
  const fetchFn = options.fetch ?? fetch;
  const log = options.log ?? silentLogger;

  async function records(
    dataset: string,
    where: string,
    select: string,
    offset: number,
    limit: number,
  ): Promise<RecordsBody> {
    const url = new URL(`${DATASETS}/${dataset}/records`);
    url.searchParams.set("where", where);
    url.searchParams.set("select", select);
    url.searchParams.set("limit", String(limit));
    if (offset > 0) {
      url.searchParams.set("offset", String(offset));
    }
    let response: Response;
    try {
      response = await fetchFn(url, {
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      log.error(
        { err: error, path: `${url.pathname}${url.search}` },
        "Zone de correspondance lookup error",
      );
      throw error;
    }
    if (!response.ok) {
      log.warn(
        { path: `${url.pathname}${url.search}`, status: response.status },
        "Zone de correspondance lookup failed",
      );
      throw new Error(
        `Référentiel zones de correspondance failed: ${response.status}`,
      );
    }
    return (await response.json()) as RecordsBody;
  }

  async function allZones(where: string): Promise<ZoneDeCorrespondance[]> {
    const zones: ZoneDeCorrespondance[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = await records(
        "zones-de-correspondance",
        where,
        "zdcid,zdcname,zdctype",
        page * PAGE_SIZE,
        PAGE_SIZE,
      );
      const batch = body.results ?? [];
      for (const record of batch) {
        const zone = toZone(record);
        if (zone) {
          zones.push(zone);
        }
      }
      const total =
        typeof body.total_count === "number" ? body.total_count : undefined;
      if (batch.length < PAGE_SIZE) {
        break;
      }
      if (total !== undefined && zones.length >= total) {
        break;
      }
    }
    const seen = new Set<string>();
    return zones.filter((zone) => {
      if (seen.has(zone.id)) {
        return false;
      }
      seen.add(zone.id);
      return true;
    });
  }

  return {
    async search(query) {
      let matches: ZoneDeCorrespondance[];
      if (isReferentialId(query)) {
        matches = await allZones(`zdcid=${odsString(query)}`);
        if (matches.length === 0) {
          const relations = await records(
            "relations",
            `zdaid=${odsString(query)}`,
            "zdcid",
            0,
            1,
          );
          const parent = relations.results?.[0]?.zdcid;
          matches = parent ? await allZones(`zdcid=${odsString(parent)}`) : [];
        }
      } else {
        const literal = query.replace(/[%_]/g, "");
        matches = literal
          ? await allZones(`zdcname like ${odsString(`%${literal}%`)}`)
          : [];
      }
      log.info(
        { query, matches: matches.length },
        "Zone de correspondance lookup",
      );
      return matches;
    },
  };
}
