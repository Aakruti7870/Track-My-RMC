export type SupportAction =
  | "OPEN_SECURE_LOGIN_HELP" | "OPEN_KYC" | "OPEN_ORDERS" | "OPEN_TRACKING"
  | "OPEN_PAYMENTS" | "OPEN_ACCOUNT_DELETION" | "OPEN_PLANT_ONBOARDING" | "OPEN_HELP";

export function supportActionRoute(action: SupportAction, orderId?: string | null): string | null {
  switch (action) {
    // An authenticated customer would be immediately redirected away from the
    // login screen, so login help remains in the Support Agent conversation.
    case "OPEN_SECURE_LOGIN_HELP": return null;
    case "OPEN_KYC": return "/kyc";
    case "OPEN_ORDERS": return "/customer/orders";
    case "OPEN_TRACKING": return orderId ? `/track/${encodeURIComponent(orderId)}` : "/customer/orders";
    case "OPEN_PAYMENTS": return "/customer/orders";
    case "OPEN_ACCOUNT_DELETION": return "/account-deletion";
    case "OPEN_PLANT_ONBOARDING": return "/plant-onboarding";
    case "OPEN_HELP": return null;
  }
}
