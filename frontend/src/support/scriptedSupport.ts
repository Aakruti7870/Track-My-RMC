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

export const SCRIPTED_SUPPORT: Record<SupportCategory, ScriptedSupportTopic> = {
  LOGIN: {
    prompt: "What login problem are you facing?",
    choices: [
      {
        id: "otp-not-received",
        label: "OTP not received",
        answer: "Confirm the registered mobile number or approved staff email, then request a fresh OTP. Use only the newest 6-digit OTP. Never share the OTP with anyone.",
      },
      {
        id: "otp-invalid",
        label: "OTP invalid or expired",
        answer: "Request a new OTP and enter only the latest 6-digit code. Older OTPs can expire when a new one is generated.",
      },
      {
        id: "account-not-found",
        label: "Account not found",
        answer: "Customer accounts should use the registered mobile number. Plant staff must use an approved work email linked to their plant account.",
      },
      {
        id: "staff-login",
        label: "Plant staff login issue",
        answer: "Plant staff must sign in with an approved work email. If the email has not been approved yet, submit the verified plant onboarding request.",
        action: "OPEN_PLANT_ONBOARDING",
      },
    ],
  },
  KYC: {
    prompt: "Choose your KYC issue.",
    choices: [
      {
        id: "start-kyc",
        label: "Start or continue KYC",
        answer: "Open the secure KYC screen and continue the DigiLocker/Aadhaar verification flow. Only verified KYC can enable protected customer actions such as placing an order.",
        action: "OPEN_KYC",
      },
      {
        id: "kyc-pending",
        label: "KYC pending",
        answer: "A pending KYC may still be waiting for provider completion or authority review. Open KYC to check the latest status before starting another verification.",
        action: "OPEN_KYC",
      },
      {
        id: "kyc-failed",
        label: "KYC failed",
        answer: "Open KYC and retry using your own valid identity details. Make sure the DigiLocker flow completes and returns to TrackMyRMC before closing it.",
        action: "OPEN_KYC",
      },
      {
        id: "kyc-profile-name",
        label: "Name or profile not updated",
        answer: "If KYC shows VERIFIED but your verified name is still missing from your profile, create a support case so the account record can be checked safely.",
        detailsSuggested: true,
      },
    ],
  },
  ORDER: {
    prompt: "Select one of your orders first, then choose the problem.",
    choices: [
      {
        id: "order-pending",
        label: "Order still pending",
        answer: "Review the selected order in My Orders for its latest authorized plant status. If it has not progressed as expected, you can create a support case for that order.",
        action: "OPEN_ORDERS",
        requiresOrder: true,
      },
      {
        id: "plant-not-responding",
        label: "Plant not responding",
        answer: "Open the selected order and review its current acceptance/dispatch status. If the plant response is overdue, create a support case linked to this order.",
        action: "OPEN_ORDERS",
        requiresOrder: true,
      },
      {
        id: "cancel-order",
        label: "Cancel or change order",
        answer: "Order cancellation or modification depends on the current order state. Open My Orders and use only the actions available for the selected order; otherwise escalate the case.",
        action: "OPEN_ORDERS",
        requiresOrder: true,
      },
      {
        id: "other-order",
        label: "Another order issue",
        answer: "The support case can be linked to the selected order. Add any extra details that will help support understand what is wrong.",
        requiresOrder: true,
        detailsSuggested: true,
      },
    ],
  },
  TRACKING: {
    prompt: "Select the dispatched order you want to track.",
    choices: [
      {
        id: "open-live-tracking",
        label: "Open live tracking",
        answer: "Live tracking is available only for your authorized dispatched order. Open the secure tracking screen for the selected order.",
        action: "OPEN_TRACKING",
        requiresOrder: true,
      },
      {
        id: "tracking-not-updating",
        label: "Location not updating",
        answer: "Confirm the selected order is dispatched and still active. Tracking can stop after delivery or when the driver trip is no longer active. If an active trip is not updating, create a support case linked to the order.",
        action: "OPEN_TRACKING",
        requiresOrder: true,
      },
      {
        id: "eta-problem",
        label: "ETA looks wrong",
        answer: "ETA depends on the active driver location and route conditions. Open live tracking for the latest available position; escalate if the active trip data appears stale.",
        action: "OPEN_TRACKING",
        requiresOrder: true,
      },
    ],
  },
  PAYMENT: {
    prompt: "What payment problem are you facing?",
    choices: [
      {
        id: "payment-failed",
        label: "Payment failed",
        answer: "Open My Orders and check the authoritative payment status before retrying. Do not share card, UPI, OTP, PIN, CVV or payment credentials in support chat.",
        action: "OPEN_PAYMENTS",
      },
      {
        id: "money-deducted",
        label: "Money deducted but not updated",
        answer: "Do not pay again until the order payment status is checked. Open My Orders first; if the payment remains pending after gateway verification, create a support case.",
        action: "OPEN_PAYMENTS",
        detailsSuggested: true,
      },
      {
        id: "payment-pending",
        label: "Payment pending",
        answer: "Open My Orders to refresh the payment status. Online payment status must come from the payment gateway verification and should not be manually marked paid.",
        action: "OPEN_PAYMENTS",
      },
      {
        id: "receipt-issue",
        label: "Receipt or payment reference issue",
        answer: "Open the order payment details first. If the verified payment is complete but the receipt/reference is missing, create a support case without sharing payment credentials.",
        action: "OPEN_PAYMENTS",
        detailsSuggested: true,
      },
    ],
  },
  ACCOUNT_DELETION: {
    prompt: "Choose your account issue.",
    choices: [
      {
        id: "profile-issue",
        label: "Profile information issue",
        answer: "For profile information that cannot be corrected through the normal account flow, create a support case and describe only the field that is wrong. Do not share credentials.",
        detailsSuggested: true,
      },
      {
        id: "delete-account",
        label: "Delete my account",
        answer: "Use the authenticated account-deletion flow. Ownership verification is required before deletion can proceed.",
        action: "OPEN_ACCOUNT_DELETION",
      },
      {
        id: "mobile-email-issue",
        label: "Mobile or email issue",
        answer: "Use the registered login identity for your account. If the stored mobile number or approved staff email is incorrect, create a support case so ownership can be verified safely.",
        detailsSuggested: true,
      },
    ],
  },
  PLANT_ONBOARDING: {
    prompt: "What do you need help with?",
    choices: [
      {
        id: "start-onboarding",
        label: "Start plant onboarding",
        answer: "Open the verified onboarding form and submit the plant owner, work email, mobile, plant name and location details for review.",
        action: "OPEN_PLANT_ONBOARDING",
      },
      {
        id: "email-not-approved",
        label: "Staff email not approved",
        answer: "If your plant email is not approved, submit the verified onboarding request. Staff login should only be enabled after the account is provisioned for the plant.",
        action: "OPEN_PLANT_ONBOARDING",
      },
      {
        id: "onboarding-pending",
        label: "Onboarding still pending",
        answer: "If an onboarding request was already submitted, avoid duplicate submissions unless the original details were incorrect. Create a support case if the review is overdue.",
        detailsSuggested: true,
      },
    ],
  },
  GENERAL: {
    prompt: "Choose the closest issue, or describe another problem.",
    choices: [
      {
        id: "app-not-loading",
        label: "App screen not loading",
        answer: "Check your connection, reopen the screen and try once more. If the same screen still fails, add the screen name and what you tapped before the problem started.",
        detailsSuggested: true,
      },
      {
        id: "data-not-updated",
        label: "Data not updated",
        answer: "Refresh the affected screen first. If the server-backed status still looks old, create a support case and mention which order, KYC, payment or profile screen is affected.",
        detailsSuggested: true,
      },
      {
        id: "notifications",
        label: "Notification issue",
        answer: "Confirm notification permission is enabled for TrackMyRMC. If important order updates still do not arrive, create a support case with the affected order number if available.",
        detailsSuggested: true,
      },
      {
        id: "other",
        label: "Describe another issue",
        answer: "Tell us what happened in your own words. Do not include passwords, OTPs, passkeys, recovery codes, PINs, CVVs or payment credentials.",
        detailsSuggested: true,
      },
    ],
  },
};
