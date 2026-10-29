export function canonicalLineId(value: string): string {
  const match = /C\d+/i.exec(value);
  return match?.[0]?.toUpperCase() ?? value;
}

export function canonicalStopId(navitiaId: string): string {
  return navitiaId.replace(/^stop_area:IDFM:/i, "");
}

export function normalizeStopQuery(query: string): string {
  const trimmed = query.trim();
  const navitia = /^stop_area:IDFM:(.+)$/i.exec(trimmed);
  if (navitia?.[1]) {
    return navitia[1];
  }
  const siri = /^STIF:StopArea:SP:([^:]+):?$/i.exec(trimmed);
  if (siri?.[1]) {
    return siri[1];
  }
  return trimmed;
}
