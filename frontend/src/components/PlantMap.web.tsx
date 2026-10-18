import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { PlantData } from "./PlantCard";
import { AppText } from "./ui/AppText";
import { useTheme } from "@/src/theme/ThemeProvider";
import { LatLng, validLatLng } from "@/src/maps/geo";
import { loadGoogleMaps, onMapsAuthFailure, MapsApi, MapsMap, MapsMarker } from "@/src/maps/googleMapsLoader";

type Props = {
  plants: PlantData[];
  userLocation?: LatLng | null;
  selectedPlantId?: string | null;
  onSelectPlant?: (plant: PlantData) => void;
  onRegionChange?: (center: LatLng) => void;
};
// Expo replaces this variable at BUILD time. Never use the server Places key here.
const KEY = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || "").trim();

export function PlantMap({ plants, userLocation, selectedPlantId, onSelectPlant, onRegionChange }: Props) {
  const { colors } = useTheme();
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapsMap | null>(null);
  const markers = useRef<MapsMarker[]>([]);
  const callbacks = useRef({ plants, onSelectPlant, onRegionChange });
  callbacks.current = { plants, onSelectPlant, onRegionChange };
  const [api, setApi] = useState<MapsApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mapped = useMemo(
    () => plants.filter((plant): plant is PlantData & LatLng => validLatLng(plant)),
    [plants],
  );

  useEffect(() => {
    let disposed = false;
    const element = host.current;
    const stop = onMapsAuthFailure(() => {
      if (!disposed) setError("Google Maps could not authenticate. Plant listings remain available. Check the browser console for the Google error code.");
    });
    void loadGoogleMaps(KEY).then(maps => {
      if (disposed || !element) return;
      const instance = new maps.Map(element, {
        center: { lat: 20, lng: 78 }, zoom: 5, gestureHandling: "cooperative",
        mapTypeControl: false, streetViewControl: false,
      });
      map.current = instance;
      let dragged = false;
      instance.addListener("dragstart", () => { dragged = true; });
      instance.addListener("idle", () => {
        if (!dragged) return;
        dragged = false;
        const center = instance.getCenter()?.toJSON();
        if (validLatLng(center)) callbacks.current.onRegionChange?.(center);
      });
      setApi(maps);
    }).catch(() => {
      if (!disposed) setError(KEY
        ? "The map could not load. Check your connection and Google Maps configuration. Plant listings remain available."
        : "The map is unavailable because the web Maps key was missing when this application was built.");
    });
    return () => {
      disposed = true;
      stop();
      markers.current.forEach(marker => {
        window.google?.maps.event.clearInstanceListeners(marker);
        marker.setMap(null);
      });
      markers.current = [];
      if (map.current) window.google?.maps.event.clearInstanceListeners(map.current);
      map.current = null;
      element?.replaceChildren();
    };
  }, []);

  useEffect(() => {
    if (!api || !map.current || error) return;
    const instance = map.current;
    markers.current.forEach(marker => {
      api.event.clearInstanceListeners(marker);
      marker.setMap(null);
    });
    markers.current = mapped.map(plant => {
      const marker = new api.Marker({ map: instance, position: { lat: plant.lat, lng: plant.lng }, title: plant.name });
      marker.addListener("click", () => {
        instance.panTo({ lat: plant.lat, lng: plant.lng });
        callbacks.current.onSelectPlant?.(plant);
      });
      return marker;
    });
    if (validLatLng(userLocation)) markers.current.push(new api.Marker({
      map: instance, position: userLocation, title: "Selected search location",
    }));
  }, [api, mapped, userLocation, error]);

  // Programmatic pans never trigger a nearby search: only a user drag does.
  useEffect(() => {
    if (!api || !map.current || error) return;
    const selected = mapped.find(plant => plant.id === selectedPlantId);
    const center = selected || (validLatLng(userLocation) ? userLocation : mapped[0]);
    if (center) {
      map.current.panTo({ lat: center.lat, lng: center.lng });
      if (selected || map.current.getZoom() < 9) map.current.setZoom(selected ? 14 : 11);
    }
  }, [api, mapped, userLocation, selectedPlantId, error]);

  return <View style={{ flex: 1, width: "100%", height: "100%", minHeight: 210, position: "relative" }}>
    {React.createElement("div", {
      ref: host, role: "region", "aria-label": "Map of nearby concrete plants",
      style: { position: "absolute", inset: 0, width: "100%", height: "100%" },
    })}
    {!api || error ? <View accessibilityRole={error ? "alert" : undefined}
      style={{ position: "absolute", inset: 0, padding: 16, backgroundColor: colors.isDark ? "#1A1F26" : "#F6F8FA", justifyContent: "center", gap: 12 }}>
      <AppText>{error || "Loading Google Maps…"}</AppText>
      {error ? <Pressable accessibilityRole="button" onPress={() => window.location.reload()}>
        <AppText style={{ color: colors.brand }}>Reload map</AppText>
      </Pressable> : null}
    </View> : null}
  </View>;
}
