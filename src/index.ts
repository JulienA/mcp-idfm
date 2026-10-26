import { loadEnvFile } from "node:process";
import { boot, createApplication } from "./application/index.js";
import { startHttpServer } from "./http.js";
import { createPrimNavitiaLookup } from "./infra/prim-navitia-lookup.js";
import { createPrimSiriStopMonitoring } from "./infra/prim-siri-stop-monitoring.js";
import { createPrimTrafficReports } from "./infra/prim-traffic-reports.js";

const SNAPSHOT_REFRESH_MS = 2 * 60 * 1000;

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

const result = boot(process.env);
if (!result.ok) {
  process.exit(result.exitCode);
}

const apiKey = process.env.PRIM_API_KEY!;
const app = createApplication({
  lookup: createPrimNavitiaLookup({ apiKey }),
  snapshot: createPrimTrafficReports({ apiKey }),
  stopMonitoring: createPrimSiriStopMonitoring({ apiKey }),
});

await app.refreshSnapshot();
setInterval(() => {
  void app.refreshSnapshot();
}, SNAPSHOT_REFRESH_MS);

await startHttpServer(result.config, app);
