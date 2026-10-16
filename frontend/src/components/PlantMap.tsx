import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
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

export function PlantMap({ plants, userLocation, onSelectPlant, onRegionChange }: Props) {
  const map = useRef<MapView | null>(null);
  useEffect(() => {
    if (userLocation && validLatLng(userLocation)) map.current?.animateToRegion({latitude:userLocation.lat,longitude:userLocation.lng,latitudeDelta:0.15,longitudeDelta:0.15},300);
  },[userLocation]);
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
        ref={map}
        testID="customer-plants-map"
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
