/** ISO-8601 UTC, second precision. Sorts lexicographically, reads fine in SQL. */
export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function isoPlusHours(hours: number, from = new Date()): string {
  return new Date(from.getTime() + hours * 3_600_000).toISOString();
}

export function isoPlusDays(days: number, from = new Date()): string {
  return isoPlusHours(days * 24, from);
}
