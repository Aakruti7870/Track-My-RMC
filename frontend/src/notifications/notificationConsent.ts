import { storage } from "@/src/utils/storage";

const PREFIX = "tmrmc_post_login_permission_cards_v2:";
type Consent = {
  version?: number;
  completed?: boolean;
  choices?: Record<string, string>;
};

async function readConsent(identity: string): Promise<Consent> {
  const raw = await storage.getItem(`${PREFIX}${identity}`, "");
  try {
    const value = typeof raw === "string" && raw ? JSON.parse(raw) : null;
    return value?.version === 2 ? value as Consent : {};
  } catch {
    return {};
  }
}

export async function hasNotificationConsent(identity: string): Promise<boolean> {
  return (await readConsent(identity)).choices?.notifications === "granted";
}

// Used by both later opt-in screens and the welcome flow. Updating one choice
// preserves the other cards and never marks an unfinished welcome complete.
export async function saveNotificationConsent(identity: string, choice: string): Promise<void> {
  const previous = await readConsent(identity);
  const saved = await storage.setItem(`${PREFIX}${identity}`, JSON.stringify({
    ...previous,
    version: 2,
    completed: previous.completed === true,
    choices: { ...previous.choices, notifications: choice },
  }));
  if (!saved) throw new Error("Notification preference could not be saved");
}
