# 03: Info Trafic (`get_info_trafic`)

**What to build:** An MCP caller passes a mandatory Ligne (text or id). The server resolves it (ticket 02 rules), then returns Info Trafic for that Ligne from an in-process `traffic_reports` snapshot fetched at boot and every two minutes. Empty list means trafic normal (`summary: "Aucune perturbation"`). A failed refresh after a good snapshot still answers, with `stale: true` and `updated_at`. No full-network dump. No line_reports v2 product and no bulk API as the cache source.

**Blocked by:** 02 Résolution d’identité (`get_line_id` / `get_stop_id`)

**Status:** ready-for-agent

- [x] `get_info_trafic` requires a Ligne query; missing query is not a network dump
- [x] Messages include title, text, Sévérité, cause, application periods, impacted Lignes/stops; envelope has `updated_at` and `stale`
- [x] Snapshot comes from slim Navitia `traffic_reports` (`count=1000`, `disable_geojson`, `depth=1`), paginated only if `total_result > 1000`
- [x] First fetch at boot; refresh every 2 minutes in-process; PRIM down after a snapshot → successful response with `stale: true`
- [x] PRIM down with no snapshot → MCP error; 0 / 1 / 2–5 / >5 matches follow ticket 02
- [x] Tests use a fake snapshot adapter plus a controllable clock; production adapter is general v2 `traffic_reports`
- [x] French strings, ISO datetimes Europe/Paris, `source: "Île-de-France Mobilités"`
- [x] `GET /health` reflects `trafic_updated_at` and `stale`

## Comments

Implemented on `feat/mcp-idfm-v1` (`be76a7a`).
