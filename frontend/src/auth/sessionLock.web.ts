// Web Locks serialize mutations of the shared HttpOnly refresh cookie across tabs.
// Production HTTPS and supported loopback development origins provide this API.
export function supportsSessionLock(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.locks);
}

export async function withSessionLock<T>(task: () => Promise<T>): Promise<T> {
  // Logout must still clear credentials when Web Locks are unavailable.
  // AuthProvider requires support before attempting any refresh rotation.
  if (!supportsSessionLock()) return task();
  return await navigator.locks.request("tmrmc-auth-session", { mode: "exclusive" }, task);
}
