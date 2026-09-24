// Ported verbatim from the web app's src/lib/utils.ts — keep in sync by hand.
const CURRENCY_LOCALE_MAP: Record<string, string> = {
  MYR: "ms-MY",
  SGD: "en-SG",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  AUD: "en-AU",
  IDR: "id-ID",
  THB: "th-TH",
};

export function currencyToLocale(code: string): string {
  return CURRENCY_LOCALE_MAP[code] ?? "en-US";
}

export function formatCurrency(amount: number | string, currencyCode = "MYR", locale = "ms-MY"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).format(Number(amount));
  } catch {
    return `${currencyCode} ${Number(amount).toFixed(2)}`;
  }
}

export function tableName(tbl: { name?: string | null; number: number }): string {
  return tbl.name?.trim() || `Table ${tbl.number}`;
}

/** "24 Sep, 2:14 PM" in the restaurant's own timezone, regardless of what
 * timezone the phone itself is set to. */
export function formatDateTime(value: string | number, timezone: string, locale: string): string {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/** "24 Sep" — same rules as formatDateTime but without the time, for the
 * date-filter bar's label. */
export function formatDateOnly(value: Date, timezone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: timezone, day: "numeric", month: "short" }).format(value);
  } catch {
    return value.toDateString();
  }
}

/** YYYY-MM-DD for `value` as a calendar date in `timezone` — matches what the
 * server's `date` query param expects (day boundaries in the restaurant's
 * own timezone, not the phone's or UTC's). */
export function toRestaurantDateKey(value: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

/** Keeps a price text field free-typeable: digits and at most one decimal
 * point. Deriving the displayed text straight from `Number(text)` would
 * collapse a trailing "12." back to "12" on every keystroke, making it
 * impossible to type a decimal like "12.50". */
export function sanitizePriceText(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}
