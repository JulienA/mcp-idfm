import { Cron } from "croner";
import type { Logger } from "./logger.js";

const INFO_TRAFIC_CRON = "*/2 * * * *";

export function startInfoTraficRefresh(
  refresh: () => Promise<void>,
  log: Logger,
): Cron {
  return new Cron(
    INFO_TRAFIC_CRON,
    {
      name: "info-trafic-snapshot",
      timezone: "Europe/Paris",
      protect: true,
      catch: (error) => {
        log.error({ err: error }, "Info Trafic refresh failed");
      },
    },
    refresh,
  );
}
