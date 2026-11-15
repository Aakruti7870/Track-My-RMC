/** Preserve ten-digit Indian entry and accept an explicit E.164 country code. */
export function loginPhone(value: string): string | null {
  if (/^\d{10}$/.test(value)) return `+91${value}`;
  return /^\+[1-9]\d{9,14}$/.test(value) ? value : null;
}

/** Display the account number without changing the number used to sign in. */
export function formatAccountMobile(value: string | null | undefined): string {
  const mobile = value?.trim();
  if (!mobile) return "";
  const normalized = loginPhone(mobile) || loginPhone(`+${mobile}`);
  const india = normalized?.match(/^\+91(\d{5})(\d{5})$/);
  if (india) return `+91 ${india[1]} ${india[2]}`;
  return normalized || mobile;
}
