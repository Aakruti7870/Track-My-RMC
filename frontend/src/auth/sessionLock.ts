// Native credentials are scoped to one app process; AuthProvider deduplicates flights.
export function supportsSessionLock(): boolean {
  return true;
}

export function withSessionLock<T>(task: () => Promise<T>): Promise<T> {
  return task();
}
