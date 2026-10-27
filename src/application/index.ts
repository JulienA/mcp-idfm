import {
  formatIsoParis,
  SOURCE,
  type IdentityCandidate,
  type InfoTraficMessage,
  type InfoTraficResult,
  type LineIdentityResult,
  type Ligne,
  type PassageGroup,
  type ProchainPassage,
  type ProchainPassageResult,
  type StopIdentityResult,
  type ZoneDarret,
  type ZoneDarretFiche,
  type ZoneDeCorrespondance,
} from "../domain/index.js";
import {
  createReferentialCache,
  type ReferentialCache,
} from "./referential-cache.js";

export type {
  IdentityCandidate,
  InfoTraficMessage,
  InfoTraficResult,
  LineIdentityResult,
  Ligne,
  PassageGroup,
  ProchainPassage,
  ProchainPassageResult,
  Severite,
  StatutDePassage,
  StopIdentityResult,
  ZoneDarret,
  ZoneDarretFiche,
  ZoneDeCorrespondance,
} from "../domain/index.js";
export { SOURCE } from "../domain/index.js";

export type NavitiaLookup = {
  searchLines(query: string): Promise<Ligne[]>;
  searchStops(query: string): Promise<ZoneDarret[]>;
};

export type CorrespondanceLookup = {
  search(query: string): Promise<ZoneDeCorrespondance[]>;
};

export type StopMonitoring = {
  getPassages(monitoringRef: string): Promise<ProchainPassage[]>;
};

export type Clock = {
  now(): Date;
};

export type InfoTraficSnapshot = {
  fetch(): Promise<InfoTraficMessage[]>;
};

export class SnapshotUnavailableError extends Error {
  constructor() {
    super("Info Trafic indisponible");
    this.name = "SnapshotUnavailableError";
  }
}

export class LookupUnavailableError extends Error {
  constructor() {
    super("Recherche indisponible");
    this.name = "LookupUnavailableError";
  }
}

function toStopFiche(stop: ZoneDarret): ZoneDarretFiche {
  return {
    id: stop.id,
    label: stop.label,
    siri_monitoring_ref: stop.siri_monitoring_ref,
    navitia_id: stop.navitia_id,
  };
}

function normalizeLineQuery(query: string): string {
  const trimmed = query.trim();
  const navitia = /^line:IDFM:(C\d+)$/i.exec(trimmed);
  if (navitia?.[1]) {
    return navitia[1].toUpperCase();
  }
  const siri = /^STIF:Line::(C\d+):?$/i.exec(trimmed);
  if (siri?.[1]) {
    return siri[1].toUpperCase();
  }
  return trimmed;
}

function normalizeStopQuery(query: string): string {
  const trimmed = query.trim();
  const navitia = /^stop_area:IDFM:(.+)$/i.exec(trimmed);
  if (navitia?.[1]) {
    return navitia[1];
  }
  const siri = /^STIF:StopArea:SP:([^:]+):?$/i.exec(trimmed);
  if (siri?.[1]) {
    return siri[1];
  }
  return trimmed;
}

function messageLigneIds(message: InfoTraficMessage): string[] {
  return [
    ...(message.ligne_ids ?? []),
    ...message.impacted_lignes.map((ligne) => ligne.id),
  ];
}

function toPublicMessage(message: InfoTraficMessage): InfoTraficMessage {
  const { ligne_ids: _ligneIds, ...publicMessage } = message;
  return publicMessage;
}

function matchedLignes(identity: Extract<LineIdentityResult, { status: "ok" }>): Ligne[] {
  return "fiche" in identity ? [identity.fiche] : identity.fiches;
}

async function cachedSearch<T>(
  cache: ReferentialCache<T[]>,
  key: string,
  search: () => Promise<T[]>,
): Promise<T[]> {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const matches = await search();
  cache.set(key, matches);
  return matches;
}

function toCandidates(
  matches: { id: string; label: string; mode: string }[],
): IdentityCandidate[] {
  return matches.map(({ id, label, mode }) => ({ id, label, mode }));
}

type MatchDecision<T> =
  | { kind: "none" }
  | { kind: "one"; item: T }
  | { kind: "few"; items: T[] }
  | { kind: "many"; items: T[] };

