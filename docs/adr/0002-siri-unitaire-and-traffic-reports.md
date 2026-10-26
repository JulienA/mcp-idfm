# Prochain Passage via SIRI unitaire; Info Trafic via Navitia traffic_reports

PRIM’s Navitia general v2 is theoretical schedules; line_reports v2 is capped at 100 items and is the wrong shape for “fetch all, filter later”. v1 therefore uses [SIRI Lite requête unitaire](https://prim.iledefrance-mobilites.fr/fr/apis/idfm-ivtr-requete_unitaire) for **Prochain Passage** (live, no theoretical fallback) and `GET /marketplace/v2/navitia/traffic_reports?count=1000&disable_geojson=true&depth=1` for the **Info Trafic** snapshot, refreshed in-process every two minutes. Navitia general v2 remains the lookup path (`/pt_objects`, `/places`), not the passage clock.

## Considered Options

- Navitia `/stop_schedules` or `/departures` for next passages: theoretical (and unverified realtime on PRIM), rejected.
- PRIM line_reports v2 product as the cache source: 100-item cap, rejected.
- Messages Info Trafic — requête globale: one-shot network dump, rejected in favour of slim `traffic_reports` on general v2.
