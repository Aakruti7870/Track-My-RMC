import { CustomerTabDirectory } from "@/src/components/customer/CustomerTabDirectory";
import { enquiryRoute, materialPreview, moreMaterials, pumpLink, type HomeLink } from "@/src/navigation/customerHome";

const materials = [...materialPreview, ...moreMaterials];
const siteServices = new Set(["labour", "office-cabin"]);
const sourcing: readonly HomeLink[] = [
  { key: "plant-map", label: "Plant Map & Filters", symbol: "nearby-rmc-plants", route: "/customer/plants" },
  { key: "bulk-quote", label: "Bulk Concrete Enquiry", symbol: "quotation-requests", route: enquiryRoute("bulk") },
  pumpLink,
];
const sections = [
  { title: "Ready-mix concrete", links: sourcing },
  { title: "Material enquiries", links: materials.filter(link => !siteServices.has(link.key)) },
  { title: "Site services", links: materials.filter(link => siteServices.has(link.key)) },
];

export default function CustomerSupply() {
  return <CustomerTabDirectory testID="customer-supply" title="Materials & Services" sections={sections} />;
}
