const ingredients = [
  { key: "cement_kg", name: "Cement", unit: "kg", aliases: ["cement", "opc", "ppc", "psc"] },
  { key: "fly_ash_kg", name: "Fly ash", unit: "kg", aliases: ["fly ash", "flyash"] },
  { key: "c_sand_kg", name: "Crushed sand", unit: "kg", aliases: ["crushed sand", "c sand", "m sand", "manufactured sand"] },
  { key: "sand_kg", name: "Sand", unit: "kg", aliases: ["sand", "natural sand", "river sand"] },
  { key: "aggregate_10mm_kg", name: "10 mm aggregate", unit: "kg", aliases: ["10 mm aggregate", "aggregate 10 mm", "10 mm"] },
  { key: "aggregate_20mm_kg", name: "20 mm aggregate", unit: "kg", aliases: ["20 mm aggregate", "aggregate 20 mm", "20 mm"] },
  { key: "admixture_kg", name: "Admixture", unit: "kg", aliases: ["admixture", "chemical admixture"] },
  { key: "water_litre", name: "Water", unit: "L", aliases: ["water", "batch water"] },
] as const;

type Ingredient = typeof ingredients[number];
export type IngredientKey = Ingredient["key"];
type Decimal = string | number | null;

export type MixDesign = Partial<Record<IngredientKey, Decimal>> & {
  id: string;
  grade: string;
  version: number;
  active: boolean;
};
export type Material = { id: string; name: string; material_type: string; unit: string };
export type PurchaseReceipt = { id: string; receipt_number: string; receipt_date: string; lines: unknown };
export type DieselEntry = { transaction_type: string; transaction_date: string; rate_per_litre: Decimal };

type Rate = {
  perBaseUnit: number;
  receipt: PurchaseReceipt;
  usesInventoryUnit: boolean;
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const unitConversions = new Map<string, { unit: "kg" | "L"; factor: number }>([
  ...["kg", "kgs", "kilogram", "kilograms"].map(unit => [unit, { unit: "kg", factor: 1 }] as const),
  ...["g", "gram", "grams"].map(unit => [unit, { unit: "kg", factor: 0.001 }] as const),
  ...["t", "mt", "tonne", "tonnes", "metricton", "metrictons", "metrictonne", "metrictonnes"]
    .map(unit => [unit, { unit: "kg", factor: 1_000 }] as const),
  ...["l", "ltr", "ltrs", "liter", "liters", "litre", "litres"]
    .map(unit => [unit, { unit: "L", factor: 1 }] as const),
  ["ml", { unit: "L", factor: 0.001 }],
  ["kl", { unit: "L", factor: 1_000 }],
]);

export function nonnegativeNumber(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function costingDate() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

function readPurchaseLine(value: unknown, materials: Map<string, Material>) {
  if (!value || typeof value !== "object") return null;
  const line = value as Record<string, unknown>;
  const material = typeof line.material_id === "string" ? materials.get(line.material_id) : undefined;
  const quantity = nonnegativeNumber(line.quantity);
  const rate = nonnegativeNumber(line.rate);
  if (!material || !quantity || rate === null) return null;

  const usesInventoryUnit = line.unit == null;
  const unit = usesInventoryUnit ? material.unit : line.unit;
  const conversion = typeof unit === "string" ? unitConversions.get(normalize(unit)) : undefined;
  if (!conversion) return null;

  return {
    key: `${material.id}:${conversion.unit}`,
    baseQuantity: quantity * conversion.factor,
    cost: quantity * rate,
    usesInventoryUnit,
  };
}

export function latestPurchaseRates(receipts: PurchaseReceipt[], materials: Material[], asOf: string) {
  const materialById = new Map(materials.map(material => [material.id, material]));
  const rates = new Map<string, Rate>();

  // The API orders receipts by receipt date and then creation time, newest first.
  for (const receipt of receipts) {
    if (!receipt.receipt_date || receipt.receipt_date > asOf || !Array.isArray(receipt.lines)) continue;

    const receiptTotals = new Map<string, { baseQuantity: number; cost: number; usesInventoryUnit: boolean }>();
    for (const raw of receipt.lines) {
      const line = readPurchaseLine(raw, materialById);
      if (!line || rates.has(line.key)) continue;

      const totals = receiptTotals.get(line.key) ?? { baseQuantity: 0, cost: 0, usesInventoryUnit: false };
      totals.baseQuantity += line.baseQuantity;
      totals.cost += line.cost;
      totals.usesInventoryUnit ||= line.usesInventoryUnit;
      receiptTotals.set(line.key, totals);
    }
    for (const [key, totals] of receiptTotals) {
      const perBaseUnit = totals.cost / totals.baseQuantity;
      if (Number.isFinite(perBaseUnit)) {
        rates.set(key, { perBaseUnit, receipt, usesInventoryUnit: totals.usesInventoryUnit });
      }
    }
  }

  return rates;
}

export function priceMix(
  mix: MixDesign,
  materials: Material[],
  rates: ReturnType<typeof latestPurchaseRates>,
  selections: Partial<Record<IngredientKey, string>>,
) {
  return ingredients.flatMap(ingredient => {
    const rawQuantity = mix[ingredient.key];
    const quantity = rawQuantity == null ? 0 : nonnegativeNumber(rawQuantity);
    if (quantity === 0) return [];

    const matches = materials.filter(material => {
      const name = normalize(material.name);
      const namedIngredient = ingredients.find(item => item.aliases.some(alias => normalize(alias) === name));
      if (namedIngredient) return namedIngredient.key === ingredient.key;
      return ingredient.aliases.some(alias => normalize(alias) === normalize(material.material_type));
    });
    const material = selections[ingredient.key]
      ? materials.find(item => item.id === selections[ingredient.key])
      : matches.length === 1 ? matches[0] : undefined;
    const rate = material && rates.get(`${material.id}:${ingredient.unit}`);
    const calculated = quantity !== null && rate ? quantity * rate.perBaseUnit : null;
    const cost = calculated !== null && Number.isFinite(calculated) ? calculated : null;
    return [{ ingredient, quantity, material, rate, cost }];
  });
}

export function materialTotal(lines: ReturnType<typeof priceMix>) {
  if (!lines.length || lines.some(line => line.cost === null)) return null;
  const amount = lines.reduce((sum, line) => sum + (line.cost ?? 0), 0);
  return Number.isFinite(amount) ? amount : null;
}

export function latestDieselRate(entries: DieselEntry[], asOf: string) {
  return entries.find(entry => entry.transaction_type.toUpperCase() === "IN"
    && entry.transaction_date <= asOf && Boolean(nonnegativeNumber(entry.rate_per_litre)));
}

export function deliveryCostPerM3(distance: string, volume: string, efficiency: string, fuelRate: Decimal, extra: string) {
  const km = nonnegativeNumber(distance);
  const cubicMetres = nonnegativeNumber(volume);
  const kmPerLitre = nonnegativeNumber(efficiency);
  const rate = nonnegativeNumber(fuelRate);
  const extraCost = nonnegativeNumber(extra.trim() || "0");

  if (km === null || !cubicMetres || !kmPerLitre || !rate || extraCost === null) return null;
  const amount = (km / kmPerLitre * rate + extraCost) / cubicMetres;
  return Number.isFinite(amount) ? amount : null;
}
