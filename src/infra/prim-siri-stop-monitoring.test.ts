import { describe, expect, it } from "vitest";
import { createPrimSiriStopMonitoring } from "./prim-siri-stop-monitoring.js";

function siriResponse(visit: unknown): Response {
  return new Response(
    JSON.stringify({
      Siri: {
        ServiceDelivery: {
          StopMonitoringDelivery: {
            MonitoredStopVisit: [visit],
          },
        },
      },
    }),
    { status: 200 },
  );
}

function adapterFor(visit: unknown) {
  return createPrimSiriStopMonitoring({
    apiKey: "test-key",
    fetch: async () => siriResponse(visit),
  });
}

describe("createPrimSiriStopMonitoring", () => {
  it("treats a SIRI visit with only Aimed times as no realtime", async () => {
    const adapter = adapterFor({
      MonitoredVehicleJourney: {
        LineRef: "STIF:Line::C01742:",
        PublishedLineName: "B",
        DestinationName: "Robinson",
        MonitoredCall: {
          AimedDepartureTime: "2026-07-01T10:04:00.000Z",
          AimedArrivalTime: "2026-07-01T10:04:00.000Z",
          DepartureStatus: "onTime",
        },
      },
    });

    const passages = await adapter.getPassages("STIF:StopArea:SP:73641:");
    expect(passages).toEqual([]);
  });

  it("includes a cancelled visit using Aimed times when Expected is absent", async () => {
    const adapter = adapterFor({
      MonitoredVehicleJourney: {
        LineRef: "STIF:Line::C01742:",
        PublishedLineName: "B",
        DestinationName: "Robinson",
        MonitoredCall: {
          AimedDepartureTime: "2026-07-01T10:04:00.000Z",
          AimedArrivalTime: "2026-07-01T10:04:00.000Z",
          DepartureStatus: "cancelled",
        },
      },
    });

    const passages = await adapter.getPassages("STIF:StopArea:SP:73641:");
    expect(passages).toEqual([
      {
        ligneId: "C01742",
        ligneLabel: "B",
        destination: "Robinson",
        expectedAt: new Date("2026-07-01T10:04:00.000Z"),
        statut: "cancelled",
      },
    ]);
  });

  it("passes through an empty statut when the feed omits DepartureStatus and ArrivalStatus", async () => {
    const adapter = adapterFor({
      MonitoredVehicleJourney: {
        LineRef: "STIF:Line::C01742:",
        PublishedLineName: "B",
        DestinationName: "Robinson",
        MonitoredCall: {
          ExpectedDepartureTime: "2026-07-01T10:04:00.000Z",
        },
      },
    });

    const passages = await adapter.getPassages("STIF:StopArea:SP:73641:");
    expect(passages).toEqual([
      {
        ligneId: "C01742",
        ligneLabel: "B",
        destination: "Robinson",
        expectedAt: new Date("2026-07-01T10:04:00.000Z"),
        statut: "",
      },
    ]);
  });
});
