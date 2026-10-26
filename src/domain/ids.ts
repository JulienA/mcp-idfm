export function canonicalLineId(value: string): string {
  const match = /C\d+/i.exec(value);
  return match?.[0]?.toUpperCase() ?? value;
}

export function canonicalStopId(navitiaId: string): string {
  return navitiaId.replace(/^stop_area:IDFM:/i, "");
}
