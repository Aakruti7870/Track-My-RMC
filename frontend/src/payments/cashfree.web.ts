type CashfreeCallbacks = {
  onVerify(orderId: string): void;
  onError(error: unknown, orderId: string): void;
};

export const cashfreeCheckout = {
  available: false,
  setCallbacks(_callbacks: CashfreeCallbacks) {},
  removeCallbacks() {},
  start(_paymentSessionId: string, _orderId: string, _production: boolean) {},
};
