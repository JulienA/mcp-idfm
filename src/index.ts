import { boot, createApplication } from "./application/index.js";
import { startHttpServer } from "./http.js";
import { createPrimNavitiaLookup } from "./infra/prim-navitia-lookup.js";
import { createPrimSiriStopMonitoring } from "./infra/prim-siri-stop-monitoring.js";

const result = boot(process.env);
if (!result.ok) {
  process.exit(result.exitCode);
}

const apiKey = process.env.PRIM_API_KEY!;
const identity = createApplication({
  lookup: createPrimNavitiaLookup({ apiKey }),
  stopMonitoring: createPrimSiriStopMonitoring({ apiKey }),
});

await startHttpServer(result.config, identity);
