import type { SupportAction } from "./routes";

export type SupportCategory =
  | "LOGIN"
  | "KYC"
  | "ORDER"
  | "TRACKING"
  | "PAYMENT"
  | "ACCOUNT_DELETION"
  | "PLANT_ONBOARDING"
  | "GENERAL";

export type ScriptedSupportChoice = {
  id: string;
  label: string;
  answer: string;
  action?: SupportAction;
  requiresOrder?: boolean;
  detailsSuggested?: boolean;
};

export type ScriptedSupportTopic = {
  prompt: string;
  choices: ScriptedSupportChoice[];
};

// Bundled offline support content. Navigation action IDs are mapped only by
// the local allowlisted SupportAction router; never accept arbitrary URLs here.
import catalog from "./scriptedSupport.json";
export const SCRIPTED_SUPPORT: Record<SupportCategory, ScriptedSupportTopic> =
  catalog as unknown as Record<SupportCategory, ScriptedSupportTopic>;
