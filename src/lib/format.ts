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
