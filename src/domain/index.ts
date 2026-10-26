export { canonicalLineId, canonicalStopId } from "./ids.js";
export { formatIsoParis } from "./iso-paris.js";

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

export type ZoneDeCorrespondance = {
  id: string;
  label: string;
  mode: string;
  siri_monitoring_ref: string;
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

export const SOURCE = "Île-de-France Mobilités" as const;

export type IdentityCandidate = {
  id: string;
  label: string;
  mode: string;
};

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
    zone_de_correspondance: { id: string; label: string };
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
      source: typeof SOURCE;
    };
