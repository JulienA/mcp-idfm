import { loadEnvFile } from "node:process";
import { boot, createApplication } from "./application/index.js";
import { startHttpServer } from "./http.js";
import { startInfoTraficRefresh } from "./infra/info-trafic-refresh.js";
import { createLogger } from "./infra/logger.js";
import { createPrimNavitiaLookup } from "./infra/prim-navitia-lookup.js";
import { createPrimSiriStopMonitoring } from "./infra/prim-siri-stop-monitoring.js";
import { createPrimTrafficReports } from "./infra/prim-traffic-reports.js";
import { createPrimZoneCorrespondanceLookup } from "./infra/prim-zone-correspondance.js";

try {
  loadEnvFile();
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : undefined;
  if (code !== "ENOENT") {
    throw error;
  }
}

const log = createLogger(process.env);
const result = boot(process.env);
if (!result.ok) {
  log.fatal(result.message);
  process.exit(result.exitCode);
}

log.info(
  {
    bindAddress: result.config.bindAddress,
    host: result.config.host,
    port: result.config.port,
    maxCandidates: result.config.maxCandidates,
  },
  "booted",
);

const apiKey = process.env.PRIM_API_KEY!;
const app = createApplication({
  lookup: createPrimNavitiaLookup({ apiKey, log }),
  correspondances: createPrimZoneCorrespondanceLookup({ log }),
  snapshot: createPrimTrafficReports({ apiKey, log }),
  stopMonitoring: createPrimSiriStopMonitoring({ apiKey, log }),
  maxCandidates: result.config.maxCandidates,
});

async function refreshAndLog(): Promise<void> {
  await app.refreshSnapshot();
  const health = app.getHealth();
  if (health.stale) {
    log.warn(
      { trafic_updated_at: health.trafic_updated_at },
      "Info Trafic snapshot stale",
    );
    return;
  }
  if (!health.trafic_updated_at) {
    log.error("Info Trafic snapshot unavailable");
    return;
  }
  log.info(
    { trafic_updated_at: health.trafic_updated_at },
    "Info Trafic snapshot updated",
  );
}

await refreshAndLog();
const refreshJob = startInfoTraficRefresh(refreshAndLog, log);

const server = await startHttpServer(result.config, app, log);
server.on("error", (error) => {
  log.error({ err: error }, "HTTP server error");
});

function shutdown(signal: string): void {
  log.info({ signal }, "shutting down");
  refreshJob.stop();
  server.close((error) => {
    if (error) {
      log.error({ err: error }, "HTTP server close failed");
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
