# 05: Cache, cron, logs, Docker

**What to build:** Replace the handmade referential TTL `Map` and `setInterval` Info Trafic refresh with real libraries, add structured process logs, and ship a Dockerfile plus Compose file so an operator can run the MCP in a container. Caches stay in-memory (no Redis, no extra process). Product behaviour of the four tools does not change.

**Blocked by:** 03 Info Trafic (`get_info_trafic`)

**Status:** resolved

- [x] Ligne / Zone d'arrêt lookup still cached 24h, via an in-memory cache library, still honouring the injected clock
- [x] Info Trafic snapshot still fetched at boot and every two minutes in-process, via a cron library (not `setInterval`)
- [x] Structured logs for boot, listen, snapshot refresh success/stale/failure, Origin reject, and HTTP 500; never log `PRIM_API_KEY`
- [x] Dockerfile (Node 22) and Compose file bind `0.0.0.0:3000`, take `PRIM_API_KEY` from the environment, and health-check `GET /health`
- [x] Tests stay on the application seam; do not assert timer internals, Navitia/SIRI JSON, or Docker wiring

## Answer

Referential lookup uses `lru-cache` (24h TTL, injected clock). Info Trafic refresh uses Croner (`*/2 * * * *`, Europe/Paris) after a boot fetch. Pino logs boot/listen/snapshot/Origin/HTTP 500 with `PRIM_API_KEY` redacted. Dockerfile + `docker-compose.yml` run Node 22 and health-check `GET /health`.

## Comments
