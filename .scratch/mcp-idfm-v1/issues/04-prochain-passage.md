# 04: Prochain Passage (`prochain_passage`)

**What to build:** An MCP caller passes a mandatory Zone de correspondance (text or id) and an optional Ligne. The server resolves it (same 0 / 1 / 2–5 / >5 rules as ticket 02), rolling a Zone d'arrêt id up to its parent zone, then returns live Prochains Passages from SIRI requête unitaire for that Zone de correspondance (filtered by Ligne when given). At most five, grouped by Ligne and destination, cancelled kept with Statut de passage. No Navitia theoretical times. No realtime coverage is a successful “pas de temps réel”, not a schedule fallback. Grain is Zone de correspondance; quai is out.

**Blocked by:** 02 Résolution d’identité (`get_line_id` / `get_stop_id`)

**Status:** resolved

- [x] `prochain_passage` requires a Zone de correspondance query; Ligne is optional and filters after resolution
- [x] Live SIRI unitaire via `MonitoringRef` of the Zone de correspondance (`STIF:StopArea:SP:{ZdCId}:`); a Zone d'arrêt id is rolled up; not cached; no `/stop_schedules` or `/departures` fallback
- [x] At most 5 passages, grouped by Ligne + destination; cancelled (and other Statut de passage values from the feed) remain visible
- [x] No SIRI realtime for a resolved Zone de correspondance → successful outcome stating the absence, not an MCP error and not theoretical times
- [x] 0 / 1 / 2–5 union / >5 clarification follow ticket 02; union of zones still respects the cap of 5
- [x] SIRI failure with no usable payload → MCP error for that call (no stale passages)
- [x] Tests use a fake SIRI adapter; production is PRIM stop-monitoring
- [x] French strings, ISO datetimes Europe/Paris, `source: "Île-de-France Mobilités"`

## Answer

`prochain_passage` from live SIRI unitaire (cap 5, cancelled kept including Aimed-only cancelled visits, no theoretical fallback) is on `feat/mcp-idfm-v1` (`b5d28ac`).

## Comments

Implemented on `feat/mcp-idfm-v1` (`be76a7a`).
Review fixes merged (`b5d28ac`).

Grain moved from Zone d'arrêt to Zone de correspondance for `prochain_passage` only (`get_stop_id` stays on the Zone d'arrêt). SIRI `MonitoringRef` is `STIF:StopArea:SP:{ZdCId}:`. A Zone d'arrêt id is rolled up through the référentiel relations. See ADR 0003.
