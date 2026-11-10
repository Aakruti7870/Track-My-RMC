import React, { useEffect, useState } from "react";
import { Linking, Platform, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { apiPublicGet } from "@/src/api/client";
import { useTheme } from "@/src/theme/ThemeProvider";
import { spacing } from "@/src/theme/tokens";

type SharedTrip = {
  plant_name: string;
  order_number: string;
  grade: string;
  quantity_m3: number;
  status: string;
  tm_number: string;
  driver_name: string;
  site_name: string;
  challan_number: string;
  batch_time: string;
  location: { lat: number; lng: number; at: string } | null;
};

export default function PublicSharedTrip() {
  const { loadId, signature } = useLocalSearchParams<{ loadId: string; signature: string }>();
  const { colors } = useTheme();
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      if (!loadId || !signature) return;
      try {
        const result = await apiPublicGet<{ trip: SharedTrip }>(
          `/public/trip-share/${encodeURIComponent(loadId)}/${encodeURIComponent(signature)}`
        );
        if (active) setTrip(result.trip);
      } catch {
        if (active) setError("This tracking link is invalid, unavailable or expired.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    // Refresh the active trip only while mounted. Re-query, never store GPS.
    const timer = setInterval(() => void load(), 30000);
    return () => { active = false; clearInterval(timer); };
  }, [loadId, signature]);

  const openMap = async () => {
    if (!trip?.location) return;
    const { lat, lng } = trip.location;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    await Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`);
  };

  const printChallan = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.print();
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{
      padding: spacing.lg, gap: spacing.md, maxWidth: 720, width: "100%", alignSelf: "center",
    }}>
      <AppText variant="title">TrackMyRMC Delivery</AppText>
      {loading && !trip ? <AppText>Loading trip details…</AppText> : null}
      {error ? <AppText style={{ color: colors.error }}>{error}</AppText> : null}
      {trip ? (
        <>
          <Card style={{ gap: spacing.sm }}>
            <AppText variant="heading">{trip.plant_name}</AppText>
            <AppText>Order: {trip.order_number}</AppText>
            <AppText>Delivery: {trip.status.replace(/_/g, " ")}</AppText>
            <AppText>Grade: {trip.grade}</AppText>
            <AppText>Quantity: {trip.quantity_m3} m³</AppText>
            <AppText>Transit Mixer: {trip.tm_number}</AppText>
            <AppText>Driver: {trip.driver_name}</AppText>
            <AppText>Site: {trip.site_name}</AppText>
          </Card>
          <Card style={{ gap: spacing.sm }}>
            <AppText variant="heading">Delivery Challan</AppText>
            <AppText>Challan: {trip.challan_number}</AppText>
            <AppText>Batch time: {new Date(trip.batch_time).toLocaleString()}</AppText>
            {Platform.OS === "web" ? (
              <Button label="Print / Save Challan as PDF" variant="outline" onPress={printChallan} />
            ) : null}
          </Card>
          {trip.location ? (
            <Card style={{ gap: spacing.sm }}>
              <AppText variant="heading">Live Mixer Location</AppText>
              <AppText>Last update: {new Date(trip.location.at).toLocaleString()}</AppText>
              <Button label="View Current Location on Map" onPress={() => void openMap()} />
            </Card>
          ) : (
            <AppText style={{ color: colors.onSurfaceSecondary }}>
              Live coordinates are unavailable or stale. Delivery status remains visible.
            </AppText>
          )}
          <View style={{ gap: spacing.sm }}>
            <AppText>Want to place your next RMC order online?</AppText>
            <Button
              label="Download TrackMyRMC"
              variant="secondary"
              onPress={() => void Linking.openURL(
                "https://play.google.com/store/apps/details?id=com.trackmyrmc.concreteking"
              )}
            />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
