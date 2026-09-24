export const ROLE_ROUTES = {
  customer: "/customer",
  plant_owner: "/owner",
  driver: "/driver",
  admin: "/admin",
  dispatcher: "/dispatcher",
  operator: "/operator",
  supervisor: "/supervisor",
  accountant: "/accountant",
  quality_engineer: "/quality_engineer",
  fleet_manager: "/fleet_manager",
  store_manager: "/store_manager",
} as const;

export function roleRouteFor(role?: string | null): string {
  if (!role) return "/role-home";
  return ROLE_ROUTES[role as keyof typeof ROLE_ROUTES] ?? "/role-home";
}
