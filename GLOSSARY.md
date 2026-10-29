# Île-de-France Mobilités MCP

Vocabulary for traffic messages and next departures on the Île-de-France network, as exposed to MCP callers.

## Language

**Ligne**:
A commercial transport line on the Île-de-France network, identified by its référentiel code `Cxxxxx`.
_Avoid_: Navitia URI, SIRI LineRef, route, direction

**Zone d'arrêt**:
A monomodal stop zone: the boarding points of one mode at a place.
_Avoid_: stop, quai, stop_point, stop_area

**Zone de correspondance**:
A multimodal place that groups the Zones d'arrêt where a walking transfer is implicit. Grain of Prochain Passage. The mode shown with it is the référentiel type of that place, so homonyms can be told apart.
_Avoid_: stop, pôle, hub, quai

**Prochain Passage**:
A realtime estimated arrival or departure at a Zone de correspondance.
_Avoid_: horaire théorique, schedule, timetable

**Info Trafic**:
A current or upcoming message about traffic on the network (incident, planned or unplanned works, information), attached to one or more Lignes and possibly stops.
_Avoid_: incident, report, disruption as a synonym for the whole feed

**Sévérité**:
How hard an Info Trafic message hits the Ligne: blocking, disturbed, or information-only.
_Avoid_: priority, level, status

**Statut de passage**:
Whether a Prochain Passage is on time, early, delayed, cancelled, or already arrived/departed.
_Avoid_: state, freshness
