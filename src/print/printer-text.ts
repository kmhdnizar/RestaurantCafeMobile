// Shared by escpos.ts (kitchen tickets) and receipt.ts (customer receipts) —
// thermal printers use a legacy single-byte character set, so anything
// outside plain ASCII prints as garbage unless mapped to something close.
export function toPrinterText(text: string): string {
  return (
    text
      .replace(/[–—−]/g, '-')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/…/g, '...')
      // Intl.NumberFormat's currency style commonly inserts a NON-BREAKING
      // SPACE (and sometimes a NARROW NO-BREAK SPACE) between the currency
      // symbol and the amount — e.g. "RM 8.00" — which isn't in the
      // printable ASCII range and was printing as "RM?8.00" before this.
      .replace(/[  ]/g, ' ')
      .replace(/[^\x20-\x7e]/g, '?')
  );
}
