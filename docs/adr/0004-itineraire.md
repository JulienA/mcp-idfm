# Itinéraire via Navitia `/journeys` (realtime), un outil, timeout PRIM configurable

An MCP caller asking « comment aller de X à Y » gets a single tool, `itineraire`, on the same PRIM product as `/places` and `traffic_reports` (Accès générique v2). Place grain is a **Lieu** (Zone d'arrêt, address, or `lon;lat`), not a Zone de correspondance. `/journeys` is called with `data_freshness=realtime` so disruptions reshape the path; that does not replace **Prochain Passage**, which stays SIRI unitaire (ADR 0002, ADR 0003). The 2–5 union used by the v1 identity tools is forbidden here: two or more matches on either end is `needs_clarification` and zero journey calls. Every PRIM request (lookup, traffic_reports, SIRI, journeys) shares one timeout, default 50 s, from `PRIM_FETCH_TIMEOUT_MS`.

## Considered Options

- Two MCP tools (geocode then plan): rejected; métier tools already resolve text themselves.
- `data_freshness=base_schedule` and `horaires: "théoriques"`: rejected; Julien asked for realtime (or `adapted_schedule`). Realtime includes adapted information.
- A journeys-only timeout next to the existing 10 s client: rejected; one `primRequest`, one env var.
- Union of 2–5 Lieux into a grid of `/journeys` calls: rejected; quota and a meaningless merged answer.
