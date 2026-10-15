/** Preserve ten-digit Indian entry and accept an explicit E.164 country code. */
export function loginPhone(value: string): string | null {
  if (/^\d{10}$/.test(value)) return `+91${value}`;
  return /^\+[1-9]\d{9,14}$/.test(value) ? value : null;
}
