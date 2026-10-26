# 02: Résolution d’identité (`get_line_id` / `get_stop_id`)

**What to build:** An MCP caller can resolve a typed string or a PRIM id into a Ligne or Zone d'arrêt fiche (canonical id plus SIRI/Navitia aliases, label, mode where it applies). Unique match proceeds; 2–5 matches return the union of fiches; more than five returns `needs_clarification` with candidates `{ id, label, mode }`; zero matches is “nothing found”, not an MCP error. Referential results are reused for 24 hours. Same match rules on both tools.

**Blocked by:** 01 HTTP harness

**Status:** resolved

- [x] `get_line_id` / `get_stop_id` accept text, `Cxxxxx`, Navitia ids, and SIRI refs
- [x] Ligne fiche: `{ id, label, mode, siri_line_ref, navitia_id }`; Zone d'arrêt fiche: `{ id, label, siri_monitoring_ref, navitia_id }`
- [x] 0 match → not found; 1 → one fiche; 2–5 → list (union); >5 → `{ status: "needs_clarification", candidates }` as a successful tool result
- [x] Lookup is cached 24h (referential cache, not the Info Trafic snapshot)
- [x] Tests drive the application module with a fake Navitia lookup; production uses `/pt_objects` (Ligne) and `/places` (Zone d'arrêt)
- [x] Tool descriptions and user-facing strings are French; payloads include `source: "Île-de-France Mobilités"`

## Answer

`get_line_id` / `get_stop_id` with 0 / 1 / 2–5 union / >5 clarification and 24h referential cache is on `feat/mcp-idfm-v1` (`b5d28ac`).

## Comments

Implemented on `feat/mcp-idfm-v1` (`be76a7a`).
Review fixes merged (`b5d28ac`).
