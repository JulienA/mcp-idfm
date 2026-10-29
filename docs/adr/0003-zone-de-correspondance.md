# Prochain Passage uses the Zone de correspondance

SIRI requête unitaire accepts a quai, a monomodal Zone d'arrêt, or a Zone de correspondance on the same `MonitoringRef`. Querying each Zone d'arrêt split a place such as Châtelet into one call per mode and often asked for clarification. Prochain Passage now resolves the Zone de correspondance (`STIF:StopArea:SP:{ZdCId}:`) from the public référentiel, and rolls a Zone d'arrêt id up to its parent zone. `get_stop_id` stays on the Zone d'arrêt. Quai-level refs stay out.

This narrows ADR 0002 for Prochain Passage only: that decision kept Navitia `/places` as the Zone d'arrêt lookup, which `get_stop_id` still uses. Passage resolution uses the zones-de-correspondance référentiel instead of a Navitia stop.
