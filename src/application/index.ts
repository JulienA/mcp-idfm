import { formatIsoParis } from "../iso-paris.js";

export type Ligne = {
  id: string;
  label: string;
  mode: string;
  siri_line_ref: string;
  navitia_id: string;
};

export type ZoneDarret = {
  id: string;
  label: string;
  mode: string;
  siri_monitoring_ref: string;
  navitia_id: string;
};

export type ZoneDarretFiche = {
  id: string;
  label: string;
  siri_monitoring_ref: string;
  navitia_id: string;
};

export type NavitiaLookup = {
  searchLines(query: string): Promise<Ligne[]>;
  searchStops(query: string): Promise<ZoneDarret[]>;
};

export type StatutDePassage =
  | "onTime"
  | "early"
  | "delayed"
  | "cancelled"
  | "arrived"
  | "departed"
  | (string & {});

export type ProchainPassage = {
  ligneId: string;
  ligneLabel: string;
  destination: string;
  expectedAt: Date;
  statut: StatutDePassage;
};

export type StopMonitoring = {
  getPassages(monitoringRef: string): Promise<ProchainPassage[]>;
};

export type Clock = {
  now(): Date;
};

export type Severite = "bloquant" | "perturbé" | "information";

export type InfoTraficMessage = {
  title: string;
  text: string;
  severite: Severite;
  cause: string;
  application_periods: { begin: string; end: string }[];
  impacted_lignes: { id: string; label: string }[];
  impacted_stops: { id: string; label: string }[];
  ligne_ids?: string[];
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

export type InfoTraficResult =
  | {
      status: "ok";
      messages: InfoTraficMessage[];
      summary?: "Aucune perturbation";
      updated_at: string;
      stale: boolean;
      source: typeof SOURCE;
    }
  | {
      status: "not_found";
      message: string;
      source: typeof SOURCE;
    }
  | {
      status: "needs_clarification";
      candidates: IdentityCandidate[];
      source: typeof SOURCE;
    };

const REFERENTIAL_TTL_MS = 24 * 60 * 60 * 1000;

export const SOURCE = "Île-de-France Mobilités" as const;

export type IdentityCandidate = {
  id: string;
  label: string;
  mode: string;
};

export type LineIdentityResult =
  | {
      status: "ok";
      fiche: Ligne;
      source: typeof SOURCE;
    }
  | {
      status: "ok";
      fiches: Ligne[];
      source: typeof SOURCE;
    }
  | {
      status: "not_found";
      message: string;
      source: typeof SOURCE;
    }
  | {
      status: "needs_clarification";
      candidates: IdentityCandidate[];
      source: typeof SOURCE;
    };

export type StopIdentityResult =
  | {
      status: "ok";
      fiche: ZoneDarretFiche;
      source: typeof SOURCE;
    }
  | {
      status: "ok";
      fiches: ZoneDarretFiche[];
      source: typeof SOURCE;
    }
  | {
      status: "not_found";
      message: string;
      source: typeof SOURCE;
    }
  | {
      status: "needs_clarification";
      candidates: IdentityCandidate[];
      source: typeof SOURCE;
    };

export type PassageGroup = {
  ligne: { id: string; label: string };
  destination: string;
  passages: {
    expected_at: string;
    statut: StatutDePassage;
    zone_darret: { id: string; label: string };
  }[];
};

export type ProchainPassageResult =
  | {
      status: "ok";
      groups: PassageGroup[];
      source: typeof SOURCE;
      summary?: "Pas de temps réel";
    }
  | Exclude<StopIdentityResult, { status: "ok" }>
  | {
      status: "error";
      message: string;
    };

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
  cache: Map<string, { matches: T[]; storedAt: number }>,
  key: string,
  now: number,
  search: () => Promise<T[]>,
): Promise<T[]> {
  const cached = cache.get(key);
  if (cached && now - cached.storedAt < REFERENTIAL_TTL_MS) {
    return cached.matches;
  }
  const matches = await search();
  cache.set(key, { matches, storedAt: now });
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

function decideMatches<T>(matches: T[]): MatchDecision<T> {
  if (matches.length === 0) {
    return { kind: "none" };
  }
  if (matches.length === 1) {
    return { kind: "one", item: matches[0]! };
  }
  if (matches.length > 5) {
    return { kind: "many", items: matches };
  }
  return { kind: "few", items: matches };
}

export function createApplication(deps: {
  lookup: NavitiaLookup;
  clock?: Clock;
  snapshot?: InfoTraficSnapshot;
  stopMonitoring?: StopMonitoring;
}) {
  const clock = deps.clock ?? { now: () => new Date() };
  const stopMonitoring = deps.stopMonitoring ?? {
    async getPassages(): Promise<ProchainPassage[]> {
      throw new Error("SIRI stop-monitoring adapter is required");
    },
  };
  const lineCache = new Map<string, { matches: Ligne[]; storedAt: number }>();
  const stopCache = new Map<string, { matches: ZoneDarret[]; storedAt: number }>();
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
      const now = clock.now().getTime();
      let matches: Ligne[];
      try {
        matches = await cachedSearch(lineCache, normalized, now, () =>
          deps.lookup.searchLines(normalized),
        );
      } catch {
        throw new LookupUnavailableError();
      }
      const decision = decideMatches(matches);
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
      const now = clock.now().getTime();
      let matches: ZoneDarret[];
      try {
        matches = await cachedSearch(stopCache, normalized, now, () =>
          deps.lookup.searchStops(normalized),
        );
      } catch {
        throw new LookupUnavailableError();
      }
      const decision = decideMatches(matches);
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
      arret: string,
      ligneQuery?: string,
    ): Promise<ProchainPassageResult> {
      const stopResult = await app.getStopId(arret);
      if (stopResult.status !== "ok") {
        return stopResult;
      }
      let allowedLigneIds: Set<string> | undefined;
      if (ligneQuery !== undefined && ligneQuery.trim()) {
        const lineResult = await app.getLineId(ligneQuery);
        if (lineResult.status !== "ok") {
          return lineResult;
        }
        const lignes = "fiche" in lineResult ? [lineResult.fiche] : lineResult.fiches;
        allowedLigneIds = new Set(lignes.map((ligne) => ligne.id));
      }
      const stops =
        "fiche" in stopResult ? [stopResult.fiche] : stopResult.fiches;
      type AnnotatedPassage = ProchainPassage & {
        zone: { id: string; label: string };
      };
      let live: AnnotatedPassage[] = [];
      try {
        for (const stop of stops) {
          const passages = await stopMonitoring.getPassages(
            stop.siri_monitoring_ref,
          );
          for (const passage of passages) {
            live.push({
              ...passage,
              zone: { id: stop.id, label: stop.label },
            });
          }
        }
      } catch {
        return {
          status: "error",
          message: "Impossible de récupérer les Prochains Passages",
        };
      }
      if (allowedLigneIds) {
        live = live.filter((passage) => allowedLigneIds.has(passage.ligneId));
      }
      live = [...live]
        .sort((a, b) => a.expectedAt.getTime() - b.expectedAt.getTime())
        .slice(0, 5);
      const groups: PassageGroup[] = [];
      for (const passage of live) {
        const existing = groups.find(
          (group) =>
            group.ligne.id === passage.ligneId &&
            group.destination === passage.destination,
        );
        const item = {
          expected_at: formatIsoParis(passage.expectedAt),
          statut: passage.statut,
          zone_darret: passage.zone,
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
          summary: "Pas de temps réel",
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
};

export type BootResult =
  | { ok: true; config: Config }
  | { ok: false; exitCode: number };

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

export function boot(env: NodeJS.ProcessEnv): BootResult {
  if (!env.PRIM_API_KEY?.trim()) {
    return { ok: false, exitCode: 1 };
  }
  return {
    ok: true,
    config: {
      bindAddress: "0.0.0.0",
      host: env.HOST ?? "localhost",
      port: env.PORT ? Number(env.PORT) : 3000,
    },
  };
}
