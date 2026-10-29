# Plan : estimation d'itinéraire

Plan d'implémentation, pas le code. Décision de forme d'abord, puis ce que l'agent d'implémentation doit construire, dans cet ordre.

**Décision.** Un seul outil MCP, `itineraire` (titre **Itinéraire**). Il résout les deux extrémités (Zone d'arrêt, adresse ou `longitude;latitude`) puis appelle `GET /marketplace/v2/navitia/journeys` avec `data_freshness=realtime`. Le calcul **prend les perturbations en compte** pour construire le chemin. Ça ne remplace pas `prochain_passage` (SIRI à une Zone de correspondance) ni `get_info_trafic` (texte des messages). Spec : `.scratch/itineraire/spec.md`. ADR : `docs/adr/0004-itineraire.md`.

## Décisions Julien (29 oct. 2026, Europe/Paris)

| Question | Décision |
| --- | --- |
| Clé | `PRIM_API_KEY` ajoutée aux secrets de l'environnement Cloud. **Pas visible dans cet agent déjà démarré** — un secret d'environnement n'est injecté qu'au boot suivant. Palier 0 (GET live 200 vs 403) à passer au prochain run. |
| Fraîcheur | `data_freshness=realtime` (Julien accepte aussi `adapted_schedule`). Navitia : realtime **inclut** l'offre adaptée. Payload `horaires: "temps_reel"`. Pas `base_schedule`. |
| Quota | Palier déjà augmenté. Plus une contrainte de livraison. Toujours pas de polling `/journeys`. |
| Timeout | **Global 50 s**, env `PRIM_FETCH_TIMEOUT_MS` (défaut 50000). Tous les appels `primRequest` (lookup, traffic_reports, SIRI, journeys). |
| Nom | **Itinéraire** — identifiant d'outil `itineraire` (ASCII, comme `prochain_passage`). |
| Spec | Nouveau slug `.scratch/itineraire/`. |

Ambiguïté 2–5, types de lieux (stop + adresse + coordonnées), Info Trafic hors Étapes : inchangés (clarifier, pas d'union ; pas de POI/commune ; l'agent rappelle `get_info_trafic`).

Ce document reste le contrat d'implémentation. Le palier 0 live n'est pas vert **dans cette VM**. Spec, ADR et glossaire du palier 1 sont écrits.

## Synthèse de forme

Deux formes ont été dessinées.

| | A — un outil profond | B — deux outils (`trouver_lieu` + `itineraire`) |
| --- | --- | --- |
| Appels MCP pour « de Nation à Rivoli » | 1, ou 2 si clarification | 3 (2 géocodages + 1 calcul) |
| Politique d'ambiguïté | 2+ → `needs_clarification` sur le même outil | Liste classée ; l'agent choisit |
| Surface publique | `depart`, `arrivee`, `horaire?`, `sens?` | LieuRef + `partir_a` / `arriver_avant` + modes à éviter |
| Diff | Un port, un adapter, un use-case | Deux ports, deux adapters, grammaire `geo:`, refactor de `cachedSearch` |

**Base : A.** C'est le plus petit diff qui répond à « comment aller de X à Y » sans forcer l'agent à enchaîner deux outils. Les outils métier v1 résolvent déjà le texte eux-mêmes (spec v1, stories 3 et 6). Un second outil de géocodage casse cette habitude et déplace la règle « ne pas faire le produit cartésien » dans l'agent.

**Greffé de B.** Marquer `horaires: "temps_reel"` sur chaque succès. Mapper les `error.id` Navitia (`no_solution`, `date_out_of_bounds`). Enregistrer des fixtures live avant d'écrire le parser. Chaîner les Étapes vers `prochain_passage` / `get_info_trafic` via les ids canoniques (`Cxxxxx`, id numérique de Zone d'arrêt). `disable_geojson=true`. `first_section_mode[]=walking` et `last_section_mode[]=walking`. Pas de `traveler_type`.

**Rejeté de B pour v1.** Second outil MCP, `geo:lat,lon` (Navitia parle `lon;lat`), `eviter_modes`, `accessible`, POI/commune, bbox Île-de-France, déplacement de `cachedSearch` / `normalizeStopQuery`.

## Hors périmètre de cette livraison

- Isochrones (produit PRIM distinct, quotas mensuels).
- `line_reports` v2.
- Horaires théoriques présentés comme Prochain Passage (ADR 0002).
- Grain Zone de correspondance (ADR 0003) : un Itinéraire part d'un **Lieu** Navitia, pas d'un `MonitoringRef` SIRI.
- Tarifs, polylines, listes d'arrêts intermédiaires, vélo/voiture/BSS, fauteuil, via.
- Polling. Cache des Itinéraires. Seconde clé API. Second client HTTP.
- Timeout 10 s figé (remplacé par 50 s configurable — ça **modifie** `primRequest` pour les quatre outils existants).

