import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import Constants from "expo-constants";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";

import { PlantData } from "./PlantCard";
import { AppText } from "./ui/AppText";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";
import { LatLng, validLatLng } from "@/src/maps/geo";

type Props = {
  plants: PlantData[];
  userLocation?: LatLng | null;
  selectedPlantId?: string | null;
  onSelectPlant?: (plant: PlantData) => void;
  onRegionChange?: (center: LatLng) => void;
};

function regionFor(plants: PlantData[], userLocation?: LatLng | null): Region | null {
  const points = plants
    .filter((plant) => validLatLng(plant))
    .map((plant) => ({ latitude: plant.lat!, longitude: plant.lng! }));
  if (userLocation && validLatLng(userLocation)) {
    points.push({ latitude: userLocation.lat, longitude: userLocation.lng });
  }
  if (!points.length) return null;

  const latitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const longitude = points.reduce((sum, point) => sum + point.longitude, 0) / points.length;
  const latSpan = Math.max(...points.map((point) => Math.abs(point.latitude - latitude))) * 2;
  const lngSpan = Math.max(...points.map((point) => Math.abs(point.longitude - longitude))) * 2;

  return {
    latitude,
    longitude,
    latitudeDelta: Math.min(4, Math.max(0.08, latSpan * 1.45)),
    longitudeDelta: Math.min(4, Math.max(0.08, lngSpan * 1.45)),
  };
}

export function PlantMap({ plants, userLocation, selectedPlantId, onSelectPlant, onRegionChange }: Props) {
  const map = useRef<MapView | null>(null);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapTimedOut, setMapTimedOut] = useState(false);
  // A native map can be created with a Google logo while tile requests are
  // rejected (for example by an Android package/SHA-1 restriction).
  useEffect(() => {
    setMapLoaded(false);
    setMapTimedOut(false);
    const timer = setTimeout(() => setMapTimedOut(true), 20000);
    return () => clearTimeout(timer);
  }, [mapAttempt]);
  const currentPlants = useRef(plants);
  currentPlants.current = plants;

  // Selecting a different marker focuses it without resetting user map gestures
  // when a Places or registered-plant search refreshes the marker data.
  useEffect(() => {
    if (!selectedPlantId) return;
    const selected = currentPlants.current.find(plant => plant.id === selectedPlantId);
    if (selected && validLatLng(selected)) map.current?.animateToRegion({
      latitude: selected.lat, longitude: selected.lng,
      latitudeDelta: 0.03, longitudeDelta: 0.03,
    }, 300);
  }, [selectedPlantId]);

  // Follow a new search/GPS location only when no plant is selected. This also
  // restores the current location when the parent clears a stale selection.
  useEffect(() => {
    if (selectedPlantId || !userLocation || !validLatLng(userLocation)) return;
    map.current?.animateToRegion({
      latitude: userLocation.lat, longitude: userLocation.lng,
      latitudeDelta: 0.15, longitudeDelta: 0.15,
    }, 300);
  }, [selectedPlantId, userLocation?.lat, userLocation?.lng]);
  const { colors } = useTheme();
  const mapsConfigured = Boolean(Constants.expoConfig?.extra?.googleMapsAndroidConfigured);
  const mappedPlants = useMemo(() => plants.filter((plant) => validLatLng(plant)), [plants]);
  const initialRegion = useMemo(() => regionFor(mappedPlants, userLocation), [mappedPlants, userLocation]);

  if (!mapsConfigured) {
    return (
      <View style={{padding:16}}><AppText>The map is currently unavailable. Browse the plant list or open Directions below.</AppText></View>
    );
  }

  if (!initialRegion) {
    return (
      <View style={{padding:16}}><AppText>Choose a site to center the map. No plant coordinates are available for this search.</AppText></View>
    );
  }

  return (
    <View style={[styles.shell, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
      <MapView
        key={mapAttempt}
        ref={map}
        testID="customer-plants-map"
        onMapLoaded={() => { setMapLoaded(true); setMapTimedOut(false); }}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={userLocation ? {latitude:userLocation.lat,longitude:userLocation.lng,latitudeDelta:0.15,longitudeDelta:0.15} : initialRegion}
        onRegionChangeComplete={(region, details) => { if (details.isGesture) onRegionChange?.({lat:region.latitude,lng:region.longitude}); }}
        showsCompass
        showsScale
        toolbarEnabled={false}
        moveOnMarkerPress={false}
      >
        {mappedPlants.map((plant) => {
          const status = (plant.status || "active").toLowerCase();
          const eligible = plant.order_enabled ?? (status === "active" && plant.verified);
          return (
            <Marker
              key={plant.id}
              identifier={`plant-${plant.id}`}
              coordinate={{ latitude: plant.lat!, longitude: plant.lng! }}
              title={plant.name}
              description={[plant.city, plant.district].filter(Boolean).join(" · ")}
              pinColor={eligible ? colors.success : colors.warning}
              onPress={() => onSelectPlant?.(plant)}
            />
          );
        })}
        {userLocation && validLatLng(userLocation) ? (
          <Marker
            identifier="customer-location"
            coordinate={{ latitude: userLocation.lat, longitude: userLocation.lng }}
            title="Your location"
            pinColor={colors.brand}
          />
        ) : null}
      </MapView>

      {mapTimedOut && !mapLoaded ? (
        <View
          accessibilityRole="alert"
          style={[styles.mapWarning, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <AppText style={{ color: colors.onSurface, fontSize: 12 }}>
            Map tiles are not loading. Check your connection or retry. Plant listings are still available.
          </AppText>
          <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
            <Pressable accessibilityRole="button" onPress={() => setMapAttempt(value => value + 1)}>
              <AppText style={{ color: colors.brand, fontFamily: fonts.semibold }}>Retry map</AppText>
            </Pressable>
            <Pressable accessibilityRole="link" onPress={() => {
              const center = userLocation && validLatLng(userLocation)
                ? userLocation
                : mappedPlants[0];
              if (center) {
                void Linking.openURL(
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${center.lat},${center.lng}`)}`
                );
              }
            }}>
              <AppText style={{ color: colors.brand, fontFamily: fonts.semibold }}>Open Google Maps</AppText>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={[styles.badge, { backgroundColor: colors.surface + "EE", borderColor: colors.border }]} pointerEvents="none">
        <AppText style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.onSurface }}>
          Google Maps · {mappedPlants.length} plant{mappedPlants.length === 1 ? "" : "s"}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    minHeight: 210,
    overflow: "hidden",
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  mapWarning: {
    position: "absolute",
    bottom: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 8,
    elevation: 4,
  },
  badge: {
    position: "absolute",
    left: spacing.sm,
    top: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
});
