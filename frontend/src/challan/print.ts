/** Print-safe, plant-scoped two-up A4 challan renderer for Web and embedded preview.
 * No remote HTML, user-supplied CSS or user-supplied scripts are accepted.
 */
export type ChallanDesign = {
  is_custom: boolean;
  version: number;
  title: string;
  accent_color: string;
  header_note: string;
  footer_note: string;
  logo_data_uri: string | null;
  show_po: boolean;
  show_slump: boolean;
  show_batch: boolean;
};
export type PlantPrint = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  legal_name?: string | null;
  gstin?: string | null;
};
export type ChallanPrintData = {
  id?: string;
  challan_number?: string;
  order_number?: string;
  load_number?: number;
  customer_name?: string;
  site_name?: string | null;
  site_address?: string;
  grade?: string;
  quantity_m3?: string | number;
  slump_mm?: number;
  batch_time?: string | null;
  created_at?: string;
  mixer_number?: string | null;
  driver_name?: string | null;
  receiver_name?: string | null;
  status?: string;
};

export const APP_PLAY_LINK = "https://play.google.com/store/apps/details?id=com.trackmyrmc.concreteking";
export const DEFAULT_CHALLAN_DESIGN: ChallanDesign = {
  is_custom: false, version: 0, title: "DELIVERY CHALLAN",
  accent_color: "#17313A", header_note: "",
  footer_note: "Acknowledgement subject to on-site verification.",
  logo_data_uri: null, show_po: true, show_slump: true, show_batch: true,
};
const QR_ROWS = "1111111010011100011101000010001111111|1000001001111001010101001110001000001|1011101011010011110001010100101011101|1011101001010111110111101110001011101|1011101000111001111001000010001011101|1000001010010100100000101010101000001|1111111010101010101010101010101111111|0000000000101011001000011011100000000|1010001100010001111100001000000100101|0110110111110100111000011001111101011|1101111100101010100101011001011111101|0001000011011101101000010010000100000|0011001000000100000100011000101000001|1110110110011011110110010001101101001|1000111101001011100111010011011001101|1000100000110010110000101011101111010|0010101100100110010110000011001000010|1111000010000110000011011101101101111|1110011111100101010010010101000100101|0011100011000010000110110000100111000|1000101111110001100000011000101101010|1000110000001101100111111101101000001|0001101011101001011100110001111001101|1100010001110100001000111001110111011|0101001001001010111110001000101100000|0001110010111100101000011001101000001|1110101110100000110100111101011010001|0010100001110001101110011011010111010|1101111010000110100110001010111111010|0000000010101101111111011000100010011|1111111011001111000101110010101010011|1000001000100100010110110010100010011|1011101000100001010010011001111110011|1011101001001000000110011101010011100|1011101011010111010111010001000110001|1000001001111100000110111000100011000|1111111010010001100010101000100101001";

