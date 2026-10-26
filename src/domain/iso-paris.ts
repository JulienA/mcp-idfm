function parisOffset(raw: string): string {
  const withoutGmt = raw.replace(/^GMT/i, "");
  if (!withoutGmt || withoutGmt === "Z") {
    return "Z";
  }
  const match = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(withoutGmt);
  if (!match) {
    return "+00:00";
  }
  return `${match[1]}${match[2]!.padStart(2, "0")}:${(match[3] ?? "00").padStart(2, "0")}`;
}

export function formatIsoParis(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${parisOffset(parts.timeZoneName ?? "")}`;
}
