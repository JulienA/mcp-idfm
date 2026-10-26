import { loadEnvFile } from "node:process";
import { boot, createApplication } from "./application/index.js";
import { startHttpServer } from "./http.js";
import { startInfoTraficRefresh } from "./infra/info-trafic-refresh.js";
import { createLogger } from "./infra/logger.js";
import { createPrimNavitiaLookup } from "./infra/prim-navitia-lookup.js";
import { createPrimSiriStopMonitoring } from "./infra/prim-siri-stop-monitoring.js";
import { createPrimTrafficReports } from "./infra/prim-traffic-reports.js";

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
  log.fatal("PRIM_API_KEY is missing");
  process.exit(result.exitCode);
}

log.info(
  {
    bindAddress: result.config.bindAddress,
    host: result.config.host,
    port: result.config.port,
  },
  "booted",
);

const apiKey = process.env.PRIM_API_KEY!;
const app = createApplication({
  lookup: createPrimNavitiaLookup({ apiKey }),
  snapshot: createPrimTrafficReports({ apiKey }),
  stopMonitoring: createPrimSiriStopMonitoring({ apiKey }),
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
startInfoTraficRefresh(refreshAndLog, log);

const server = await startHttpServer(result.config, app, log);
server.on("error", (error) => {
  log.error({ err: error }, "HTTP server error");
});
