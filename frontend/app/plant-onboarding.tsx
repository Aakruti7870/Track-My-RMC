import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";

import { apiPublicGet, apiPublicPost } from "@/src/api/client";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type PlaceResult = {
  place_id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  taluka?: string | null;
  district?: string | null;
  state?: string | null;
  lat: number;
  lng: number;
};

type PlaceSearchResponse = {
  configured: boolean;
  places: PlaceResult[];
};

type OnboardingResponse = {
  status: "PENDING";
  request_id: string;
  message: string;
  support_notified?: { email: boolean; whatsapp: boolean };
};

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

function formatReverseAddress(result: Location.LocationGeocodedAddress): string {
  return [
    result.name,
    result.street,
    result.district,
    result.city,
    result.subregion,
    result.region,
    result.postalCode,
    result.country,
  ]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(", ");
}

export default function PlantOnboarding() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ email?: string }>();

  const initialEmail = useMemo(() => {
    const raw = Array.isArray(params.email) ? params.email[0] : params.email;
    return (raw || "").trim().toLowerCase();
  }, [params.email]);

  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [mobile, setMobile] = useState("");
  const [plantName, setPlantName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [googlePlaceId, setGooglePlaceId] = useState<string | null>(null);
  const [locationSource, setLocationSource] = useState<"google" | "current" | "manual" | null>(null);

  const [placeQuery, setPlaceQuery] = useState("");
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const locationMarked = lat !== null && lng !== null && !!address.trim();

  const searchPlaces = async () => {
    setError(null);
    const query = placeQuery.trim();
    if (query.length < 3) {
      setError("Enter at least 3 characters to search a plant or address");
      return;
    }
    setSearching(true);
    try {
      let path = `/plant-onboarding/places?q=${encodeURIComponent(query)}`;
      if (lat !== null && lng !== null) path += `&lat=${lat}&lng=${lng}`;
      const response = await apiPublicGet<PlaceSearchResponse>(path);
      if (!response.configured) {
        setPlaces([]);
        setError("Google location search is not configured. Use Current Location or enter the address manually.");
        return;
      }
      setPlaces(response.places || []);
      if (!(response.places || []).length) setError("No matching locations found. Try a wider address search.");
    } catch (e: any) {
      setError(e.detail || "Location search is temporarily unavailable");
    } finally {
      setSearching(false);
    }
  };

  const choosePlace = (place: PlaceResult) => {
    setGooglePlaceId(place.place_id);
    setLat(place.lat);
    setLng(place.lng);
    setAddress(place.address || [place.taluka || place.city, place.district, place.state].filter(Boolean).join(", "));
    if (!plantName.trim() && place.name) setPlantName(place.name);
    setPlaceQuery(place.name);
    setLocationSource("google");
    setPlaces([]);
    setError(null);
  };

  const useCurrentLocation = async () => {
    setError(null);
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setError("Location permission is required to mark the current plant location.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      let resolvedAddress = "";
      try {
        const reverse = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (reverse.length) resolvedAddress = formatReverseAddress(reverse[0]);
      } catch {
        /* GPS coordinates remain valid even when reverse geocoding is unavailable. */
      }
      setLat(latitude);
      setLng(longitude);
      setGooglePlaceId(null);
      setLocationSource("current");
      if (resolvedAddress) setAddress(resolvedAddress);
      else if (!address.trim()) setAddress(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
      toast("Current plant location marked", "success");
    } catch (e: any) {
      setError(e?.message || "Could not read your current location");
    } finally {
      setLocating(false);
    }
  };

  const applyManualAddress = () => {
    if (!address.trim()) {
      setError("Enter the plant address first");
      return;
    }
    if (lat === null || lng === null) {
      setError("Use Search Location or Current Location once to capture map coordinates.");
      return;
    }
    setGooglePlaceId(null);
    setLocationSource("manual");
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (ownerName.trim().length < 2) return setError("Enter the Plant Owner name");
    if (!validEmail(email)) return setError("Enter a valid email address");
    if (mobile.length !== 10) return setError("Enter a valid 10-digit mobile number");
    if (plantName.trim().length < 2) return setError("Enter the plant name");
    if (!locationMarked || lat === null || lng === null) return setError("Mark the plant location before submitting");

    setSubmitting(true);
    try {
      const response = await apiPublicPost<OnboardingResponse>("/plant-onboarding/requests", {
        owner_name: ownerName.trim(),
        email: email.trim().toLowerCase(),
        mobile: `+91${mobile}`,
        plant_name: plantName.trim(),
        address: address.trim(),
        lat,
        lng,
        google_place_id: googlePlaceId || undefined,
      });
      setRequestId(response.request_id);
      toast("Onboarding request submitted", "success");
    } catch (e: any) {
      setError(e.detail || "Could not submit onboarding request");
    } finally {
      setSubmitting(false);
    }
  };

  if (requestId) {
    return (
      <View style={[styles.successPage, { backgroundColor: colors.surface, paddingTop: insets.top + spacing.xl }]}>
        <View style={[styles.successIcon, { backgroundColor: colors.success + "18" }]}>
          <Ionicons name="checkmark-circle" size={52} color={colors.success} />
        </View>
        <AppText variant="title" center>Onboarding Request Received</AppText>
        <AppText variant="bodyMuted" center>
          Thank you, {ownerName.trim()}. Your plant details are now pending TrackMyRMC Authority review.
        </AppText>
        <View style={[styles.requestCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <AppText variant="caption" center>REQUEST ID</AppText>
          <AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.onSurface }} center>
            {requestId}
          </AppText>
        </View>
        <AppText variant="caption" center>
          Approval is not automatic. Once approved, use your registered email on Plant Staff Login to receive an email OTP.
        </AppText>
        <Button label="Back to Login" onPress={() => router.replace("/login" as any)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={[styles.backButton, { borderColor: colors.border }]}>
            <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="title">TMRMC Onboard</AppText>
            <AppText variant="caption">Plant / Partner onboarding request</AppText>
          </View>
        </View>

        <View style={[styles.infoBanner, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "55" }]}>
          <Ionicons name="hand-left-outline" size={22} color={colors.brand} />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>Welcome to TrackMyRMC</AppText>
            <AppText variant="caption">Submit your RMC plant details. The Authority team reviews the request before any Owner account is activated.</AppText>
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="heading">Owner Details</AppText>
          <Input
            testID="onboarding-owner-name"
            label="Owner name"
            value={ownerName}
            onChangeText={setOwnerName}
            placeholder="Full name"
            autoCapitalize="words"
          />
          <Input
            testID="onboarding-email"
            label="Email ID"
            value={email}
            onChangeText={(text) => setEmail(text.trimStart().toLowerCase())}
            placeholder="name@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={[styles.phoneInputWrap, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
            <View style={[styles.prefix, { borderRightColor: colors.border }]}><AppText style={styles.prefixText}>+91</AppText></View>
            <TextInput
              testID="onboarding-mobile"
              value={mobile}
              onChangeText={(text) => setMobile(text.replace(/\D/g, "").slice(0, 10))}
              placeholder="10-digit mobile number"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="number-pad"
              maxLength={10}
              style={[styles.phoneInput, { color: colors.onSurface }]}
            />
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="heading">Plant Details</AppText>
          <Input
            testID="onboarding-plant-name"
            label="Plant name"
            value={plantName}
            onChangeText={setPlantName}
            placeholder="RMC plant name"
          />

          <View style={{ gap: spacing.sm }}>
            <AppText variant="label">Mark Plant Location</AppText>
            <View style={styles.searchRow}>
              <TextInput
                testID="onboarding-location-search"
                value={placeQuery}
                onChangeText={(text) => { setPlaceQuery(text); setPlaces([]); setError(null); }}
                onSubmitEditing={searchPlaces}
                placeholder="Search plant, road, area or PIN code"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={[styles.searchInput, { color: colors.onSurface, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
              />
              <Pressable
                testID="onboarding-search-location-button"
                onPress={searchPlaces}
                disabled={searching}
                style={[styles.searchButton, { backgroundColor: colors.brand }]}
              >
                <Ionicons name={searching ? "hourglass-outline" : "search"} size={20} color={colors.onBrand} />
              </Pressable>
            </View>

            {places.length ? (
              <View style={[styles.results, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                {places.map((place) => (
                  <Pressable
                    key={place.place_id}
                    testID={`onboarding-place-${place.place_id}`}
                    onPress={() => choosePlace(place)}
                    style={[styles.resultRow, { borderBottomColor: colors.border }]}
                  >
                    <Ionicons name="location-outline" size={19} color={colors.brand} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm, color: colors.onSurface }}>{place.name}</AppText>
                      <AppText variant="caption">{place.address || [place.city, place.district, place.state].filter(Boolean).join(", ")}</AppText>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={styles.orRow}>
              <View style={[styles.line, { backgroundColor: colors.border }]} />
              <AppText variant="caption">OR</AppText>
              <View style={[styles.line, { backgroundColor: colors.border }]} />
            </View>

            <Button
              testID="onboarding-use-current-location"
              label={locating ? "Locating…" : "Use Current Location"}
              onPress={useCurrentLocation}
              loading={locating}
              variant="outline"
              icon={<Ionicons name="locate-outline" size={18} color={colors.brand} />}
            />
          </View>

          <View style={{ gap: spacing.sm }}>
            <AppText variant="label">Plant address</AppText>
            <TextInput
              testID="onboarding-address"
              value={address}
              onChangeText={(text) => { setAddress(text); if (locationSource) setLocationSource("manual"); }}
              placeholder="Full plant address"
              placeholderTextColor={colors.onSurfaceTertiary}
              multiline
              style={[styles.addressInput, { color: colors.onSurface, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
            />
            {locationMarked ? (
              <View style={[styles.locationMarked, { borderColor: colors.success + "66", backgroundColor: colors.success + "12" }]}>
                <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText style={{ fontFamily: fonts.semibold, color: colors.success }}>Location Marked</AppText>
                  <AppText variant="caption">{lat?.toFixed(6)}, {lng?.toFixed(6)} · {locationSource === "google" ? "Google search" : locationSource === "current" ? "Current GPS" : "Confirmed address"}</AppText>
                </View>
              </View>
            ) : null}
            {locationMarked && locationSource === "manual" ? (
              <Pressable onPress={applyManualAddress} style={{ alignSelf: "flex-start" }}>
                <AppText variant="label" color={colors.brand}>Confirm edited address</AppText>
              </Pressable>
            ) : null}
          </View>
        </View>

        {error ? (
          <View style={[styles.errorBox, { borderColor: colors.error + "66", backgroundColor: colors.error + "10" }]}>
            <Ionicons name="alert-circle-outline" size={19} color={colors.error} />
            <AppText variant="caption" color={colors.error} style={{ flex: 1 }}>{error}</AppText>
          </View>
        ) : null}

        <Button
          testID="onboarding-submit"
          label="TMRMC ONBOARD"
          onPress={submit}
          loading={submitting}
          icon={<Ionicons name="business-outline" size={18} color={colors.onBrand} />}
        />
        <AppText variant="caption" center>
          Submitting this form creates a pending request only. It does not create an approved Plant Owner session.
        </AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: 80, gap: spacing.xl },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  backButton: { width: 42, height: 42, borderWidth: 1, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  infoBanner: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  section: { gap: spacing.md },
  phoneInputWrap: { flexDirection: "row", minHeight: 56, borderRadius: radius.md, borderWidth: 1, overflow: "hidden" },
  prefix: { width: 66, borderRightWidth: 1, alignItems: "center", justifyContent: "center" },
  prefixText: { fontFamily: fonts.semibold, fontSize: fontSize.base },
  phoneInput: { flex: 1, minHeight: 56, paddingHorizontal: spacing.md, fontFamily: fonts.medium, fontSize: fontSize.base },
  searchRow: { flexDirection: "row", gap: spacing.sm },
  searchInput: { flex: 1, minHeight: 50, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, fontFamily: fonts.medium, fontSize: fontSize.sm },
  searchButton: { width: 50, height: 50, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  results: { borderWidth: 1, borderRadius: radius.md, overflow: "hidden" },
  resultRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  orRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  addressInput: { minHeight: 92, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontFamily: fonts.medium, fontSize: fontSize.sm, textAlignVertical: "top" },
  locationMarked: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  errorBox: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  successPage: { flex: 1, padding: spacing.xl, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  successIcon: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
  requestCard: { alignSelf: "stretch", borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
});
