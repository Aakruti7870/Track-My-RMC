import React from "react";
import { OwnerFrame, OwnerList, OwnerModuleRow } from "@/src/owner/OwnerUI";
import { OPERATIONS_KEYS, ownerModules } from "@/src/owner/modules";
export default function OwnerOperations() {
  return <OwnerFrame title="Operations" subtitle="Manage day-to-day plant operations"><OwnerList>{ownerModules(OPERATIONS_KEYS).map(module => <OwnerModuleRow key={module.key} module={module} />)}</OwnerList></OwnerFrame>;
}
