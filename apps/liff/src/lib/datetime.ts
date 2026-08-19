// All helpers operate in JST. The Worker accepts UTC ISO8601 — we convert
// at the boundary (jstStartsAtIso) before posting.

const JST_OFFSET_MS = 9 * 3600_000;

export function jstToday(): string {
  const now = new Date();
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatJp(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${'日月火水木金土'[d.getUTCDay()]})`;
}

export function jstStartsAtIso(date: string, hhmm: string): string {
  // `+09:00` suffix tells JS to treat the wall-clock time as JST.
  return new Date(`${date}T${hhmm}:00+09:00`).toISOString();
}

export function utcToJstDisplay(utcIso: string): string {
  const d = new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}
