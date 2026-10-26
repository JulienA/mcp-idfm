import type {
  InfoTraficMessage,
  InfoTraficSnapshot,
  Severite,
} from "../application/index.js";
import { canonicalLineId, canonicalStopId } from "../ids.js";
import { formatIsoParis } from "../iso-paris.js";
import { primFetchInit } from "./prim-fetch.js";

const PRIM_TRAFFIC_REPORTS_URL =
  "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/traffic_reports";

const PAGE_SIZE = 1000;

type PrimTrafficReportsOptions = {
  apiKey: string;
  fetch?: typeof fetch;
};

type NavitiaLink = {
  id?: string;
  rel?: string;
  type?: string;
};

type NavitiaLine = {
  id?: string;
  name?: string;
  code?: string;
  links?: NavitiaLink[];
};

type NavitiaStopArea = {
  id?: string;
  name?: string;
  links?: NavitiaLink[];
};

type NavitiaPtObject = {
  embedded_type?: string;
  id?: string;
  name?: string;
  line?: NavitiaLine;
  stop_area?: NavitiaStopArea;
};

type NavitiaMessage = {
  text?: string;
  channel?: { id?: string; name?: string; types?: string[] };
};

type NavitiaDisruption = {
  id?: string;
  disruption_id?: string;
  status?: string;
  cause?: string;
  category?: string;
  severity?: { name?: string; effect?: string };
  messages?: NavitiaMessage[];
  application_periods?: { begin?: string; end?: string }[];
  impacted_objects?: { pt_object?: NavitiaPtObject }[];
};

type NavitiaTrafficReport = {
  lines?: NavitiaLine[];
  stop_areas?: NavitiaStopArea[];
};

