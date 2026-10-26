# 04: Prochain Passage (`prochain_passage`)

**What to build:** An MCP caller passes a mandatory Zone d'arrêt (text or id) and an optional Ligne. The server resolves (ticket 02 rules), then returns live Prochains Passages from SIRI requête unitaire for that Zone d'arrêt (filtered by Ligne when given). At most five, grouped by Ligne and destination, cancelled kept with Statut de passage. No Navitia theoretical times. No realtime coverage is a successful “pas de temps réel”, not a schedule fallback. Grain is Zone d'arrêt; pôle de correspondance and quai are out of v1.

**Blocked by:** 02 Résolution d’identité (`get_line_id` / `get_stop_id`)

**Status:** resolved

- [x] `prochain_passage` requires a Zone d'arrêt query; Ligne is optional and filters after resolution
- [x] Live SIRI unitaire via `MonitoringRef` of the Zone d'arrêt; not cached; no `/stop_schedules` or `/departures` fallback
- [x] At most 5 passages, grouped by Ligne + destination; cancelled (and other Statut de passage values from the feed) remain visible
- [x] No SIRI realtime for a resolved Zone d'arrêt → successful outcome stating the absence, not an MCP error and not theoretical times
- [x] 0 / 1 / 2–5 union / >5 clarification follow ticket 02; union of zones still respects the cap of 5
- [x] SIRI failure with no usable payload → MCP error for that call (no stale passages)
- [x] Tests use a fake SIRI adapter; production is PRIM stop-monitoring
- [x] French strings, ISO datetimes Europe/Paris, `source: "Île-de-France Mobilités"`

## Answer

`prochain_passage` from live SIRI unitaire (cap 5, cancelled kept including Aimed-only cancelled visits, no theoretical fallback) is on `feat/mcp-idfm-v1` (`b5d28ac`).

## Comments

Implemented on `feat/mcp-idfm-v1` (`be76a7a`).
Review fixes merged (`b5d28ac`).
