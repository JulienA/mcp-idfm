import { Cron } from "croner";
import type { Logger } from "./logger.js";

const INFO_TRAFIC_CRON = "*/2 * * * *";

export function startInfoTraficRefresh(
  refresh: () => Promise<void>,
  log: Logger,
): Cron {
  const job = new Cron(
    INFO_TRAFIC_CRON,
    {
      name: "info-trafic-snapshot",
      timezone: "Europe/Paris",
      protect: (blocked) => {
        log.warn(
          { currentRun: blocked.currentRun()?.toISOString() },
          "Info Trafic refresh skipped, previous run still in progress",
        );
      },
      catch: (error) => {
        log.error({ err: error }, "Info Trafic refresh failed");
      },
    },
    refresh,
  );
  log.info(
    {
      cron: INFO_TRAFIC_CRON,
      timezone: "Europe/Paris",
      next: job.nextRun()?.toISOString(),
    },
    "Info Trafic refresh scheduled",
  );
  return job;
}
