import { StaffCollection } from "@/src/screens/StaffCollection";

// Supervisors inspect active dispatch operations; permission checks stay in Rust.
export default function SupervisorOperations() {
  return <StaffCollection kind="dispatch" />;
}