type NavitiaTrafficReportsResponse = {
  disruptions?: NavitiaDisruption[];
  traffic_reports?: NavitiaTrafficReport[];
  pagination?: { total_result?: number };
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
    title: titleMessage?.text?.trim() || "Info Trafic",
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

function disruptionKeys(disruption: NavitiaDisruption): string[] {
  return [disruption.id, disruption.disruption_id].filter(
    (key): key is string => Boolean(key),
  );
}

function isDisruptionLink(link: NavitiaLink): boolean {
  return link.type === "disruption" || link.rel === "disruptions";
}

function lineLabel(line: NavitiaLine, fallbackId: string): string {
  return line.name ?? line.code ?? fallbackId;
}

function toMessages(pages: NavitiaTrafficReportsResponse[]): InfoTraficMessage[] {
  const disruptions = new Map<string, NavitiaDisruption>();
  for (const page of pages) {
    for (const disruption of page.disruptions ?? []) {
      for (const key of disruptionKeys(disruption)) {
        disruptions.set(key, disruption);
      }
    }
  }

  const ligneIdsByKey = new Map<string, Set<string>>();
  const ligneLabels = new Map<string, string>();
  const stopIdsByKey = new Map<string, Map<string, string>>();

  function addLigne(keys: string[], line: NavitiaLine): void {
    if (!line.id) {
      return;
    }
    const id = canonicalLineId(line.id);
    ligneLabels.set(id, lineLabel(line, id));
    for (const key of keys) {
      const set = ligneIdsByKey.get(key) ?? new Set<string>();
      set.add(id);
      ligneIdsByKey.set(key, set);
    }
  }

  function addStop(keys: string[], stop: NavitiaStopArea): void {
    if (!stop.id) {
      return;
    }
    const id = canonicalStopId(stop.id);
    for (const key of keys) {
      const map = stopIdsByKey.get(key) ?? new Map<string, string>();
      map.set(id, stop.name ?? id);
      stopIdsByKey.set(key, map);
    }
  }

  for (const page of pages) {
    for (const report of page.traffic_reports ?? []) {
      for (const line of report.lines ?? []) {
        const keys = (line.links ?? [])
          .filter(isDisruptionLink)
          .map((link) => link.id)
          .filter((id): id is string => Boolean(id));
        addLigne(keys, line);
      }
      for (const stop of report.stop_areas ?? []) {
        const keys = (stop.links ?? [])
          .filter(isDisruptionLink)
          .map((link) => link.id)
          .filter((id): id is string => Boolean(id));
        addStop(keys, stop);
        for (const line of report.lines ?? []) {
          addLigne(keys, line);
        }
      }
    }
  }

  const seen = new Set<NavitiaDisruption>();
  const messages: InfoTraficMessage[] = [];

  for (const disruption of disruptions.values()) {
    if (seen.has(disruption) || disruption.status === "past") {
      continue;
    }
    seen.add(disruption);

    const keys = disruptionKeys(disruption);
    const ligneIds = new Set<string>();
    const impactedLignes = new Map<string, string>();
    const impactedStops = new Map<string, string>();

    for (const key of keys) {
      for (const id of ligneIdsByKey.get(key) ?? []) {
        ligneIds.add(id);
        impactedLignes.set(id, ligneLabels.get(id) ?? id);
      }
      for (const [id, label] of stopIdsByKey.get(key) ?? []) {
        impactedStops.set(id, label);
      }
    }

    for (const impacted of disruption.impacted_objects ?? []) {
      const object = impacted.pt_object;
      if (!object) {
        continue;
      }
      if (object.embedded_type === "line" || object.line || object.id?.includes("line:")) {
        const navitiaId = object.line?.id ?? object.id;
        if (!navitiaId) {
          continue;
        }
        const id = canonicalLineId(navitiaId);
        ligneIds.add(id);
        impactedLignes.set(id, lineLabel(object.line ?? {}, object.name ?? id));
      }
      if (
        object.embedded_type === "stop_area" ||
        object.stop_area ||
        object.id?.startsWith("stop_area:")
      ) {
        const navitiaId = object.stop_area?.id ?? object.id;
        if (!navitiaId) {
          continue;
        }
        const id = canonicalStopId(navitiaId);
        impactedStops.set(id, object.stop_area?.name ?? object.name ?? id);
      }
    }

    const { title, text } = disruptionTitleAndText(disruption);
    messages.push({
      title,
      text,
      severite: toSeverite(disruption.severity?.effect),
      cause: disruption.cause ?? disruption.category ?? "",
      application_periods: (disruption.application_periods ?? [])
        .filter((period) => period.begin && period.end)
        .map((period) => ({
          begin: navitiaDateToIso(period.begin!),
          end: navitiaDateToIso(period.end!),
        })),
      impacted_lignes: [...impactedLignes].map(([id, label]) => ({ id, label })),
      impacted_stops: [...impactedStops].map(([id, label]) => ({ id, label })),
      ligne_ids: [...ligneIds],
    });
  }

  return messages;
}

export function createPrimTrafficReports(
  options: PrimTrafficReportsOptions,
): InfoTraficSnapshot {
  const fetchFn = options.fetch ?? fetch;

  async function fetchPage(
    startPage: number,
  ): Promise<NavitiaTrafficReportsResponse> {
    const url = new URL(PRIM_TRAFFIC_REPORTS_URL);
    url.searchParams.set("count", String(PAGE_SIZE));
    url.searchParams.set("disable_geojson", "true");
    url.searchParams.set("depth", "1");
    if (startPage > 0) {
      url.searchParams.set("start_page", String(startPage));
    }
    const response = await fetchFn(url, primFetchInit(options.apiKey));
    if (!response.ok) {
      throw new Error(`PRIM traffic_reports failed: ${response.status}`);
    }
    return (await response.json()) as NavitiaTrafficReportsResponse;
  }

  return {
    async fetch() {
      const first = await fetchPage(0);
      const pages = [first];
      const total = first.pagination?.total_result ?? 0;
      if (total > PAGE_SIZE) {
        const pageCount = Math.ceil(total / PAGE_SIZE);
        for (let page = 1; page < pageCount; page += 1) {
          pages.push(await fetchPage(page));
        }
      }
      return toMessages(pages);
    },
  };
}