La spec v1 dit aujourd'hui : « Journey planning, isochrones, and any Navitia feature other than `traffic_reports`, `/pt_objects`, and `/places` » (`.scratch/mcp-idfm-v1/spec.md`). Ajouter l'itinéraire **rouvre ce hors-périmètre**. Ce n'est pas un patch silencieux de v1.

---

## 1. Comment les outils actuels parlent à PRIM

Quatre couches : domaine → application → infra → MCP HTTP. PRIM n'est atteint que par des adapters injectés dans `createApplication`. Les tests produit ne tapent jamais le réseau.

```mermaid
flowchart TD
  C[MCP POST /mcp] --> R[registerTools / toolResult]
  R --> APP[createApplication]
  APP -->|getLineId / getStopId| CACHE[cache référentiel 24 h]
  CACHE -->|miss| NL[createPrimNavitiaLookup]
  APP -->|getInfoTrafic| SNAP[snapshot mémoire]
  CRON[boot + cron 2 min] --> TRF[createPrimTrafficReports] --> SNAP
  APP -->|prochainPassage| ZC[référentiel public OpenDataSoft]
  APP -->|prochainPassage| SIRI[createPrimSiriStopMonitoring]
  NL --> PR[primRequest]
  TRF --> PR
  SIRI --> PR
  PR --> PRIM[(PRIM marketplace)]
```

### Auth et client HTTP — réutilisable tel quel

- Variable `PRIM_API_KEY`. `boot()` refuse de démarrer si elle est absente ou blanche (`src/application/index.ts`). La clé n'entre pas dans `Config`.
- Composition : `src/index.ts` relit `process.env.PRIM_API_KEY` et la passe aux trois adapters PRIM (`createPrimNavitiaLookup`, `createPrimTrafficReports`, `createPrimSiriStopMonitoring`).
- Chaque requête PRIM passe par `primRequest` (`src/infra/prim-fetch.ts`) : header Fetch-légal `apiKey` (pas `API Key`, illégal dans Fetch), `AbortSignal.timeout` (aujourd'hui 10 s **figé** ; l'implémentation le passe à 50 s via `PRIM_FETCH_TIMEOUT_MS`), GET par défaut, pas de retry. Un non-2xx est **rendu** à l'adapter ; seul un `fetch` rejeté (timeout, réseau) est relancé.
- Pino masque `PRIM_API_KEY`, `apiKey`, `*.apiKey`, `*.PRIM_API_KEY`. Le chemin logué est `pathname + search` : ne jamais mettre la clé dans la query.
- La Zone de correspondance n'utilise **pas** `primRequest` : host public `data.iledefrance-mobilites.fr`, sans clé.

### Endpoints déjà appelés

Base Navitia : `https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia` (constante privée de `prim-navitia-lookup.ts`).

| Outil | Chemin PRIM | Quand |
| --- | --- | --- |
| `get_line_id` | `/pt_objects?q=&count=1000&type[]=line` ou `/lines/line:IDFM:Cxxxxx` | miss cache 24 h |
| `get_stop_id` | `/places?q=&count=200&type[]=stop_area` ou `/places/stop_area:IDFM:{id}` | miss cache 24 h |
| `get_info_trafic` | `/traffic_reports?count=1000&disable_geojson=true&depth=1` | boot + toutes les 2 min, **pas** à l'appel |
| `prochain_passage` | SIRI `/marketplace/stop-monitoring?MonitoringRef=` | live, non caché |

`/journeys` n'existe nulle part dans le dépôt.

`get_stop_id` filtre `embedded_type === "stop_area"`. Une adresse ou un POI ne sort jamais de `searchStops`. **Ne pas élargir `searchStops`** : ça casserait le contrat Zone d'arrêt.

### Erreurs et format de sortie — réutilisable avec un choix

Deux canaux déjà compris par `toolResult` (`src/http.ts`) :

1. Throw `LookupUnavailableError` / `SnapshotUnavailableError` → MCP `isError`, phrase française, HTTP 200. Messages figés (« Recherche indisponible », « Info Trafic indisponible »).
2. Retour `{ status: "error", message }` → même wrapping MCP. C'est le canal SIRI.

`not_found` et `needs_clarification` sont des **succès** MCP (JSON intact, `source: "Île-de-France Mobilités"`).

Pour l'itinéraire : échec de recherche de lieu → `LookupUnavailableError`. Échec du calcul live → `{ status: "error", message: "Impossible de calculer l'Itinéraire" }` (canal SIRI, **sans** toucher à `instanceof` dans `http.ts`).

### Politique de match — à ne pas copier telle quelle

`decideMatches` : 0 → `not_found` ; 1 → `fiche` ; 2–5 → **union** de `fiches` ; >5 → `needs_clarification` avec **tous** les candidats.

L'union 2–5 est juste pour Info Trafic et Prochain Passage. Pour un Itinéraire, 5 départs × 5 arrivées = jusqu'à 25 `GET /journeys` et une réponse illisible. **Sur cet outil seulement** : 2 ou plus → `needs_clarification`, zéro appel `/journeys`. `decideMatches` n'est pas modifié ; le use-case traite `"few"` comme `"many"`.

