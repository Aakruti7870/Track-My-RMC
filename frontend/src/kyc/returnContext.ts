import { storage } from "@/src/utils/storage";

const CONTEXT_KEY = "kyc_resume";
const PENDING_KEY = "kyc_pending";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type KycDestination = { kind: "home" | "profile" | "order"; draftId?: string };
type ReturnContext = KycDestination & { userId: string; createdAt: number };

// Only an enum and an opaque customer-owned draft ID are retained, never tokens
// or identity data. The server independently authorizes the draft on retrieval.
export async function saveKycDestination(userId: string, destination: KycDestination): Promise<boolean> {
  if (destination.kind === "order" && (!destination.draftId || !UUID.test(destination.draftId))) return false;
  return storage.setItem(CONTEXT_KEY, JSON.stringify({ ...destination, userId, createdAt: Date.now() }));
}

async function readContext(): Promise<ReturnContext | null> {
  const raw = await storage.getItem(CONTEXT_KEY, "");
  if (!raw) return null;
  try {
    const value: ReturnContext = JSON.parse(raw);
    const age = Date.now() - value.createdAt;
    if (typeof value.userId !== "string" || !Number.isFinite(age) || age < 0 || age > MAX_AGE_MS
      || !["home", "profile", "order"].includes(value.kind)
      || (value.kind === "order" && (!value.draftId || !UUID.test(value.draftId)))) return null;
    return value;
  } catch { return null; }
}

export async function markKycReturnPending(): Promise<void> {
  await storage.setItem(PENDING_KEY, Date.now());
}

export async function shouldResumeKycAfterLogin(userId: string): Promise<boolean> {
  const timestamp = await storage.getItem(PENDING_KEY, 0);
  await storage.removeItem(PENDING_KEY);
  const age = Date.now() - (timestamp || 0);
  if (age < 0 || age > MAX_AGE_MS) return false;
  const context = await readContext();
  if (context && context.userId !== userId) {
    await storage.removeItem(CONTEXT_KEY);
    return false;
  }
  return true;
}

export async function takeKycDestination(userId: string): Promise<KycDestination> {
  const context = await readContext();
  await storage.removeItem(CONTEXT_KEY);
  await storage.removeItem(PENDING_KEY);
  if (!context || context.userId !== userId) return { kind: "home" };
  if (context.kind === "order") return { kind: "order", draftId: context.draftId };
  return { kind: context.kind };
}
