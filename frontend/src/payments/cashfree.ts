import { CFEnvironment, CFSession } from "cashfree-pg-api-contract";
import { CFPaymentGatewayService } from "react-native-cashfree-pg-sdk";

export type CashfreeCallbacks = {
  onVerify(orderId: string): void;
  onError(error: unknown, orderId: string): void;
};

export const cashfreeCheckout = {
  available: true,
  setCallbacks(callbacks: CashfreeCallbacks) {
    CFPaymentGatewayService.setCallback(callbacks);
  },
  removeCallbacks() {
    CFPaymentGatewayService.removeCallback();
  },
  start(paymentSessionId: string, orderId: string, production: boolean) {
    const environment = production ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;
    CFPaymentGatewayService.doWebPayment(new CFSession(paymentSessionId, orderId, environment));
  },
};
