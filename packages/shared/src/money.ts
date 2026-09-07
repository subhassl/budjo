/**
 * All money in Budjo is a signed integer number of cents. There are no floats
 * anywhere in the system; these helpers are the only place dollars exist.
 */

export function formatCents(cents: number, opts: { sign?: boolean } = {}): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const body = (abs / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (negative) return `-${body}`;
  return opts.sign ? `+${body}` : body;
}

/** Compact form for dense lists: $1,234.56 -> $1,234.56, but $12.00 -> $12 */
export function formatCentsShort(cents: number): string {
  return cents % 100 === 0
    ? formatCents(cents).replace('.00', '')
    : formatCents(cents);
}

/**
 * Parse user input ("12", "12.5", "$1,234.56") into cents.
 * Returns null for anything that isn't a clean, non-negative amount.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (cleaned === '' || !/^\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = '0', frac = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) ? cents : null;
}
