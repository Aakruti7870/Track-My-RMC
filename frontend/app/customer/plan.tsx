import { CustomerTabDirectory } from "@/src/components/customer/CustomerTabDirectory";
import { planningLinks } from "@/src/navigation/customerHome";

const sections = [
  { title: "Projects & sites", links: planningLinks(["projects", "saved-sites"]) },
  { title: "Pour planning", links: planningLinks(["pour-planner", "free-tools", "compare-plants"]) },
  { title: "Receiving & quality", links: planningLinks(["receiving-guide", "cube-tests"]) },
];

export default function CustomerPlan() {
  return <CustomerTabDirectory testID="customer-plan" title="Plan a Pour" sections={sections} />;
}
