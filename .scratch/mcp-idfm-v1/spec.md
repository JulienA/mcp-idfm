# MCP Île-de-France Mobilités v1

Status: ready-for-agent

Implemented on `feat/mcp-idfm-v1` (`b5d28ac`).

## Problem Statement

An MCP caller (Cursor, Claude, or another HTTP client) needs Île-de-France traffic messages and next departures from natural language or mixed identifiers (“RER B”, “Metro 1”, a `Cxxxxx`, a SIRI ref). Today that means knowing PRIM, picking among Navitia and SIRI products, handling quotas, and resolving ambiguous names. The caller must not log into PRIM.

## Solution

A Node/TypeScript MCP server over Streamable HTTP. Four tools resolve text or ids, then return **Info Trafic** from a cached Navitia `traffic_reports` snapshot, or live **Prochain Passage** from SIRI requête unitaire. Ambiguous names are clarified only when there are more than five matches; five or fewer are returned as a union. Callers never authenticate to the MCP; the server holds `PRIM_API_KEY`.

## User Stories

1. As an MCP caller, I want `get_info_trafic` with a Ligne as text or id, so that I can see current Info Trafic without knowing PRIM URLs.
2. As an MCP caller, I want `prochain_passage` with a Zone de correspondance as text or id, so that I can see live next departures.
3. As an MCP caller, I want an optional Ligne on `prochain_passage`, so that “Châtelet + RER B” is not mixed with other modes at that place.
4. As an MCP caller, I want `get_line_id` with a typed string, so that I can obtain the canonical Ligne fiche without calling the métier tools.
5. As an MCP caller, I want `get_stop_id` with a typed string, so that I can obtain the canonical Zone d'arrêt fiche.
6. As an MCP caller, I want métier tools to resolve text themselves, so that I am not forced into a two-step lookup.
7. As an MCP caller, I want “RER B” to resolve uniquely to its `Cxxxxx`, so that I do not have to paste a Navitia URI.
8. As an MCP caller, I want “Ligne 1” / “Metro 1” / a bus 1 to be treated as different Lignes, so that the tool does not guess Métro 1.
9. As an MCP caller, I want a single unique match to proceed immediately, so that obvious names stay one-shot.
10. As an MCP caller, I want two to five matches returned as a union of results, so that I still get data when a few homonyms exist.
11. As an MCP caller, I want more than five matches to return `status: needs_clarification` with candidates `{ id, label, mode }`, so that I can ask the human instead of guessing.
12. As an MCP caller, I want zero matches to mean “nothing found”, not a server error, so that I can rephrase.
13. As an MCP caller, I want clarification to be a successful tool result, so that the agent can continue the conversation.
14. As an MCP caller, I want MCP errors reserved for real failures (missing key, PRIM down with no cache), so that I can tell “ask the user” from “the server is broken”.
15. As an MCP caller, I want every Ligne identity to expose canonical `id` (`Cxxxxx`), `label`, `mode`, `siri_line_ref`, and `navitia_id`, so that I can reuse the id in a later call.
16. As an MCP caller, I want every Zone d'arrêt identity to expose canonical `id`, `label`, `siri_monitoring_ref`, and `navitia_id`, so that SIRI and Navitia aliases are not my problem.
17. As an MCP caller, I want to pass a SIRI LineRef, a Navitia `line:IDFM:Cxxxxx`, or a `Cxxxxx` and have them mean the same Ligne, so that copy-paste from any PRIM doc works.
18. As an MCP caller, I want to pass a SIRI MonitoringRef or a Navitia stop-area id and have them mean the same Zone d'arrêt, so that I do not convert ids by hand.
19. As an MCP caller, I want `get_info_trafic` to require a Ligne query, so that I cannot dump the whole network into the context window.
20. As an MCP caller, I want each Info Trafic message to include title, text, Sévérité, cause, application periods, and impacted Lignes/stops, so that I can explain the disruption.
21. As an MCP caller, I want the Info Trafic envelope to include `updated_at` and `stale`, so that I know how fresh the snapshot is.
22. As an MCP caller, I want an empty message list plus `summary: "Aucune perturbation"` when the Ligne is quiet, so that I do not confuse “no data” with “trafic normal”.
23. As an MCP caller, I want Info Trafic filtered from a network snapshot, so that a Ligne query does not wait on a PRIM round-trip per line.
24. As an MCP caller, I want Prochain Passage to be live SIRI estimates, so that I am not given theoretical Navitia times.
25. As an MCP caller, I want no theoretical fallback when SIRI has no realtime for that Zone de correspondance, so that I am not misled.
26. As an MCP caller, I want that absence stated clearly, so that I know coverage is partial.
27. As an MCP caller, I want up to five Prochains Passages per Ligne and destination (30 overall), grouped, so that a hub still shows several upcoming trains per direction.
28. As an MCP caller, I want cancelled passages to remain visible with their Statut de passage, so that I do not think a train is still coming.
29. As an MCP caller, I want Statut de passage values such as on time, early, delayed, cancelled, arrived, or departed, so that I can speak like the feed.
30. As an MCP caller, I want v1 grain of Prochain Passage to be the Zone de correspondance, so that one place covers the modes that meet there.
31. As an MCP caller, I want several matching Zones de correspondance (≤5) to union their passages (still under the per-destination and overall caps), so that a shared name still answers.
32. As an MCP caller, I want tool descriptions and user-facing strings in French, so that the agent talks like Île-de-France Mobilités.
33. As an MCP caller, I want datetimes in ISO 8601 with Europe/Paris, so that “dans 4 minutes” is not off by timezone.
34. As an MCP caller, I want `source: "Île-de-France Mobilités"` on payloads, so that Licence Mobilité attribution is present.
35. As an operator, I want Streamable HTTP on `POST /mcp`, so that Cursor/Claude can reach the server without stdio.
36. As an operator, I want the process to bind `0.0.0.0` with `HOST` and `PORT`, so that a reverse proxy or LAN client can connect.
37. As an operator, I want Origin validated against `HOST` when the header is present, so that browser DNS-rebinding is harder.
38. As an operator, I want clients with no Origin header allowed, so that Cursor and Claude keep working.
39. As an operator, I want no MCP bearer token in v1, so that local/LAN setup stays a single PRIM key.
40. As an operator, I want `PRIM_API_KEY` in the environment, so that PRIM `API Key` is never asked of the MCP caller.
41. As an operator, I want the process to exit if `PRIM_API_KEY` is missing, so that a misconfigured host fails immediately.
42. As an operator, I want `GET /health` to return `{ ok, trafic_updated_at, stale }`, so that I can probe the host without MCP.
43. As an operator, I want the Info Trafic snapshot refreshed in-process every two minutes, so that I do not run a second worker.
44. As an operator, I want the first snapshot at boot, so that the first `get_info_trafic` is not an empty cache.
45. As an operator, I want PRIM failures after a successful snapshot to serve that snapshot with `stale: true`, so that Info Trafic survives a PRIM outage.
46. As an operator, I want lookup of Lignes and Zones d'arrêt cached for 24 hours, so that resolution does not burn the daily PRIM quota.
47. As an operator, I want Prochain Passage uncached (live per call), so that estimates are not two minutes late.
48. As an operator, I want the 2-minute Info Trafic cadence, so that a 1000 req/day PRIM palier still leaves budget for lookup and SIRI.
49. As a maintainer, I want domain types for Ligne, Zone d'arrêt, Info Trafic, Prochain Passage, Sévérité, and Statut de passage, so that adapters cannot leak Navitia/SIRI names into the tools.
50. As a maintainer, I want application use-cases to own resolution, clarification, filtering, grouping, and stale flags, so that MCP and HTTP stay thin.
51. As a maintainer, I want PRIM Navitia and PRIM SIRI behind adapters at one application seam, so that tests never call the network.
52. As a maintainer, I want tests to drive the four tools’ behaviour through that application module, so that HTTP transport is not the product contract.
53. As an MCP caller, I want `get_info_trafic` on a Ligne that only has stop-level messages to still return those messages, so that I do not miss a closed station on that Ligne.
54. As an MCP caller, I want candidates in a clarification to be enough to choose (id, label, mode), so that I can call again with a canonical id.
55. As an MCP caller, I want `get_line_id` and `get_stop_id` to use the same match rules as the métier tools, so that behaviour is consistent.
56. As an MCP caller, I want `get_line_id` / `get_stop_id` to return a list of fiches when there are two to five matches, so that union also applies to lookup tools.
57. As an operator, I want Info Trafic pagination of `traffic_reports` only when `total_result` exceeds 1000, so that one slim call covers the usual snapshot.
58. As an MCP caller, I want a required Zone de correspondance query on `prochain_passage`, so that the tool never asks SIRI for an unspecified place. A Zone d'arrêt id is accepted and rolled up to its zone.

