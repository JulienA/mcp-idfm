import { boot, createApplication } from "./application/index.js";
import { startHttpServer } from "./http.js";
import { createPrimNavitiaLookup } from "./infra/prim-navitia-lookup.js";

const result = boot(process.env);
if (!result.ok) {
  process.exit(result.exitCode);
}

const identity = createApplication({
  lookup: createPrimNavitiaLookup({ apiKey: process.env.PRIM_API_KEY! }),
});

await startHttpServer(result.config, identity);
