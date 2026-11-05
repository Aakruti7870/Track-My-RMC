import type { SupportAction } from "./routes";
import catalog from "./scriptedSupport.json";

export type SupportCategory =
  | "LOGIN" | "KYC" | "ORDER" | "TRACKING" | "PAYMENT"
  | "ACCOUNT_DELETION" | "PLANT_ONBOARDING" | "GENERAL";
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

// Bundled locally: support help works offline and never authorizes API actions.
// Order ownership, KYC, payment and tracking permissions stay server-side.
export const SCRIPTED_SUPPORT: Record<SupportCategory, ScriptedSupportTopic> =
  catalog as Record<SupportCategory, ScriptedSupportTopic>;
