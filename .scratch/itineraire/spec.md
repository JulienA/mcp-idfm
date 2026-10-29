# MCP Île-de-France Mobilités — Itinéraire

Status: ready-for-agent

Plan: `docs/plan-itineraire.md`. ADR: `docs/adr/0004-itineraire.md`.

## Problem Statement

An MCP caller can already resolve a Ligne, a Zone d'arrêt, Info Trafic, and live Prochain Passage. They cannot answer “how do I get from here to there” in Île-de-France without knowing PRIM, Navitia `/journeys`, place ids, and `datetime` wire format. Ambiguous names (“Nation”) must not explode into a grid of journey calls. Theoretical Navitia times must not be sold as Prochain Passage; the itinerary itself should still take disruptions into account.

## Solution

One MCP tool, `itineraire` (title **Itinéraire**). It accepts two free-text ends (Zone d'arrêt name or id, street address, or `longitude;latitude`), optional ISO datetime and direction, resolves each end, and if both are unique calls PRIM Navitia `GET /marketplace/v2/navitia/journeys` with `data_freshness=realtime`. The caller never holds `PRIM_API_KEY`. Place searches reuse the 24 h referential cache; itineraries are live and uncached. Two or more matches on either end return `needs_clarification` and do not call `/journeys`.

## User Stories

1. As an MCP caller, I want `itineraire` with a departure and an arrival as text, so that I get an Itinéraire without knowing PRIM URLs.
2. As an MCP caller, I want to pass a Zone d'arrêt name, a street address, a canonical stop id, a Navitia or SIRI stop alias, or `lon;lat`, so that I do not convert formats by hand.
3. As an MCP caller, I want `itineraire` to resolve names itself, so that I am not forced to call `get_stop_id` first.
4. As an MCP caller, I want an optional `horaire` in ISO 8601 with an offset, so that “arrive before 18:30” is not ambiguous.
5. As an MCP caller, I want `sens` `depart` or `arrivee` (default `depart`), so that the datetime is a leave-after or arrive-before constraint.
6. As an MCP caller, I want a missing `horaire` to mean now (Europe/Paris), so that the usual question stays one-shot.
7. As an MCP caller, I want a unique match on both ends to compute immediately, so that obvious trips stay one call.
8. As an MCP caller, I want two or more matches on either end to return `needs_clarification` with candidates for **both** ends, so that I ask the human once and do not compute a cartesian product.
9. As an MCP caller, I want zero matches on a side to mean `not_found` for that side (hiding the other side’s candidates), so that I fix the missing Lieu first.
10. As an MCP caller, I want clarification to be a successful tool result, so that the agent can continue.
11. As an MCP caller, I want to recall `itineraire` with the candidate ids (`Cxxxxx`-style numeric Zone d'arrêt id, or `lon;lat` for an address), so that the second call does not search `/places` again for that end.
12. As an MCP caller, I want coordinates never sent to `/places`, so that a `;` is either a valid `lon;lat` or `not_found`.
13. As an MCP caller, I want up to three Itinéraires per successful calculation, so that alternatives fit in context.
14. As an MCP caller, I want each Itinéraire to include duration in seconds, departure, arrival, transfer count, and Étapes (walk, wait, ride on a Ligne), so that I can explain the trip.
15. As an MCP caller, I want Ligne ids on ride Étapes to be canonical `Cxxxxx`, so that I can call `get_info_trafic` next.
16. As an MCP caller, I want Zone d'arrêt ids on ride endpoints when Navitia provides them, so that I can call `prochain_passage` for live departures at the boarding point.
17. As an MCP caller, I want `horaires: "temps_reel"` on a successful payload, so that I know Navitia took disruptions into account when building the path.
18. As an MCP caller, I want that field never to mean Prochain Passage, so that I still call `prochain_passage` for SIRI estimates at a Zone de correspondance.
19. As an MCP caller, I want an empty itinerary list plus `summary: "Aucun itinéraire"` when Navitia has no solution, so that I do not confuse “no route” with a server error.
20. As an MCP caller, I want a datetime outside the coverage calendar to be `not_found`, so that I can rephrase the time.
21. As an MCP caller, I want PRIM down or timed out on the calculation to be an MCP error with a French sentence, so that I can tell “ask the user” from “the calculator is broken”.
22. As an MCP caller, I want a failed place search to be “Recherche indisponible”, so that lookup failures stay the same sentence as the other tools.
23. As an MCP caller, I want tool descriptions and user-facing strings in French, so that the agent talks like Île-de-France Mobilités.
24. As an MCP caller, I want datetimes in ISO 8601 with Europe/Paris, so that “dans 20 minutes” is not off by timezone.
25. As an MCP caller, I want `source: "Île-de-France Mobilités"` on every payload, so that Licence Mobilité attribution is present.
26. As an operator, I want the same `PRIM_API_KEY` as v1, so that I do not manage a second credential.
27. As an operator, I want every PRIM HTTP call (lookup, traffic_reports, SIRI, journeys) to share one timeout, default 50 seconds, so that a slow `/journeys` does not abort at 10 s while lookup stays on a different budget.
28. As an operator, I want that timeout set by `PRIM_FETCH_TIMEOUT_MS`, so that I can raise or lower it without a rebuild.
29. As an operator, I want a missing or non-positive `PRIM_FETCH_TIMEOUT_MS` to fail boot when the var is present and invalid, and to default to 50000 when absent.
30. As an operator, I want itineraries uncached and place searches cached 24 h, so that a chatty agent spends one `/journeys` per successful trip and reuses `/places`.
31. As an operator, I want no extra polling job, so that the 2-minute Info Trafic cron stays the only timer.
32. As a maintainer, I want a new application port `ItinerairePlanning` injected into `createApplication`, so that tests fake journeys the same way they fake SIRI.
33. As a maintainer, I want Navitia journey JSON parsed in the adapter, so that MCP payloads never contain `section`, `embedded_type`, or `stop_area:` URIs.
34. As a maintainer, I want `searchStops` to keep returning only Zones d'arrêt, so that `get_stop_id` does not start emitting addresses.

## Implementation Decisions

- New slug `.scratch/itineraire/`. Do not silently edit the v1 spec’s out-of-scope line; v1 stays the historical four-tool contract.
- One MCP tool named `itineraire` (ASCII identifier, same register as `prochain_passage`). Title and user-facing copy: **Itinéraire**.
- Input: required `depart`, `arrivee`; optional `horaire` (ISO 8601 **with offset**); optional `sens` (`depart` | `arrivee`, default `depart`). No `modes`, `count`, `via`, `accessible`.
- `count` on Navitia is fixed at 3 (`DEFAULT_MAX_ITINERAIRES`). Not an env var in this spec.
- Place resolution, in process, before any network: `;` means coordinates (`lon;lat`, lon ∈ [-180,180], lat ∈ [-90,90]) or `not_found`; else `normalizeStopQuery`; empty → `not_found`. Then parallel resolve: coordinates are a synthetic Lieu (no HTTP, no cache); other queries go through a **new** 24 h `ReferentialCache<Lieu[]>` to `searchLieux`.
- `searchLieux` is a new adapter method, not `searchStops`. Text: one page `GET .../places?q=&count={maxCandidates}&type[]=stop_area&type[]=address`. Canonical numeric id: `GET .../places/stop_area:IDFM:{id}` (404 → `[]`).
- Match policy **on this tool only**: 0 → `not_found`; 1 → use; 2 or more (including the old 2–5 band) → `needs_clarification` with both ends present as `lieu` or `candidats`. `decideMatches` is not modified; this call site treats `"few"` like `"many"`. Zero matches on one side outranks ambiguity on the other.
- Calculation: one `GET .../journeys` only when both ends are unique. Query: `from`, `to`, `datetime` (`YYYYMMDDTHHMMSS` Europe/Paris), `datetime_represents` (`departure`|`arrival`), `count=3`, `data_freshness=realtime`, `first_section_mode[]=walking`, `last_section_mode[]=walking`, `disable_geojson=true`, `depth=1`. `from`/`to`: Zone d'arrêt → `stop_area:IDFM:{id}`; address or coordinates → `lon;lat`.
- Freshness: **`realtime`**, not `base_schedule`. Julien also accepted `adapted_schedule`. Use `realtime` (Navitia: it includes adapted information). If a live probe shows PRIM rejecting `realtime`, switch the adapter to `adapted_schedule` in the same spec — do not invent a caller-facing toggle. Successful payloads carry `horaires: "temps_reel"`. Tool description states this is Navitia path-level realtime, not SIRI Prochain Passage.
- Section fold: `public_transport` / `on_demand_transport` → Étape `ligne`; walking `street_network` / `transfer` / `crow_fly` with duration > 0 → `marche` (merge consecutive); duration-0 `crow_fly` dropped; `waiting` → `attente`; `stay_in`, `boarding`, `alighting`, `park`, `bss_*`, `ridesharing` dropped. Line id is `Cxxxxx` or `""`. `changements` is Navitia `nb_transfers`, not a recount of Étapes.
- Navitia `error.id`: `no_solution` → `ok` + empty list + `summary: "Aucun itinéraire"`; `date_out_of_bounds` → `not_found` « Horaire hors calendrier »; unknown place ids → `not_found` lieu; timeout / 401 / 403 / 429 / 5xx → `{ status: "error", message: "Impossible de calculer l'Itinéraire" }`. Place-search throws become `LookupUnavailableError`.
- HTTP: one `registerTool`, one sentence appended to `MCP_INSTRUCTIONS`, additive `toolSummary` counts. Existing four tool schemas stay byte-identical.
- Timeout: `primRequest` / `primFetchInit` take a timeout. Default **50_000 ms**. Env `PRIM_FETCH_TIMEOUT_MS` (positive integer). Absent → 50000. Present and invalid → boot failure. Applies to **every** PRIM call (Navitia lookup, traffic_reports, SIRI, journeys). The public OpenDataSoft Zone de correspondance client is not PRIM; leave its own 10 s unless a later spec says otherwise. Pass the value from `boot` → composition root → each PRIM adapter (or through `primRequest` options). Do not add a second HTTP client.
- Quotas: Julien has already raised the PRIM palier. Still do not poll `/journeys`. Still cache `/places` 24 h. Do not cache itineraries.
- `PRIM_API_KEY` unchanged. No second key.
- Glossary: Itinéraire, Lieu, Étape, Changement.
- Files an implementation is expected to touch: domain types; `createApplication` optional port; `src/infra/prim-itineraire.ts`; `src/infra/prim-fetch.ts` (timeout parameter); `boot` / `Config`; `src/index.ts`; `src/http.ts`; `src/http.smoke.test.ts`; `src/application.test.ts` and `src/infra/prim-fetch.test.ts` for the new default; `.env.example`. Do not edit `prim-navitia-lookup.ts` `searchStops` filter.

## Testing Decisions

- Product seam remains `createApplication` with a fake `ItinerairePlanning`. Assert French envelopes, not Navitia JSON.
- Adapter seam: injected `fetch`, committed fixtures. Assert URLs include `data_freshness=realtime` and both `type[]` values; assert mapping (canonical line id, no geojson on Étapes, 404 `no_solution` → `kind: "aucun"`).
- HTTP smoke: additive `toContain("itineraire")` and “temps réel” / “Itinéraire” in instructions. Keep existing `toContain` asserts.
- Timeout tests: default `AbortSignal.timeout(50_000)`; env override; invalid env fails `boot`. Existing 10_000 assertions must move to 50_000 or to the injected value.
- Cover: unique pair → one `plan`; 2+ on one end → `plan` count 0; 2×2 → `plan` count 0 (not 4); coordinates skip `searchLieux`; invalid `;` / missing offset / bad `sens` → no I/O; lookup throw → `LookupUnavailableError`; `plan` indisponible → `{ status: "error" }` without throwing; empty solution summary; calendar miss; 24 h place cache vs uncached `plan`; clarification recall with numeric id + `lon;lat`.
- Live opt-in test, skip when `PRIM_API_KEY` is absent: coordinates example from Navitia docs, `status === "ok"`, `horaires === "temps_reel"`, at least one itinerary, `duree_secondes > 0`. Not in default CI.
- Prior art: `src/application.passages.test.ts` (live adapter fake, `{ status: "error" }` channel), `src/infra/prim-navitia-lookup.test.ts` (injected fetch, 404 → `[]`), `src/infra/prim-fetch.test.ts` (timeout + `apiKey` header).

## Out of Scope

- Isochrones and `line_reports` v2 (separate PRIM products).
- Selling an Itinéraire as Prochain Passage, or replacing SIRI with Navitia `/departures`.
- Zone de correspondance as the itinerary grain (ADR 0003 stays for passages).
- Fares, polylines, intermediate stop lists, bike/car/BSS fallback, wheelchair, via, `eviter_modes`.
- POI and commune search in this spec (`stop_area` + `address` + coordinates only).
- Union of 2–5 Lieux into multiple `/journeys` calls.
- Caching itineraries. Polling. A second API key. A second HTTP client.
- Annotating Étapes with the Info Trafic snapshot (the agent calls `get_info_trafic` with the Ligne id).
- Changing `get_stop_id` / `searchStops` to return addresses.

## Further Notes

- Glossary: `GLOSSARY.md`. Shape: ADR 0004. PRIM products for passages and Info Trafic: ADR 0002, ADR 0003.
- Palier 0 (live `/journeys` 200 vs 403) was still unverified in the planning VM: `PRIM_API_KEY` is a Cloud environment secret and is not visible to an already-running agent. The next implementation run that has the variable can record fixtures.
- Navitia `realtime` vs SIRI: realtime `/journeys` avoids or retimes disrupted vehicle journeys when the feed allows it. SIRI `stop-monitoring` is the clock at a Zone de correspondance. Both can be true at once; they answer different questions.
- Feature slug for tickets: `itineraire`.
