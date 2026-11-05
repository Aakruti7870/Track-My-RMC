/** Display-only mirror. PostgreSQL enforces one slot per plant/job role. */
export const PLANT_JOB_ROLES = [
  "dispatcher", "operator", "supervisor", "accountant",
  "quality_engineer", "fleet_manager", "store_manager",
] as const;

export type PlantJobRole = typeof PLANT_JOB_ROLES[number];
export type PlantRoleAssignment = {
  user_id: string;
  role: string;
  is_active: boolean;
  removed_at?: string | null;
};

export function roleSlotStatus(
  assignments: readonly PlantRoleAssignment[], role: PlantJobRole,
): "available" | "active" | "suspended" {
  const occupant = assignments.find((person) => person.role === role && !person.removed_at);
  return !occupant ? "available" : occupant.is_active ? "active" : "suspended";
}
