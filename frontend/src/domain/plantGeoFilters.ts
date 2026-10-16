// Customer-entered geographic filters are applied after a short debounce.
// The four values are not Google Places content and must not be confused with
// verified coordinates or an exhaustive location directory.
export type PlantGeoFilters = {
  state: string;
  district: string;
  taluka: string;
  city: string;
};

export const EMPTY_PLANT_GEO: PlantGeoFilters = {
  state: "",
  district: "",
  taluka: "",
  city: "",
};

export function cleanPlantGeo(input: PlantGeoFilters): PlantGeoFilters {
  return {
    state: input.state.trim(),
    district: input.district.trim(),
    taluka: input.taluka.trim(),
    city: input.city.trim(),
  };
}

export function plantGeoLocationLabel(input: PlantGeoFilters): string {
  return [input.city, input.taluka, input.district, input.state, "India"]
    .filter(Boolean)
    .join(", ");
}

export function hasPlantGeoFilters(input: PlantGeoFilters): boolean {
  return Boolean(input.state || input.district || input.taluka || input.city);
}

export function isValidPlantGeo(input: PlantGeoFilters): boolean {
  return Object.values(input).every(value =>
    value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value)
  );
}
