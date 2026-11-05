/** UI messages only; the Rust API owns session replacement. */
export type SessionLoss = "replaced" | "revoked" | "expired" | null;

export function sessionLossReason(error: unknown): SessionLoss {
  if (!error || typeof error !== "object") return null;
  const value = error as Record<string, unknown>;
  if (value.status !== 401) return null;
  if (value.error_code === "SESSION_REPLACED") return "replaced";
  if (value.error_code === "SESSION_REVOKED") return "revoked";
  if (value.error_code === "TOKEN_ERROR" || value.error_code === "SESSION_EXPIRED") return "expired";
  return null;
}

export function sessionLossMessage(reason: Exclude<SessionLoss, null>): string {
  switch (reason) {
    case "replaced": return "This account was signed in on another device. Sign in again.";
    case "revoked": return "Your session was ended for security. Sign in again.";
    case "expired": return "Your secure session expired. Sign in again.";
  }
}
