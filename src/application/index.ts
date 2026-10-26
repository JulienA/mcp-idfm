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

export type Clock = {
  now(): Date;
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

export function createApplication(deps: { lookup: NavitiaLookup; clock?: Clock }) {
  const clock = deps.clock ?? { now: () => new Date() };
  const lineCache = new Map<string, { matches: Ligne[]; storedAt: number }>();
  const stopCache = new Map<string, { matches: ZoneDarret[]; storedAt: number }>();

  return {
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
      const cached = lineCache.get(normalized);
      const matches =
        cached && now - cached.storedAt < REFERENTIAL_TTL_MS
          ? cached.matches
          : await deps.lookup.searchLines(normalized);
      if (!cached || now - cached.storedAt >= REFERENTIAL_TTL_MS) {
        lineCache.set(normalized, { matches, storedAt: now });
      }
      if (matches.length === 0) {
        return {
          status: "not_found",
          message: "Aucune Ligne correspondante",
          source: SOURCE,
        };
      }
      if (matches.length === 1) {
        return { status: "ok", fiche: matches[0]!, source: SOURCE };
      }
      if (matches.length > 5) {
        return {
          status: "needs_clarification",
          candidates: matches.map(({ id, label, mode }) => ({
            id,
            label,
            mode,
          })),
          source: SOURCE,
        };
      }
      return { status: "ok", fiches: matches, source: SOURCE };
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
      const cached = stopCache.get(normalized);
      const matches =
        cached && now - cached.storedAt < REFERENTIAL_TTL_MS
          ? cached.matches
          : await deps.lookup.searchStops(normalized);
      if (!cached || now - cached.storedAt >= REFERENTIAL_TTL_MS) {
        stopCache.set(normalized, { matches, storedAt: now });
      }
      if (matches.length === 0) {
        return {
          status: "not_found",
          message: "Aucune Zone d'arrêt correspondante",
          source: SOURCE,
        };
      }
      if (matches.length === 1) {
        return { status: "ok", fiche: toStopFiche(matches[0]!), source: SOURCE };
      }
      if (matches.length > 5) {
        return {
          status: "needs_clarification",
          candidates: matches.map(({ id, label, mode }) => ({
            id,
            label,
            mode,
          })),
          source: SOURCE,
        };
      }
      return { status: "ok", fiches: matches.map(toStopFiche), source: SOURCE };
    },
  };
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

export function getHealth(): Health {
  return { ok: true, trafic_updated_at: null, stale: null };
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
