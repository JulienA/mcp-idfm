import type {
  LivePassage,
  StopMonitoring,
} from "../application/index.js";

const PRIM_STOP_MONITORING =
  "https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring";

type PrimSiriStopMonitoringOptions = {
  apiKey: string;
  fetch?: typeof fetch;
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

function canonicalLineId(lineRef: string): string {
  const match = /C\d+/i.exec(lineRef);
  return match?.[0]?.toUpperCase() ?? lineRef;
}

function expectedAt(call: Record<string, unknown> | undefined): Date | undefined {
  const raw =
    siriText(call?.ExpectedDepartureTime) ??
    siriText(call?.ExpectedArrivalTime) ??
    siriText(call?.AimedDepartureTime) ??
    siriText(call?.AimedArrivalTime);
  if (!raw) {
    return undefined;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toLivePassage(visit: unknown): LivePassage | undefined {
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
  const when = expectedAt(call);
  if (!when) {
    return undefined;
  }
  const ligneId = canonicalLineId(lineRef);
  return {
    ligneId,
    ligneLabel: siriText(journey.PublishedLineName) ?? ligneId,
    destination: siriText(journey.DestinationName) ?? "",
    expectedAt: when,
    statut:
      siriText(call?.DepartureStatus) ??
      siriText(call?.ArrivalStatus) ??
      "onTime",
  };
}

export function createPrimSiriStopMonitoring(
  options: PrimSiriStopMonitoringOptions,
): StopMonitoring {
  const fetchFn = options.fetch ?? fetch;

  return {
    async getPassages(monitoringRef) {
      const url = new URL(PRIM_STOP_MONITORING);
      url.searchParams.set("MonitoringRef", monitoringRef);
      const response = await fetchFn(url, {
        headers: { "API Key": options.apiKey },
      });
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
      return deliveries
        .flatMap((delivery) => asArray(delivery.MonitoredStopVisit))
        .map(toLivePassage)
        .filter((passage): passage is LivePassage => passage !== undefined);
    },
  };
}
