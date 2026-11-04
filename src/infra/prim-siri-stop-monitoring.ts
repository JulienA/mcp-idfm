import { canonicalLineId, type ProchainPassage } from "../domain/index.js";
import type { Logger } from "./logger.js";
import { silentLogger } from "./logger.js";
import { PRIM_FETCH_TIMEOUT_MS, primRequest } from "./prim-fetch.js";

const PRIM_STOP_MONITORING =
  "https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring";

type PrimSiriStopMonitoringOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  log?: Logger;
  timeoutMs?: number;
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function siriText(field: unknown): string | undefined {
  if (typeof field === "string" && field.trim()) {
    return field;
  }
  if (Array.isArray(field)) {
    return siriText(field[0]);
  }
  if (field && typeof field === "object" && "value" in field) {
    return siriText((field as { value: unknown }).value);
  }
  return undefined;
}

function parseSiriDate(raw: string | undefined): Date | undefined {
  if (!raw) {
    return undefined;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function callStatut(call: Record<string, unknown> | undefined): string {
  return siriText(call?.DepartureStatus) ?? siriText(call?.ArrivalStatus) ?? "";
}

function expectedAt(
  call: Record<string, unknown> | undefined,
  statut: string,
): Date | undefined {
  const expected = parseSiriDate(
    siriText(call?.ExpectedDepartureTime) ?? siriText(call?.ExpectedArrivalTime),
  );
  if (expected) {
    return expected;
  }
  if (statut !== "cancelled") {
    return undefined;
  }
  return parseSiriDate(
    siriText(call?.AimedDepartureTime) ?? siriText(call?.AimedArrivalTime),
  );
}

function toProchainPassage(visit: unknown): ProchainPassage | undefined {
  if (!visit || typeof visit !== "object") {
    return undefined;
  }
  const journey = (visit as { MonitoredVehicleJourney?: Record<string, unknown> })
    .MonitoredVehicleJourney;
  if (!journey) {
    return undefined;
  }
  const lineRef = siriText(journey.LineRef);
  if (!lineRef) {
    return undefined;
  }
  const call = journey.MonitoredCall as Record<string, unknown> | undefined;
  const statut = callStatut(call);
  const when = expectedAt(call, statut);
  if (!when) {
    return undefined;
  }
  const ligneId = canonicalLineId(lineRef);
  return {
    ligneId,
    ligneLabel: siriText(journey.PublishedLineName) ?? ligneId,
    destination: siriText(journey.DestinationName) ?? "",
    expectedAt: when,
    statut,
  };
}

export function createPrimSiriStopMonitoring(
  options: PrimSiriStopMonitoringOptions,
): { getPassages(monitoringRef: string): Promise<ProchainPassage[]> } {
  const fetchFn = options.fetch ?? fetch;
  const log = options.log ?? silentLogger;
  const timeoutMs = options.timeoutMs ?? PRIM_FETCH_TIMEOUT_MS;

  return {
    async getPassages(monitoringRef) {
      const url = new URL(PRIM_STOP_MONITORING);
      url.searchParams.set("MonitoringRef", monitoringRef);
      const response = await primRequest(
        url,
        options.apiKey,
        fetchFn,
        log,
        timeoutMs,
      );
      if (!response.ok) {
        throw new Error(`PRIM SIRI stop-monitoring failed: ${response.status}`);
      }
      const body = (await response.json()) as {
        Siri?: {
          ServiceDelivery?: {
            StopMonitoringDelivery?: unknown;
          };
        };
      };
      const deliveries = asArray(
        body.Siri?.ServiceDelivery?.StopMonitoringDelivery as
          | { MonitoredStopVisit?: unknown }
          | { MonitoredStopVisit?: unknown }[]
          | undefined,
      );
      const passages = deliveries
        .flatMap((delivery) => asArray(delivery.MonitoredStopVisit))
        .map(toProchainPassage)
        .filter((passage): passage is ProchainPassage => passage !== undefined);
      log.info(
        { monitoringRef, passages: passages.length },
        "PRIM SIRI stop-monitoring",
      );
      return passages;
    },
  };
}
