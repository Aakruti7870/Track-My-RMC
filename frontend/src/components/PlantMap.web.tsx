import React from "react";

import { PlantData } from "./PlantCard";
import { MapPlaceholder } from "./ui/MapPlaceholder";
import { LatLng, validLatLng } from "@/src/maps/geo";

type Props = {
  plants: PlantData[];
  userLocation?: LatLng | null;
  onSelectPlant?: (plant: PlantData) => void;
};

export function PlantMap({ plants }: Props) {
  const pins = plants.filter((plant) => validLatLng(plant)).length;
  return (
    <MapPlaceholder
      pins={pins}
      label="Interactive Google Maps is available in the Android app"
      style={{ minHeight: 210 }}
    />
  );
}
