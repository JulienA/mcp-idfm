import { boot } from "./application/index.js";
import { startHttpServer } from "./http.js";

const result = boot(process.env);
if (!result.ok) {
  process.exit(result.exitCode);
}

await startHttpServer(result.config);