## Implementation Decisions

- Greenfield Node/TypeScript server. Four layers: domain (Ligne, Zone d'arrêt, Zone de correspondance, Info Trafic, Prochain Passage, Sévérité, Statut de passage) → application (resolve, get Info Trafic, get Prochain Passage, health, boot) → infra (PRIM Navitia adapter, référentiel zones de correspondance, PRIM SIRI adapter, in-memory caches) → mcp (Streamable HTTP tools). Domain does not import PRIM or MCP.
- Single testable application module whose interface is the four tools plus health and boot fail-fast. MCP HTTP is a thin adapter over it (ADR 0001).
- Transport: Streamable HTTP, `POST /mcp`, bind `0.0.0.0`, env `HOST`, `PORT`, `PRIM_API_KEY`. No stdio. No MCP caller auth. Origin must match `HOST` when present; missing Origin is allowed (ADR 0001).
- PRIM header `API Key` from `PRIM_API_KEY`. Process exits on boot if the env var is absent.
- Info Trafic snapshot: `GET /marketplace/v2/navitia/traffic_reports?count=1000&disable_geojson=true&depth=1` on general v2. Paginate only if `total_result > 1000`. In-process timer every 2 minutes; fetch once at boot. Filter by resolved Ligne at read time. Do not use the line_reports v2 product or the bulk disruptions API as the cache source (ADR 0002).
- Prochain Passage: SIRI Lite requête unitaire `GET /stop-monitoring` with `MonitoringRef` = Zone de correspondance SIRI ref `STIF:StopArea:SP:{ZdCId}:`. Live, uncached. A Zone d'arrêt id is rolled up to its parent zone via the référentiel relations. No Navitia `/stop_schedules` or `/departures` fallback (ADR 0002, ADR 0003).
- Résolution: Navitia `/pt_objects?type[]=line` for Ligne; `/places` for Zone d'arrêt. Accept text, `Cxxxxx`, `line:IDFM:Cxxxxx`, `STIF:Line::Cxxxxx:`, and stop-side SIRI/Navitia ids. Canonical Ligne id is `Cxxxxx`. Referential cache TTL 24h, distinct from the 2-minute Info Trafic cache.
- Match policy: 0 → not found; 1 → proceed; 2–5 → union; >5 → `{ status: "needs_clarification", candidates }`. Same policy on all four tools.
- `get_info_trafic` argument is mandatory. Never return the full network snapshot to the caller.
- `prochain_passage` requires a Zone de correspondance query; Ligne is optional and filters passages after resolution.
- Prochain Passage v1 grain is the Zone de correspondance. Quai-level MonitoringRef stays out. Already-passed visits are dropped (cancelled stays even if the Aimed/Expected time is past, but upcoming visits fill the cap first). Cap 5 passages per Ligne + destination, 30 overall, then group. Cancelled stays in the list. An empty SIRI payload is `summary: "Pas de temps réel"`; an empty leftover after dropping already-passed visits is just `groups: []`. Statut de passage comes from SIRI (`onTime`, `early`, `delayed`, `cancelled`, `arrived`, `departed`, and other values the feed sends). Resolution uses the public référentiel des zones de correspondance, cached 24 hours, distinct from the Navitia Zone d'arrêt lookup used by `get_stop_id` (ADR 0003).
- Info Trafic payload per message: title, text, Sévérité, cause, application periods, impacted Lignes and stops. Envelope: `updated_at`, `stale`. Empty list: `messages: []`, `summary: "Aucune perturbation"`.
- Identity fiches: Ligne `{ id, label, mode, siri_line_ref, navitia_id }`; Zone d'arrêt `{ id, label, siri_monitoring_ref, navitia_id }`.
- `GET /health` → `{ ok, trafic_updated_at, stale }`. After a PRIM outage with a prior snapshot, Info Trafic answers stay successful with `stale: true`. If PRIM is down and there is no snapshot, that is an MCP error. SIRI failure on `prochain_passage` is an error for that call (no stale passages).
- Strings: French tool descriptions and user-facing text. Datetimes ISO 8601, Europe/Paris. Every payload includes `source: "Île-de-France Mobilités"`.
- In-memory caches only in v1. No Redis, no extra process.

## Testing Decisions

- Test external behaviour of the application module only: inputs (text, ids, missing args) → outputs (fiches, messages, passages, clarification, not-found, stale, errors). Do not assert Navitia or SIRI JSON, HTTP framework wiring, or timer internals.
- Inject fake adapters for: Navitia lookup, Info Trafic snapshot, SIRI stop-monitoring, and a controllable clock/cache. The fakes are the second adapter at those infra seams; production PRIM is the other.
- Cover: unique match; union of 2–5; clarification >5; required Ligne / required Zone de correspondance; optional Ligne filter on passages; empty Info Trafic = trafic normal; stale snapshot after a failed refresh; no theoretical fallback when SIRI is empty; passage cap per destination and grouping; already-passed dropped; cancelled included; boot without `PRIM_API_KEY`; health reflects `updated_at` / stale.
- Do not make Streamable HTTP the primary test surface. A thin smoke that the tools are registered is enough if it stays cheap; product behaviour stays on the application seam.
- Prior art: none. Empty repo; this spec defines the first tests.

## Out of Scope

- MCP caller authentication, TLS termination, and binding only to localhost (see ADR 0001 for a future reopen if the port is public).
- stdio transport.
- Quai-level MonitoringRef and theoretical horaires.
- PRIM line_reports v2 product as the Info Trafic cache, Messages Info Trafic — requête globale, SIRI requête globale / requête ligne.
- Dumping the whole Info Trafic snapshot through a tool.
- Persistent cache, separate worker process, quota dashboard, and raising PRIM quotas.
- Journey planning, isochrones, and any Navitia feature other than `traffic_reports`, `/pt_objects`, and `/places`.
- English tool names/descriptions as the default surface.

## Further Notes

- Glossary: `GLOSSARY.md`. Transport: ADR 0001. PRIM products: ADR 0002.
- Default PRIM palier is 1000 req/day. The 2-minute Info Trafic job is ~720/day; lookup and SIRI share the rest. Do not add polling of SIRI.
- SIRI realtime coverage is partial; “no realtime” is a valid successful outcome for a resolved Zone de correspondance, not a reason to call Navitia schedules.
- Feature slug for tickets: `mcp-idfm-v1`.
