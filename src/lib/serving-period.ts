// Ported from the web app's OrdersClient.tsx (isItemVisible/activeServingPeriodIds)
// — there is no server endpoint for "which items are orderable right now",
// so this must stay in sync by hand with that file.

export interface ServingPeriod {
  id: string;
  name: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  days: string[]; // e.g. ["MON", "TUE"], empty = every day
}

export function getActiveServingPeriodIds(servingPeriods: ServingPeriod[], timezone: string, now = new Date()): string[] {
  const tz = timezone || "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  // hour12:false may return "24" at midnight — normalise to "00"
  const h = hour === "24" ? "00" : hour.padStart(2, "0");
  const timeStr = `${h}:${minute.padStart(2, "0")}`;
  const dayStr = weekday.toUpperCase().slice(0, 3);

  return servingPeriods
    .filter((p) => {
      const inDay = p.days.length === 0 || p.days.includes(dayStr);
      const inTime = timeStr >= p.startTime && timeStr < p.endTime;
      return inDay && inTime;
    })
    .map((p) => p.id);
}

export function isItemVisible(itemServingPeriodIds: string[], servingPeriods: ServingPeriod[], activeServingPeriodIds: string[], showAll: boolean): boolean {
  if (showAll) return true;
  if (servingPeriods.length === 0) return true; // no periods configured → show everything
  if ((itemServingPeriodIds ?? []).length === 0) return true; // item not tied to any period → always visible
  if (activeServingPeriodIds.length === 0) return true; // off-hours → fall back to showing everything
  return itemServingPeriodIds.some((id) => activeServingPeriodIds.includes(id));
}