export const DEFAULT_MAX_CANDIDATES = 5;
export const DEFAULT_MAX_PASSAGES_PER_GROUP = 5;
export const DEFAULT_MAX_PASSAGES = 30;

function decideMatches<T>(
  matches: T[],
  maxCandidates: number,
): MatchDecision<T> {
  if (matches.length === 0) {
    return { kind: "none" };
  }
  if (matches.length === 1) {
    return { kind: "one", item: matches[0]! };
  }
  if (matches.length > maxCandidates) {
    return { kind: "many", items: matches };
  }
  return { kind: "few", items: matches };
}

export function createApplication(deps: {
  lookup: NavitiaLookup;
  correspondances?: CorrespondanceLookup;
  clock?: Clock;
  snapshot?: InfoTraficSnapshot;
  stopMonitoring?: StopMonitoring;
  maxCandidates?: number;
  maxPassagesPerGroup?: number;
  maxPassages?: number;
}) {
  const maxCandidates = positiveInt(
    deps.maxCandidates,
    DEFAULT_MAX_CANDIDATES,
  );
  const maxPassagesPerGroup = positiveInt(
    deps.maxPassagesPerGroup,
    DEFAULT_MAX_PASSAGES_PER_GROUP,
  );
  const maxPassages = positiveInt(deps.maxPassages, DEFAULT_MAX_PASSAGES);
  const clock = deps.clock ?? { now: () => new Date() };
  const epochMs = () => clock.now().getTime();
  const stopMonitoring = deps.stopMonitoring ?? {
    async getPassages(): Promise<ProchainPassage[]> {
      throw new Error("SIRI stop-monitoring adapter is required");
    },
  };
  const correspondances = deps.correspondances ?? {
    async search(): Promise<ZoneDeCorrespondance[]> {
      throw new Error("Zone de correspondance lookup is required");
    },
  };
  const lineCache = createReferentialCache<Ligne[]>(epochMs);
  const stopCache = createReferentialCache<ZoneDarret[]>(epochMs);
  const correspondanceCache =
    createReferentialCache<ZoneDeCorrespondance[]>(epochMs);
  let snapshotState:
    | { messages: InfoTraficMessage[]; updatedAt: Date; stale: boolean }
    | undefined;

  const app = {
    async getLineId(query: string): Promise<LineIdentityResult> {
      const normalized = normalizeLineQuery(query);
      if (!normalized) {
        return {
          status: "not_found",
          message: "Aucune Ligne correspondante",
          source: SOURCE,
        };
      }
      let matches: Ligne[];
      try {
        matches = await cachedSearch(lineCache, normalized, () =>
          deps.lookup.searchLines(normalized),
        );
      } catch {
        throw new LookupUnavailableError();
      }
      const decision = decideMatches(matches, maxCandidates);
      switch (decision.kind) {
        case "none":
          return {
            status: "not_found",
            message: "Aucune Ligne correspondante",
            source: SOURCE,
          };
        case "one":
          return { status: "ok", fiche: decision.item, source: SOURCE };
        case "many":
          return {
            status: "needs_clarification",
            candidates: toCandidates(decision.items),
            source: SOURCE,
          };
        case "few":
          return { status: "ok", fiches: decision.items, source: SOURCE };
      }
    },

    async refreshSnapshot(): Promise<void> {
      if (!deps.snapshot) {
        return;
      }
      try {
        const messages = await deps.snapshot.fetch();
        snapshotState = {
          messages,
          updatedAt: clock.now(),
          stale: false,
        };
      } catch {
        if (snapshotState) {
          snapshotState = { ...snapshotState, stale: true };
        }
      }
    },

    async getInfoTrafic(query: string): Promise<InfoTraficResult> {
      const identity = await app.getLineId(query);
      if (identity.status !== "ok") {
        return identity;
      }
      if (!snapshotState) {
        throw new SnapshotUnavailableError();
      }
      const ligneIds = new Set(matchedLignes(identity).map((ligne) => ligne.id));
      const messages = snapshotState.messages
        .filter((message) =>
          messageLigneIds(message).some((id) => ligneIds.has(id)),
        )
        .map(toPublicMessage);
      return {
        status: "ok",
        messages,
        ...(messages.length === 0
          ? { summary: "Aucune perturbation" as const }
          : {}),
        updated_at: formatIsoParis(snapshotState.updatedAt),
        stale: snapshotState.stale,
        source: SOURCE,
      };
    },

    getHealth(): Health {
      if (!snapshotState) {
        return { ok: true, trafic_updated_at: null, stale: null };
      }
      return {
        ok: true,
        trafic_updated_at: formatIsoParis(snapshotState.updatedAt),
        stale: snapshotState.stale,
      };
    },

    async getStopId(query: string): Promise<StopIdentityResult> {
      const normalized = normalizeStopQuery(query);
      if (!normalized) {
        return {
          status: "not_found",
          message: "Aucune Zone d'arrêt correspondante",
          source: SOURCE,
        };
      }
      let matches: ZoneDarret[];
      try {
        matches = await cachedSearch(stopCache, normalized, () =>
          deps.lookup.searchStops(normalized),
        );
      } catch {
        throw new LookupUnavailableError();
      }
      const decision = decideMatches(matches, maxCandidates);
      switch (decision.kind) {
        case "none":
          return {
            status: "not_found",
            message: "Aucune Zone d'arrêt correspondante",
            source: SOURCE,
          };
        case "one":
          return {
            status: "ok",
            fiche: toStopFiche(decision.item),
            source: SOURCE,
          };
        case "many":
          return {
            status: "needs_clarification",
            candidates: toCandidates(decision.items),
            source: SOURCE,
          };
        case "few":
          return {
            status: "ok",
            fiches: decision.items.map(toStopFiche),
            source: SOURCE,
          };
      }
    },

    async prochainPassage(
      zone: string,
      ligneQuery?: string,
    ): Promise<ProchainPassageResult> {
      const normalized = normalizeStopQuery(zone);
      if (!normalized) {
        return {
          status: "not_found",
          message: "Aucune Zone de correspondance correspondante",
          source: SOURCE,
        };
      }
      let matches: ZoneDeCorrespondance[];
      try {
        matches = await cachedSearch(correspondanceCache, normalized, () =>
          correspondances.search(normalized),
        );
      } catch {
        throw new LookupUnavailableError();
      }
      const decision = decideMatches(matches, maxCandidates);
      if (decision.kind === "none") {
        return {
          status: "not_found",
          message: "Aucune Zone de correspondance correspondante",
          source: SOURCE,
        };
      }
      if (decision.kind === "many") {
        return {
          status: "needs_clarification",
          candidates: toCandidates(decision.items),
          source: SOURCE,
        };
      }
      const zones = decision.kind === "one" ? [decision.item] : decision.items;
      let allowedLigneIds: Set<string> | undefined;
      if (ligneQuery !== undefined && ligneQuery.trim()) {
        const lineResult = await app.getLineId(ligneQuery);
        if (lineResult.status !== "ok") {
          return lineResult;
        }
        const lignes = "fiche" in lineResult ? [lineResult.fiche] : lineResult.fiches;
        allowedLigneIds = new Set(lignes.map((ligne) => ligne.id));
      }
      type AnnotatedPassage = ProchainPassage & {
        zone: { id: string; label: string };
      };
      let live: AnnotatedPassage[] = [];
      try {
        for (const zone of zones) {
          const passages = await stopMonitoring.getPassages(
            zone.siri_monitoring_ref,
          );
          for (const passage of passages) {
            live.push({
              ...passage,
              zone: { id: zone.id, label: zone.label },
            });
          }
        }
      } catch {
        return {
          status: "error",
          message: "Impossible de récupérer les Prochains Passages",
          source: SOURCE,
        };
      }
      if (allowedLigneIds) {
        live = live.filter((passage) => allowedLigneIds.has(passage.ligneId));
      }
      const hadRealtime = live.length > 0;
      const nowMs = clock.now().getTime();
      live = live.filter(
        (passage) =>
          passage.expectedAt.getTime() >= nowMs ||
          passage.statut.toLowerCase() === "cancelled",
      );
      live.sort((a, b) => {
        const aPast = a.expectedAt.getTime() < nowMs ? 1 : 0;
        const bPast = b.expectedAt.getTime() < nowMs ? 1 : 0;
        if (aPast !== bPast) {
          return aPast - bPast;
        }
        return a.expectedAt.getTime() - b.expectedAt.getTime();
      });
      const perGroup = new Map<string, number>();
      const selected: AnnotatedPassage[] = [];
      for (const passage of live) {
        if (selected.length >= maxPassages) {
          break;
        }
        const key = `${passage.ligneId}\0${passage.destination}`;
        const count = perGroup.get(key) ?? 0;
        if (count >= maxPassagesPerGroup) {
          continue;
        }
        perGroup.set(key, count + 1);
        selected.push(passage);
      }
      const groups: PassageGroup[] = [];
      for (const passage of selected) {
        const existing = groups.find(
          (group) =>
            group.ligne.id === passage.ligneId &&
            group.destination === passage.destination,
        );
        const item = {
          expected_at: formatIsoParis(passage.expectedAt),
          statut: passage.statut,
          zone_de_correspondance: passage.zone,
        };
        if (existing) {
          existing.passages.push(item);
        } else {
          groups.push({
            ligne: { id: passage.ligneId, label: passage.ligneLabel },
            destination: passage.destination,
            passages: [item],
          });
        }
      }
      if (groups.length === 0) {
        return {
          status: "ok",
          groups,
          ...(hadRealtime ? {} : { summary: "Pas de temps réel" }),
          source: SOURCE,
        };
      }
      return { status: "ok", groups, source: SOURCE };
    },
  };

  return app;
}

