import { BusinessModule } from "@/src/screens/BusinessModule";

// Reuse the plant-scoped stock ledger and its existing owner-controlled edit rights.
export default function StoreManagerStock() {
  return <BusinessModule kind="inventory" />;
}