### Ce qui se réutilise / ce qui ne se réutilise pas

| Pièce | Verdict |
| --- | --- |
| `primRequest`, factory `{ apiKey, fetch?, log? }`, boot `PRIM_API_KEY`, redaction | Réutiliser |
| Base URL Navitia + `/journeys` | Réutiliser la base (la recopier dans le nouvel adapter, ne pas exporter depuis le lookup) |
| `toolResult`, enveloppe `status` / `source` / `formatIsoParis` | Réutiliser |
| `canonicalLineId` sur les Étapes transport | Réutiliser |
| `searchStops` / `get_stop_id` | Trop étroit (stop_area seulement) |
| `CorrespondanceLookup` | Pas d'`navitia_id` ; grain SIRI |
| Union 2–5 de `decideMatches` | Interdite sur ce use-case |
| `LookupUnavailableError` message | OK pour le géocodage ; pas pour le calcul |
| Timeout 10 s figé | **Remplacer** : défaut 50 s, env `PRIM_FETCH_TIMEOUT_MS`, tous les `primRequest` |

---

## 2. Endpoints Navitia exacts via PRIM

Produit catalogue : [Calculateur Île-de-France Mobilités – Accès générique (v2)](https://prim.iledefrance-mobilites.fr/fr/apis/idfm-navitia-general-v2) (`idfm-navitia-general-v2`). Thèmes PRIM : « Calculateur d'itinéraires, Horaires théoriques ». Ce produit **inclut** recherche de lieux, horaires théoriques **et calcul d'itinéraires**.

Isochrones et `line_reports` sont d'**autres** items catalogue. Le playground PRIM le dit : champ Navitia vide = accès générique ; `isochrones` et `line_reports` = autres APIs.

URL playground ([doc PRIM](https://prim.iledefrance-mobilites.fr/fr/aide-et-contact/documentation/prise-en-main-des-api/prise-en-main-des-api-calculateur-ile-de-france-mobilites/utilisation-du-playground)) :

```text
https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/${API_NAVITIA}/${PATH}/${FEATURE}?${QUERY_PARAMS}
```

Pour l'accès générique, `API_NAVITIA` est vide. Donc :

```text
GET https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys?...
GET https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/places?...
```

Auth : **le même** header `apiKey` que `/places` et `/traffic_reports`.

### `/places` — géocoder

Déjà utilisé, mais `type[]=stop_area` seulement. Pour l'itinéraire, **nouvel** appel (nouvel adapter), une page, pas de boucle 20 pages :

```text
GET .../places?q={query}&count={maxCandidates}&type[]=stop_area&type[]=address
```

Id canonique numérique :

```text
GET .../places/stop_area:IDFM:{id}
```

404 → liste vide (comme le lookup actuel). Autre non-OK → throw → `LookupUnavailableError`.

`from` / `to` de `/journeys` acceptent aussi `longitude;latitude` (ordre Navitia, ex. `2.3749036;48.8467927`, [doc Navitia `/journeys`](https://doc.navitia.io/#journeys)). Dans ce cas **aucun** `/places`.

### `/journeys` — calculer

Paramètres **utiles pour v1** (le reste reste dans l'adapter, pas sur le MCP) :

| Paramètre | Valeur v1 | Rôle |
| --- | --- | --- |
| `from` | `stop_area:IDFM:{id}` ou `lon;lat` | Départ. Obligatoire avec `to` (sinon isochrone, hors périmètre). |
| `to` | idem | Arrivée. |
| `datetime` | `YYYYMMDDTHHMMSS` mur Europe/Paris | Instant demandé. Défaut Navitia : maintenant. |
| `datetime_represents` | `departure` \| `arrival` | Après / avant cet instant. Défaut : `departure`. |
| `count` | `3` | Nombre fixe d'itinéraires distincts. |
| `data_freshness` | `realtime` | Les disruptions **recalculent** le chemin (Navitia : realtime inclut l'offre adaptée). Julien accepte aussi `adapted_schedule` si PRIM refuse `realtime`. Ce n'est pas SIRI. |
| `first_section_mode[]` / `last_section_mode[]` | `walking` | Ne pas s'appuyer sur `traveler_type` (il peut injecter voiture/vélo). |
| `disable_geojson` | `true` | Même geste que `traffic_reports` : payload plus petit. |
| `depth` | `1` | À vérifier sur fixture live (question ouverte : `stop_area` des sections). |

**Non exposés en v1 :** `forbidden_uris[]`, `allowed_id[]`, `traveler_type`, `wheelchair`, `max_nb_transfers`, `direct_path`, `timeframe_duration`, isochrone (un seul de `from`/`to`).

### Réponse à résumer — ne pas renvoyer le JSON Navitia

Objet racine ([doc Navitia](https://doc.navitia.io/#journeys)) : `journeys[]`, `disruptions[]`, `tickets[]`, `links`, `feed_publishers`.

Chaque journey :

- `duration` (secondes), `nb_transfers`, `departure_date_time`, `arrival_date_time`, `status` (effet disruption sur montée/descente : `NO_SERVICE`, `SIGNIFICANT_DELAYS`, `MODIFIED_SERVICE`, ou vide), `type` (qualification), `sections[]`.

Chaque section, `type` :

| Type Navitia | Étape MCP |
| --- | --- |
| `public_transport`, `on_demand_transport` | `ligne` (`Cxxxxx`, label, mode, headsign, de/vers, horaires) |
| `street_network` (walking), `transfer`, `crow_fly` durée > 0 | `marche` (fusionner les marches consécutives) |
| `crow_fly` durée 0 | jeter (téléport dans une stop_area) |
| `waiting` | `attente` |
| `stay_in`, `boarding`, `alighting`, `park`, `bss_*`, `ridesharing` | jeter en v1 |

Datetimes Navitia : `YYYYMMDDTHHMMSS` = heure murale du coverage. Convertir via Europe/Paris vers ISO 8601 (`formatIsoParis`), comme `navitiaDateToIso` dans `prim-traffic-reports.ts` (helper privé : **dupliquer** dans le nouvel adapter, ne pas l'exporter du trafic).

Disruptions : avec `realtime`, Navitia évite ou retarde les courses touchées quand le flux le permet. `journey.status` peut être `NO_SERVICE`, `SIGNIFICANT_DELAYS`, `MODIFIED_SERVICE`. On **n'attache pas** le texte Info Trafic aux Étapes. L'agent enchaîne `get_info_trafic` avec le `Cxxxxx`. On pose `horaires: "temps_reel"` et la description d'outil dit que ce n'est pas un Prochain Passage SIRI.

Erreurs Navitia documentées en HTTP 404 + `error.id` (à pinner par fixture PRIM, le statut exact n'est pas dans ce dépôt) :

| `error.id` | Résultat application |
| --- | --- |
| `no_solution` | `ok` + `itineraires: []` + `summary: "Aucun itinéraire"` |
| `date_out_of_bounds` | `not_found` « Horaire hors calendrier » |
| `no_origin` / `no_destination` / `unknown_object` | `not_found` lieu |
| timeout, 401, 403, 429, 5xx | `{ status: "error", message: "Impossible de calculer l'Itinéraire" }` |

Un 403 est le signal « clé non abonnée à ce produit » — voir §4.

---

## 3. Outil MCP proposé

### Nom

Identifiant MCP : `itineraire` (ASCII). Titre et copies : **Itinéraire**. Même registre que `prochain_passage` (nom métier, pas `get_*`).

Description française, annotations `readOnlyHint` / `openWorldHint` comme les quatre outils. Une phrase ajoutée à `MCP_INSTRUCTIONS` : les questions d'itinéraire appellent `itineraire` directement ; `get_stop_id` n'est pas un prérequis ; une clarification est un succès, l'agent montre tous les candidats **des deux** côtés puis rappelle **une** fois.

### Schéma d'entrée

```ts
{
  depart: string;   // requis
  arrivee: string;  // requis
  horaire?: string; // ISO 8601 avec offset, ex. 2026-10-29T18:30:00+01:00
  sens?: "depart" | "arrivee"; // défaut "depart" → datetime_represents=departure
}
```

Pas de `modes`, pas de `count`, pas de `via`. `count` Navitia est fixé à 3 dans le use-case (`DEFAULT_MAX_ITINERAIRES`).

### Résolution des lieux

Chaque extrémité, **avant** tout réseau :

1. Chaîne contenant `;` → coordonnées. Doit matcher `lon;lat` avec lon ∈ [-180,180], lat ∈ [-90,90]. Sinon `not_found` « Coordonnées invalides … ». Jamais envoyée à `/places`.
2. Sinon `normalizeStopQuery` (déjà là) : `stop_area:IDFM:73641` et `STIF:StopArea:SP:73641:` → `73641`.
3. Vide après trim → `not_found` sans I/O.

Puis, **en parallèle** :

- Coordonnées → un `Lieu` synthétique `{ id: "lon;lat", genre: "coordonnees" }`. Pas d'appel, pas de cache.
- Sinon `cachedSearch` sur un **nouvel** LRU 24 h (même factory que les caches ligne/arrêt/zone, instance séparée) → `searchLieux`.
  - Id tout-chiffres → `GET /places/stop_area:IDFM:{id}`.
  - Texte → une page `/places` `type[]=stop_area` + `type[]=address`.

Ids renvoyés aux candidats, pour rappel sans second géocodage :

- Zone d'arrêt → id canonique numérique (`canonicalStopId`).
- Adresse → `lon;lat` de la coordonnée Navitia (pas d'URI `address:`).

### Politique d'ambiguïté (cet outil seulement)

| Matches d'un côté | Effet |
| --- | --- |
| 0 | `not_found` pour ce côté (ou les deux). Pas de candidats de l'autre côté. Pas de `/journeys`. |
| 1 | Lieu unique. |
| 2 ou plus | `needs_clarification`. Les deux clés `depart` / `arrivee` sont présentes (`lieu` ou `candidats`). **Zéro** `/journeys`. Y compris l'ancienne bande 2–5. |

Pire cas quota : 2 `/places` (cachés 24 h) + 1 `/journeys` (jamais caché), seulement si les deux côtés sont uniques.

### Schéma de sortie

```ts
type LieuGenre = "zone_d_arret" | "adresse" | "coordonnees";

type LieuPublic = {
  id: string;
  label: string;
  genre: LieuGenre;
  mode?: string; // seulement Zone d'arrêt
};

type EtapeItineraire =
  | { genre: "marche"; duree_secondes: number; de: string; vers: string }
  | { genre: "attente"; duree_secondes: number; lieu: string }
  | {
      genre: "ligne";
      ligne: { id: string; label: string; mode: string }; // id = Cxxxxx
      destination: string;
      de: string;
      vers: string;
      depart: string;  // ISO Paris
      arrivee: string;
    };

type Itineraire = {
  depart: string;
  arrivee: string;
  duree_secondes: number;
  changements: number; // nb_transfers Navitia, ne pas recompter les Étapes
  etapes: EtapeItineraire[];
};

type ItineraireResult =
  | {
      status: "ok";
      horaires: "temps_reel";
      itineraires: Itineraire[];
      summary?: "Aucun itinéraire";
      source: "Île-de-France Mobilités";
    }
  | { status: "not_found"; message: string; source: "Île-de-France Mobilités" }
  | {
      status: "needs_clarification";
      depart: { lieu: LieuPublic } | { candidats: LieuPublic[] };
      arrivee: { lieu: LieuPublic } | { candidats: LieuPublic[] };
      source: "Île-de-France Mobilités";
    }
  | {
      status: "error";
      message: "Impossible de calculer l'Itinéraire";
      source: "Île-de-France Mobilités";
    };
```

Aucun nom Navitia sur cette surface : pas de `journey`, `section`, `embedded_type`, `datetime_represents`, `display_informations`, `geojson`, URI `line:` / `stop_area:` / `address:`.

### Signatures internes (sketch, bodies `not implemented`)

```ts
export type ItinerairePlanning = {
  searchLieux(query: string, limit: number): Promise<Lieu[]>;
  plan(input: {
    depart: Lieu;
    arrivee: Lieu;
    horaire: Date;
    sens: "depart" | "arrivee";
    count: number;
  }): Promise<
    | { kind: "ok"; itineraires: ItineraireCalcule[] }
    | { kind: "aucun" }
    | { kind: "hors_calendrier" }
    | { kind: "indisponible" }
  >;
};

export function createApplication(deps: {
  lookup: NavitiaLookup;
  correspondances?: CorrespondanceLookup;
  clock?: Clock;
  snapshot?: InfoTraficSnapshot;
  stopMonitoring?: StopMonitoring;
  itineraires?: ItinerairePlanning; // défaut : throw si la méthode est appelée
  maxCandidates?: number;
  maxPassagesPerGroup?: number;
  maxPassages?: number;
}): Application;

// boot Config s'élargit :
// primFetchTimeoutMs: number  // défaut 50_000, env PRIM_FETCH_TIMEOUT_MS
// passé aux adapters PRIM / primRequest, pas au use-case application

// sur l'objet retourné
itineraire(
  depart: string,
  arrivee: string,
  options?: { horaire?: string; sens?: "depart" | "arrivee" },
): Promise<ItineraireResult>;
```

Nouvel adapter `createPrimItineraire({ apiKey, fetch?, log? })` dans `src/infra/prim-itineraire.ts`. Il **ne** touche **pas** `prim-navitia-lookup.ts`. `src/index.ts` le passe avec la même `apiKey`.

### Termes de glossaire à ajouter à l'implémentation (pas dans ce diff)

- **Itinéraire** : trajet calculé d'un Lieu à un autre, chemin Navitia temps réel, suite d'Étapes. _Avoid_: journey, isochrone, Prochain Passage.
- **Lieu** : départ ou arrivée : Zone d'arrêt, adresse, ou `longitude;latitude`. _Avoid_: place, stop_point, POI comme mot pour tout.
- **Étape** : une marche, une attente, ou un trajet sur une Ligne. _Avoid_: section, leg.
- **Changement** : nombre de correspondances d'un Itinéraire. _Avoid_: Zone de correspondance.

### Usage agent

```text
itineraire { depart: "Nation", arrivee: "10 Rue de Rivoli, Paris" }
  → needs_clarification (plusieurs Nation) ; plan non appelé
itineraire { depart: "71264", arrivee: "2.3588;48.8556" }
  → ok, jusqu'à 3 Itinéraires (`horaires: "temps_reel"`)
itineraire { depart: "2.2945;48.8584", arrivee: "Gare de Lyon",
             horaire: "2026-10-29T18:30:00+01:00", sens: "arrivee" }
  → ok ou clarification sur Gare de Lyon ; le départ coordonnée n'appelle pas /places
```

---

## 4. Point bloquant : la clé PRIM a-t-elle accès à `/journeys` ?

**Ne jamais lire ni afficher une valeur de secret.** Ici : présence, noms de variables, chemins d'API. Pas la valeur.

### Ce que le code et la doc disent

La clé unique du process est `PRIM_API_KEY`. Elle part en header `apiKey` via `primFetchInit`. Les trois adapters PRIM (lookup Navitia, `traffic_reports`, SIRI) reçoivent **la même** chaîne. Il n'y a pas de seconde clé « Navitia ».

Les appels Navitia déjà en production (`/places`, `/pt_objects`, `/lines`, `/traffic_reports`) tapent le produit **Accès générique v2**. La fiche PRIM de ce produit liste explicitement le calcul d'itinéraires. `/journeys` est une **feature du même item catalogue**, pas l'API Isochrones ni `line_reports`.

SIRI requête unitaire est un **autre** produit (`/marketplace/stop-monitoring`). Ça n'informe pas sur `/journeys`.

Quotas : Julien a déjà augmenté le palier. Le cron Info Trafic (~720/jour) n'est plus le facteur limitant annoncé en v1. Toujours pas de polling `/journeys`.

### Ce que cette VM n'a pas pu prouver

Julien a ajouté `PRIM_API_KEY` aux secrets de l'environnement Cloud. Dans **cet** agent, la variable est toujours unset (pas de `.env`). Un secret d'environnement Cloud s'injecte au boot : [env-setup](https://cursor.com) — *Configuration changes affect newly started agents, never an already-running agent.*

Aucun GET live n'a donc été tenté ici. Pas de fixture `/journeys` dans le dépôt. Le prochain run d'implémentation, avec la clé injectée, exécute le GET ci-dessous (header seulement, ne jamais logger la valeur) et commite un JSON sanitisé.

```text
GET https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys?from=2.3749036;48.8467927&to=2.2922926;48.8583736&count=1&disable_geojson=true&data_freshness=realtime
```

| Statut | Lecture |
| --- | --- |
| 200 + `journeys` | Accès OK + realtime OK. Fixture. |
| 400 / erreur de paramètre sur `realtime` | Réessayer `adapted_schedule` (accepté par Julien). |
| 200 + `error.id=no_solution` | Accès OK, pas d'itinéraire pour ce couple. |
| 401 / 403 | Clé refusée ou non abonnée. Bloquant pour l'adapter. |
| 429 | Quota. Improbable si le palier est déjà augmenté. |
| timeout | Avec 50 s ça ne devrait plus être le 10 s d'avant. |

Tant que le GET n'a pas rendu 200, **ne pas implémenter l'adapter live**. Spec, types et tests application sur fake peuvent avancer.

---

## 5. Blast radius

**Le fait de sûreté (outils métier).** Ajouter un port optionnel `itineraires?` dont le défaut throw seulement si `app.itineraire()` est appelé, plus un `registerTool` **additif**, ne change pas les quatre outils existants **à condition de ne pas modifier** `searchStops`, `decideMatches`, les adapters SIRI/trafic/zones, ni les schémas des quatre `registerTool`.

**Exception demandée par Julien.** `primRequest` **change** : timeout 10 s → 50 s configurable. Ça touche lookup, Info Trafic, SIRI et le futur `/journeys`. Les tests `prim-fetch.test.ts` et `boot` bougent. Le comportement métier des quatre outils (enveloppes, match policy) ne change pas ; seule la durée d'abort change.

Preuve au graphe d'appels (niveau 3 — le code a été lu ; les tests n'ont pas été relancés ici : pas de `node_modules` sur cette VM) :

- `createApplication` a déjà des ports optionnels (`correspondances?`, `stopMonitoring?`, `snapshot?`) avec stub qui throw (`src/application/index.ts`). Les tests identité construisent `createApplication({ lookup })` seulement (`src/application.identity.test.ts`). Un port de plus, optionnel, compile et les chemins existants ne le lisent pas.
- `getStopId` n'appelle que `lookup.searchStops`. `searchStops` force `type[]=stop_area` (`src/infra/prim-navitia-lookup.ts`). Un nouvel adapter `/places` multi-types **à côté** ne change pas cet URL.
- `http.smoke.test.ts` utilise `toContain` sur les noms d'outils, pas une liste exacte. Ajouter `itineraire` ne casse pas ces asserts. Modifier `MCP_INSTRUCTIONS` par **suffixe** préserve les `toContain("prochain_passage")` / `"Châtelet"` / `"needs_clarification"`.
- `toolSummary` ignore les clés inconnues. Sans ajout de `itineraires` dans le summary, les logs des quatre outils restent les mêmes ; l'ajout de clés **optionnelles** est additif.

**Risques retenus**

| Risque | Où | Probabilité / coût | Comment vérifier |
| --- | --- | --- | --- |
| Timeout 50 s sur SIRI et `traffic_reports` | `prim-fetch.ts`, tous les adapters PRIM | certaine (c'est le but) / une requête pendante occupe 50 s au lieu de 10 | Tests timeout + boot ; le cron 2 min n'est pas bloqué (`protect` sur Croner) |
| `realtime` absent ou 400 sur PRIM | query `data_freshness` | inconnue / calcul en erreur | Palier 0 avec `realtime` puis `adapted_schedule` |
| 2–5 « Nation » : comportement différent de `prochain_passage` | `itineraire` vs `decideMatches` | certaine / l'agent doit clarifier | Description d'outil + tests « few → clarification, plan count = 0 » |
| Confusion Itinéraire Navitia / Prochain Passage SIRI | ADR 0002, ADR 0004 | moyenne / horaires mal attribués | Champ `horaires: "temps_reel"` + phrase d'instructions « pas un Prochain Passage » |
| Cache 24 h d'un `/places` vide | `cachedSearch` actuel cache aussi `[]` | déjà vrai pour les arrêts / `not_found` collant | Ne pas inventer une politique différente ; documenter |
| `MCP_INSTRUCTIONS` plus longues → l'agent délaisse `prochain_passage` | `src/http.ts` | faible / horaires live manqués | Une phrase, pas un paragraphe ; smoke `toContain("prochain_passage")` |

**Cleared**

- Origin, `/health`, cron Info Trafic, référentiel zones : inchangés en comportement.
- `prim-navitia-lookup.ts` `searchStops` reste `type[]=stop_area` only (byte-identical sur le filtre).
- Nouvelle env var **`PRIM_FETCH_TIMEOUT_MS`** (demandée). `boot` et `Config` s'élargissent. `.env.example` aussi.
- Couverture vitest : `src/application/**` à 80 %. Le use-case doit vivre dans `application/` avec `application.itineraire.test.ts`, sinon le seuil casse.

**Avant merge de l'implémentation (pas de ce plan)**

Le test le moins cher qui attrape la vraie régression : `application.identity.test.ts` + `application.passages.test.ts` + `application.traffic.test.ts` inchangés et verts, **plus** un cas « `itineraire` avec 2 départs → `plan` appelé 0 fois ».

---

## 6. Stratégie de tests

Seam produit : `createApplication`, fake `ItinerairePlanning`. C'est le contrat. Les tests n'assertent pas le JSON Navitia (spec v1 Testing Decisions).

Seam adapter : `createPrimItineraire` avec `fetch` injecté, fixtures JSON **commitées**. Assertent URLs (`/places` a les deux `type[]`, `/journeys` a `from,to,datetime,datetime_represents,count,data_freshness=realtime,first_section_mode[],last_section_mode[],disable_geojson`) et le mapping vers `Lieu` / `CalculItineraire`.

Seam HTTP : smoke additif (`tools/list` contient `itineraire`, instructions mentionnent « temps réel » / « Itinéraire »). Pas de test produit via Streamable HTTP.

### Cas application (fake, clock injecté)

1. Deux lieux uniques → un `plan`, `count: 3`, `sens: "depart"`, `horaire` = clock, ISO Paris, `horaires: "temps_reel"`, `source`.
2. `horaire` avec offset + `sens: "arrivee"` transmis tels quels à `plan`.
3. `lon;lat` n'appelle pas `searchLieux`.
4. `;` mal formé, `horaire` sans offset, `sens` hors enum, côté blanc : pas d'I/O, `not_found`.
5. Deux départs → clarification, `plan` count = 0.
6. Deux × deux → les deux listes de candidats, `plan` count = 0 (pas 4).
7. Plus de `maxCandidates` → au plus `maxCandidates` candidats, `plan` = 0.
8. Zéro d'un côté, plusieurs de l'autre → `not_found` du côté vide, **pas** de candidats, `plan` = 0.
9. `searchLieux` throw → `LookupUnavailableError`, `plan` = 0.
10. `plan` `indisponible` → `{ status: "error" }`, la méthode ne throw pas.
11. `plan` `aucun` → `summary: "Aucun itinéraire"`.
12. `plan` `hors_calendrier` → `not_found` « Horaire hors calendrier ».
13. Même texte dans les 24 h → un `searchLieux`, deux `plan`. Après 24 h, recherche à nouveau. Le calcul n'est jamais servi du cache.
14. Rappel clarification (id numérique + `lon;lat`) → un `plan`.

Valeurs attendues : littéraux (Châtelet, `C01373`, durées en secondes), pas un recomput du mapper.

### Cas adapter

- `/places` texte : `type[]=stop_area` et `type[]=address`, pas d'autre type, pas de `start_page`.
- Id numérique → resource `stop_area:IDFM:`, 404 → `[]`.
- Adresse sans coordonnée → drop.
- Ligne sans `Cxxxxx` → `id: ""` (ne pas recopier l'URI).
- `no_solution` / `date_out_of_bounds` / 500 → les trois `kind`.
- Pas de `geojson` dans l'Étape retournée.

### Appel réel

Possible seulement si palier 0 vert. Un test **opt-in**, skip si `PRIM_API_KEY` absent :

```text
itineraire("2.3749036;48.8467927", "2.2922926;48.8583736")
```

Assert : `status === "ok"`, `horaires === "temps_reel"`, `itineraires.length >= 1`, `duree_secondes > 0`. Pas d'assert sur un horaire précis (l'offre bouge). Ne pas logger la clé. Ne pas l'activer en CI par défaut.

Cette VM n'a pas pu lancer cet appel (`PRIM_API_KEY` unset ici).

TDD : un cas rouge → assez de code pour le vert → suivant. Pas tous les cas d'abord (skill tdd, anti-pattern horizontal slicing).

---

## 7. Étapes d'implémentation

Petites unités, chacune vérifiable.

**Palier 1 (spec, ADR, glossaire) est fait dans ce diff.** Palier 0 live reste à faire au prochain boot avec la clé. Paliers 2–8 = code, pas encore.

### Palier 0 — Accès clé (prochain agent, clé injectée)

GET §4 avec `data_freshness=realtime`. Critère : statut 200 (éventuellement `no_solution`), pas 401/403. Si 400 sur `realtime` : retenter `adapted_schedule`.

### Palier 1 — Spec et ADR — **fait**

- `.scratch/itineraire/spec.md` (`Status: ready-for-agent`).
- `docs/adr/0004-itineraire.md` : realtime, un outil, timeout 50 s configurable, pas d'union 2–5.
- Entrées glossaire.

Critère : ADR + spec lus sans ouvrir le code.

### Palier 2 — Fixtures

Committer 3 JSON sanitisés (pas de clé) sous `src/infra/fixtures/` (ou à côté du test adapter) :

1. `/places?q=Nation` avec `stop_area` + éventuellement `address`.
2. `/journeys` 200 avec marche + métro + attente + métro.
3. 404 `no_solution` et 404 `date_out_of_bounds` (ou 200 + `error`, selon ce que PRIM renvoie vraiment).

Critère : un humain ouvre les fichiers et y voit `journeys` / `error.id`, pas `apiKey`.

### Palier 3 — Tests application rouges

`src/application.itineraire.test.ts` : cas 1, 5, 6, 9, 10 d'abord (tracer bullets). `createApplication` n'a pas encore `itineraire` → rouge.

Critère : `vitest run src/application.itineraire.test.ts` échoue sur « `itineraire` is not a function » ou équivalent.

### Palier 4 — Use-case vert

Types dans `src/domain/index.ts`. Port + `itineraire()` dans `createApplication`. Fake only. Pas d'HTTP, pas d'adapter PRIM.

Critère : les cas du palier 3 verts. `identity` / `passages` / `traffic` toujours verts.

### Palier 5 — Reste des cas application

Cas 2–4, 7–8, 11–14. Critère : fichier de test vert en entier.

### Palier 6 — Timeout global puis adapter

D'abord (préfacteur, tests existants verts) : `primFetchInit` / `primRequest` prennent `timeoutMs` ; `boot` lit `PRIM_FETCH_TIMEOUT_MS` (défaut 50000) ; tests `prim-fetch.test.ts` et `application.test.ts` passent à 50 s / env override. Puis `src/infra/prim-itineraire.ts` + tests sur fixtures. `prim-navitia-lookup.ts` filtre `stop_area` inchangé.

Critère : tests timeout verts ; tests adapter verts ; grep `type[]=stop_area` dans le lookup = inchangé.

### Palier 7 — Câblage MCP

`src/index.ts` passe l'adapter. `registerTool`, phrase d'instructions, `toolSummary` additif. Smoke étendu.

Critère : smoke vert ; `tools/list` contient les cinq noms.

### Palier 8 — Live opt-in

Test skip si pas de clé. Une fois sur la machine de Julien après palier 0.

Critère : skip en CI ; vert en local avec la clé.

Ordre TDD : timeout (6a) peut partir tout de suite (pas de clé). 3 → 4 → 5 → adapter (6b) → 7. Ne pas commencer par éditer `searchStops`.

---

## 8. Questions encore ouvertes

Tranché par Julien : fraîcheur (`realtime`), quota (déjà augmenté), timeout (50 s global configurable), nom (`itineraire` / **Itinéraire**), spec (slug `itineraire`).

1. **Accès live.** Au prochain agent avec `PRIM_API_KEY` injectée : le GET §4 rend-il 200, 403, ou 400 sur `realtime` ?
2. **Ambiguïté 2–5.** Toujours : clarifier, pas d'union. *Dire le contraire si tu veux le premier résultat Navitia.*
3. **Types de lieux.** Toujours : stop + adresse + `lon;lat`. *POI/commune = plus tard.*
4. **Info Trafic sur les Étapes.** Toujours : l'agent rappelle `get_info_trafic`. *Dire le contraire pour annoter depuis le snapshot.*

Pas de code de production dans ce diff (spec, ADR, glossaire, plan).