export type Application = ReturnType<typeof createApplication>;

export type Config = {
  bindAddress: "0.0.0.0";
  host: string;
  port: number;
  maxCandidates: number;
  maxPassagesPerGroup: number;
  maxPassages: number;
};

export type BootResult =
  | { ok: true; config: Config }
  | { ok: false; exitCode: number; message: string };

export type Health = {
  ok: true;
  trafic_updated_at: string | null;
  stale: boolean | null;
};

export function isOriginAllowed(
  origin: string | undefined,
  hostPort: { host: string; port: number },
): boolean {
  if (!origin) {
    return true;
  }
  const { host, port } = hostPort;
  const allowed = new Set([
    `http://${host}`,
    `https://${host}`,
    `http://${host}:${port}`,
    `https://${host}:${port}`,
  ]);
  return allowed.has(origin);
}

function positiveInt(value: number | undefined, fallback: number): number {
  return value !== undefined &&
    Number.isSafeInteger(value) &&
    value >= 1
    ? value
    : fallback;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number | undefined {
  if (value === undefined) {
    return fallback;
  }
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return undefined;
  }
  return parsed;
}

export function boot(env: NodeJS.ProcessEnv): BootResult {
  if (!env.PRIM_API_KEY?.trim()) {
    return { ok: false, exitCode: 1, message: "PRIM_API_KEY is missing" };
  }
  const maxCandidates = parsePositiveInteger(
    env.MAX_CANDIDATES,
    DEFAULT_MAX_CANDIDATES,
  );
  if (maxCandidates === undefined) {
    return {
      ok: false,
      exitCode: 1,
      message: "MAX_CANDIDATES must be a positive integer",
    };
  }
  const maxPassagesPerGroup = parsePositiveInteger(
    env.MAX_PASSAGES_PER_GROUP,
    DEFAULT_MAX_PASSAGES_PER_GROUP,
  );
  if (maxPassagesPerGroup === undefined) {
    return {
      ok: false,
      exitCode: 1,
      message: "MAX_PASSAGES_PER_GROUP must be a positive integer",
    };
  }
  const maxPassages = parsePositiveInteger(
    env.MAX_PASSAGES,
    DEFAULT_MAX_PASSAGES,
  );
  if (maxPassages === undefined) {
    return {
      ok: false,
      exitCode: 1,
      message: "MAX_PASSAGES must be a positive integer",
    };
  }
  return {
    ok: true,
    config: {
      bindAddress: "0.0.0.0",
      host: env.HOST ?? "localhost",
      port: env.PORT ? Number(env.PORT) : 3000,
      maxCandidates,
      maxPassagesPerGroup,
      maxPassages,
    },
  };
}
