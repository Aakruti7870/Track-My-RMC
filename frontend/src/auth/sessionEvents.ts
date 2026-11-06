// In-memory notifications only. Tokens are never sent to logs or analytics.
type Loss = { token: string; error: unknown };
const listeners = new Set<(loss: Loss) => void>();
export function onSessionLoss(listener: (loss: Loss) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function publishSessionLoss(loss: Loss): void {
  for (const listener of listeners) listener(loss);
}