const e = (v: unknown) => String(v ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || "");
const fmt = (v: string | null | undefined) => v ? new Date(v).toLocaleString("en-IN", { day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit" }) : "";
const printField = (label: string, value: unknown, width = 1) =>
  '<div class="cell" style="flex:' + width + '"><div class="label">' + e(label) +
  '</div><div class="value">' + e(value ?? "") + '</div></div>';
const line = (...fields: string[]) => '<div class="line">' + fields.join("") + '</div>';

function qrMarkup(): string {
  const boxes: string[] = [];
  QR_ROWS.split("|").forEach((row,y) => {
    Array.from(row).forEach((v,x) => { if (v==="1") boxes.push('<rect x="'+x+'" y="'+y+'" width="1" height="1"/>'); });
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 45 45" aria-label="QR code for Track My RMC app download"><rect x="-4" y="-4" width="45" height="45" fill="white"/><g fill="#111827">'+boxes.join("")+'</g></svg>';
}

export function sampleChallan(): ChallanPrintData {
  return {
    challan_number: "SAMPLE-00125", order_number: "SAMPLE-ORD-428",
    load_number: 4, customer_name: "Example Customer", site_name: "Project Site",
    site_address: "Example delivery address", grade: "M30", quantity_m3: "6.00",
    slump_mm: 120, mixer_number: "TM-04", driver_name: "Example Driver",
    batch_time: "2026-10-26T10:22:00+05:30",
  };
}

function copy(label: string, plant: PlantPrint, design: ChallanDesign, data: ChallanPrintData, sample: boolean) {
  const logo = design.logo_data_uri && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(design.logo_data_uri)
    ? '<img class="logo" alt="Plant logo" src="'+design.logo_data_uri+'"/>' : '';
  const name = e(plant.name || "RMC Plant");
  const site = [data.site_name, data.site_address].filter(Boolean).join(", ");
  const grade = data.grade ?? "";
  const batch = design.show_batch
    ? line(printField("Batch completed",fmt(data.batch_time)),printField("Plant dispatch", ""),printField("Site arrival",""),printField("Unloading start",""))
    : "";
  const slump = design.show_slump ? printField("Target slump",data.slump_mm == null ? "" : data.slump_mm+" mm") : "";
  const po = design.show_po ? printField("PO reference","") : "";
  return '<section class="ticket">' +
    '<header class="head"><div class="brand">' + logo +
    '<div class="identity"><div class="plant-name">' + name + '</div><div class="address">' +
    e([plant.address,plant.city,plant.state].filter(Boolean).join(", ")) + (plant.phone ? " · " + e(plant.phone):"") +
    (plant.gstin ? " · GSTIN: " + e(plant.gstin) : "") +
    '</div><div class="header-note">'+e(design.header_note)+'</div></div></div>' +
    '<div class="header-right"><strong>'+e(design.title)+'</strong><span>'+e(label)+'</span></div></header>' +
    '<div class="details">' +
    line(printField("Challan no.",data.challan_number,1.2),printField("Order / Load", String(data.order_number??"") + " / " + String(data.load_number??""),1.35),printField("Date",fmt(data.created_at) || new Date().toLocaleDateString("en-IN"),.9)) +
    line(printField("Customer / Consignee",data.customer_name,1.5),po,printField("Delivery site",site,2)) +
    line(printField("Concrete grade",grade),printField("Quantity",data.quantity_m3==null?"":data.quantity_m3+" m³"),slump,printField("Concrete type","RMC")) +
    line(printField("TM / Vehicle",data.mixer_number),printField("Driver",data.driver_name),printField("Batch reference","")) +
    batch +
    line(printField("Unloading complete",""),printField("Received quantity",""),printField("Actual slump",""),printField("Return / shortage","")) +
    '<div class="remarks"><strong>REMARKS / DELIVERY INSTRUCTIONS</strong><span></span></div>' +
    '<div class="signatures"><div><strong>DRIVER / DISPATCH</strong><i></i><small>Signature, name and time</small></div><div><strong>SITE RECEIVER / POD</strong><i></i><small>Signature, name, time and received quantity</small></div></div>' +
    '</div><footer><div class="footer-left"><span>'+e(design.footer_note)+'</span><small>TRACK MY RMC · Not a tax invoice'+(sample?' · SAMPLE ONLY':'')+'</small></div><div class="qr">' + qrMarkup() +
    '<small>SCAN TO GET APP</small></div></footer></section>';
}

export function buildChallanHtml(plant: PlantPrint, design: ChallanDesign, data: ChallanPrintData, sample = false): string {
  const accent = /^#[a-fA-F0-9]{6}$/.test(design.accent_color) ? design.accent_color : "#17313A";
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
  '<title>RMC Delivery Challan · '+e(data.challan_number||"Preview")+'</title><style>' +
  '@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;background:#e6e9ec;font-family:Arial,"Noto Sans",sans-serif;color:#142a35}' +
  '.toolbar{position:sticky;top:0;text-align:center;padding:10px;background:#fff;border-bottom:1px solid #ccc;z-index:2}' +
  '.toolbar button{padding:9px 18px;border:0;border-radius:6px;background:'+accent+';color:white;cursor:pointer}' +
  '.page{width:210mm;height:297mm;margin:12px auto;padding:5mm;display:flex;flex-direction:column;background:#fff;box-shadow:0 2px 15px #a1a1a1}' +
  '.ticket{height:138.2mm;flex-shrink:0;border:1px solid #bac8d0;border-radius:2mm;overflow:hidden;display:flex;flex-direction:column;background:#fff}' +
  '.head{height:23mm;flex-shrink:0;display:flex;justify-content:space-between;gap:10px;color:white;background:'+accent+';border-top:1.2mm solid #eb8b2c;padding:3mm}' +
  '.brand{display:flex;align-items:center;gap:2mm;max-width:62%}.logo{width:20mm;height:17mm;object-fit:contain;background:white;border-radius:1mm;padding:1mm}' +
  '.plant-name{font-size:14pt;font-weight:800;line-height:1.08;overflow-wrap:anywhere}.address{font-size:7pt;margin-top:2mm}.header-note{font-size:7pt;margin-top:1mm}' +
  '.header-right{display:flex;flex-direction:column;align-items:end;justify-content:center;text-align:right;gap:3mm;max-width:37%}.header-right strong{font-size:11pt}' +
  '.header-right span{font-size:7pt;background:#f7e7d3;color:#61390c;padding:1mm 3mm;border-radius:4mm;font-weight:bold}' +
  '.details{flex:1;display:flex;flex-direction:column;min-height:0}.line{display:flex;min-height:11mm;flex-shrink:0;border-bottom:.2mm solid #cad5da}' +
  '.line:nth-child(even){background:#f5f8f8}.cell{min-width:0;padding:1.6mm 2mm;border-right:.2mm solid #d4dce0;overflow:hidden}.cell:last-child{border-right:0}' +
  '.label{font-weight:700;color:#60747c;font-size:6pt;text-transform:uppercase}.value{font-size:8pt;font-weight:700;margin-top:1.5mm;overflow-wrap:anywhere}' +
  '.remarks{display:flex;flex-direction:column;flex:1;min-height:8mm;background:#ecf2f2;padding:2mm 3mm;border-bottom:.2mm solid #cedcdf}.remarks strong{font-size:6pt;color:#667b82}' +
  '.signatures{display:flex;min-height:18mm;flex-shrink:0}.signatures>div{flex:1;padding:2mm 3mm;display:flex;flex-direction:column;justify-content:space-between}.signatures>div:first-child{border-right:.2mm solid #ccd6db}' +
  '.signatures strong{font-size:6.5pt;color:#53666e}.signatures i{border-bottom:.2mm solid #889da5;margin:0 2mm}.signatures small{font-size:6pt;color:#60747c}' +
  'footer{height:20mm;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:2mm;padding:1mm 3mm;background:#203f49;color:white}' +
  '.footer-left{display:flex;flex-direction:column;gap:2mm;font-size:6.5pt}.footer-left small{font-size:6pt;color:#efbe88;font-weight:bold}' +
  '.qr{display:flex;align-items:center;gap:2mm;height:19mm}.qr svg{height:18mm;width:18mm;background:white}.qr small{font-size:5.7pt;white-space:nowrap}' +
  '.cut{height:10.6mm;position:relative;display:flex;align-items:center;justify-content:center;font-size:7pt;color:#70838a;font-weight:700}' +
  '.cut:before{content:"";position:absolute;border-top:.2mm dashed #8a9ca6;top:50%;left:0;right:0}.cut span{z-index:1;background:#fff;padding:0 5mm}' +
  '@media print{body{background:white}.toolbar{display:none}.page{margin:0;box-shadow:none;break-after:page;page-break-after:always} .ticket{break-inside:avoid}}' +
  '</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save as PDF · A4 (2 copies)</button></div>' +
  '<main class="page">'+copy("PLANT / OFFICE COPY",plant,design,data,sample) +
  '<div class="cut"><span>CUT HERE</span></div>' +
  copy("CUSTOMER / SITE COPY",plant,design,data,sample) +
  '</main></body></html>';
}
