import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { apiGet, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { PlantMap } from "@/src/components/PlantMap";
import { PlantCard, PlantData } from "@/src/components/PlantCard";
import { EmptyView, ErrorView } from "@/src/components/StateViews";
import { requestNearbyPlantsLocationConsent } from "@/src/location/BackgroundLocationConsent";
import { distanceKm, LatLng, validLatLng } from "@/src/maps/geo";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type GooglePlant = {
  place_id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  lat: number;
  lng: number;
  contact_phone?: string | null;
  google_maps_uri?: string | null;
  business_status?: string | null;
  registered: boolean;
  plant_id?: string | null;
  request_status?: string | null;
};

type GoogleDiscoveryResponse = { configured: boolean; places: GooglePlant[] };

type NearbyLocationStatus = "ok" | "denied" | "services-disabled" | "timeout" | "unavailable";
type NearbyLocationResult = { status: NearbyLocationStatus; coords: LatLng | null; fromCache?: boolean; canAskAgain?: boolean };

let nearbyLocationCache: { coords: LatLng; at: number } | null = null;
const NEARBY_CACHE_TTL_MS = 5 * 60 * 1000;
const NEARBY_GPS_TIMEOUT_MS = 12000;
const PLAY_REVIEW_CUSTOMER_NAME = "Google Play Review Customer";
const PLAY_REVIEW_PLANT_NAME = "TrackMyRMC Play Review Plant";

function getCachedNearbyLocation(): LatLng | null {
  if (nearbyLocationCache && Date.now() - nearbyLocationCache.at < NEARBY_CACHE_TTL_MS) return nearbyLocationCache.coords;
  return null;
}

function rememberNearbyLocation(coords: LatLng) {
  nearbyLocationCache = { coords, at: Date.now() };
}

async function withLocationTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("LOCATION_TIMEOUT")), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function resolveNearbyLocation(opts?: { forceRefresh?: boolean; allowPrompt?: boolean }): Promise<NearbyLocationResult> {
  const forceRefresh = opts?.forceRefresh ?? false;
  const allowPrompt = opts?.allowPrompt ?? true;

  if (!forceRefresh) {
    const cached = getCachedNearbyLocation();
    if (cached) return { status: "ok", coords: cached, fromCache: true };
  }

  let permission: Location.LocationPermissionResponse;
  try {
    permission = await Location.getForegroundPermissionsAsync();
  } catch {
    return { status: "unavailable", coords: getCachedNearbyLocation() };
  }

  if (permission.status !== "granted") {
    const undetermined = permission.status === "undetermined" || permission.canAskAgain;
    if (allowPrompt && undetermined) {
      const consented = await requestNearbyPlantsLocationConsent();
      if (!consented) {
        return { status: "denied", coords: getCachedNearbyLocation(), canAskAgain: permission.canAskAgain };
      }
      try {
        permission = await Location.requestForegroundPermissionsAsync();
      } catch {
        return { status: "unavailable", coords: getCachedNearbyLocation() };
      }
    }
    if (permission.status !== "granted") {
      return { status: "denied", coords: getCachedNearbyLocation(), canAskAgain: permission.canAskAgain };
    }
  }

  try {
    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) return { status: "services-disabled", coords: getCachedNearbyLocation() };
  } catch {
  }

  try {
    const current = await withLocationTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      NEARBY_GPS_TIMEOUT_MS,
    );
    const coords: LatLng = { lat: current.coords.latitude, lng: current.coords.longitude };
    rememberNearbyLocation(coords);
    return { status: "ok", coords };
  } catch (e: any) {
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (last) {
        const coords: LatLng = { lat: last.coords.latitude, lng: last.coords.longitude };
        rememberNearbyLocation(coords);
        return { status: "ok", coords };
      }
    } catch {
    }
    const timedOut = e?.message === "LOCATION_TIMEOUT";
    return { status: timedOut ? "timeout" : "unavailable", coords: getCachedNearbyLocation() };
  }
}

export default function CustomerPlants() {
  const { colors } = useTheme();
  const { token, user } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState<NearbyLocationStatus | null>(null);
  const [googlePlants, setGooglePlants] = useState<GooglePlant[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [requestingPlace, setRequestingPlace] = useState<string | null>(null);
  const { data, loading, error, refetch, reload } = useGet<{ plants: PlantData[] }>("/customer/plants");
  const didInit = useRef(false);
  const isPlayReviewCustomer = user?.name === PLAY_REVIEW_CUSTOMER_NAME;

  const applyLocation = async (opts: { forceRefresh?: boolean; allowPrompt?: boolean; refetchPlants?: boolean }) => {
    setLocating(true);
    try {
      const result = await resolveNearbyLocation({ forceRefresh: opts.forceRefresh, allowPrompt: opts.allowPrompt });
      setLocationStatus(result.status);
      if (result.coords) setUserLocation(result.coords);
      if (result.status === "ok" && opts.refetchPlants) await refetch();
      return result;
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void applyLocation({ forceRefresh: false, allowPrompt: true, refetchPlants: false });
  }, []);

  const refreshLocation = () => void applyLocation({ forceRefresh: true, allowPrompt: true, refetchPlants: true });

  const enableLocation = async () => {
    if (Platform.OS === "android") {
      try { await Location.enableNetworkProviderAsync(); } catch { }
    }
    const result = await applyLocation({ forceRefresh: true, allowPrompt: true, refetchPlants: true });
    if (result.status === "denied" && result.canAskAgain === false) {
      try { await Linking.openSettings(); } catch { }
    }
  };

  const discoverOnGoogle = async () => {
    if (!token) return;
    if (!userLocation) {
      toast("Refresh location first", "error");
      return;
    }
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      const query = q.trim() || "ready mix concrete RMC plant";
      const result = await apiGet<GoogleDiscoveryResponse>(
        `/maps/rmc-plants?lat=${userLocation.lat}&lng=${userLocation.lng}&radius_km=50&q=${encodeURIComponent(query)}`,
        token,
      );
      if (!result.configured) {
        setGooglePlants([]);
        setDiscoveryError("Google Places discovery is not configured on the server yet.");
        return;
      }
      setGooglePlants(result.places || []);
      if (!result.places?.length) setDiscoveryError("No additional RMC plants found. Try a plant or city name.");
    } catch (e: any) {
      setDiscoveryError(e?.detail || "Google RMC discovery failed");
    } finally {
      setDiscovering(false);
    }
  };

  const requestListing = async (place: GooglePlant) => {
    if (!token) return;
    setRequestingPlace(place.place_id);
    try {
      const result = await apiPost<{ status: string; request_id?: string; plant_id?: string }>(
        `/maps/rmc-plants/${encodeURIComponent(place.place_id)}/request-listing`,
        token,
      );
      setGooglePlants((current) => current.map((p) => p.place_id === place.place_id ? {
        ...p,
        registered: result.status === "REGISTERED" ? true : p.registered,
        plant_id: result.plant_id || p.plant_id,
        request_status: result.status === "REGISTERED" ? p.request_status : result.status,
      } : p));
      toast(result.status === "REGISTERED" ? "Plant is already registered" : "Sent to Authority for review", "success");
    } catch (e: any) {
      toast(e?.detail || "Could not submit this plant", "error");
    } finally {
      setRequestingPlace(null);
    }
  };

  const ranked = useMemo(() => {
    const list = (data?.plants || []).map((plant) => !userLocation || !validLatLng(plant)
      ? { ...plant, distance_km: null }
      : { ...plant, distance_km: distanceKm(userLocation, { lat: plant.lat!, lng: plant.lng! }) });

    list.sort((a, b) => {
      if (isPlayReviewCustomer) {
        const aReview = a.name === PLAY_REVIEW_PLANT_NAME;
        const bReview = b.name === PLAY_REVIEW_PLANT_NAME;
        if (aReview !== bReview) return aReview ? -1 : 1;
      }
      const promoted = Number(Boolean(b.promoted)) - Number(Boolean(a.promoted));
      if (promoted) return promoted;
      if (userLocation) {
        const distance = (a.distance_km ?? Number.POSITIVE_INFINITY) - (b.distance_km ?? Number.POSITIVE_INFINITY);
        if (distance) return distance;
        const enabled = Number(Boolean(b.order_enabled)) - Number(Boolean(a.order_enabled));
        if (enabled) return enabled;
      }
      return (a.name || "").localeCompare(b.name || "");
    });
    return list;
  }, [data, isPlayReviewCustomer, userLocation]);

  const filtered = useMemo(() => {
    if (!q.trim()) return ranked;
    const t = q.toLowerCase();
    return ranked.filter((p) =>
      (p.name || "").toLowerCase().includes(t) ||
      (p.city || "").toLowerCase().includes(t) ||
      (p.district || "").toLowerCase().includes(t) ||
      (p.address || "").toLowerCase().includes(t));
  }, [ranked, q]);

  const googleMapPlants = useMemo<PlantData[]>(() => googlePlants
    .filter((p) => !p.registered)
    .map((p) => ({
      id: `google:${p.place_id}`,
      name: p.name,
      city: p.city || "Google Places",
      district: p.district || undefined,
      address: p.address || "",
      lat: p.lat,
      lng: p.lng,
      grades: [],
      contact_phone: p.contact_phone || "",
      service_area_km: 0,
      status: "google_discovered",
      verified: false,
      order_enabled: false,
      distance_km: userLocation ? distanceKm(userLocation, { lat: p.lat, lng: p.lng }) : null,
    })), [googlePlants, userLocation]);

  const mapPlants = useMemo(() => [...filtered, ...googleMapPlants], [filtered, googleMapPlants]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={styles.titleRow}>
        <AppText variant="title">Nearby Plants</AppText>
        <AppText variant="caption">Registered plants first. Discover more real RMC businesses nearby when needed.</AppText>
      </View>

      {error && !data ? <ErrorView message={error} onRetry={reload} /> : (
        <FlatList
          testID="plants-list"
          data={filtered}
          keyExtractor={(p) => p.id}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={false}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.md, flexGrow: 1 }}
          ListHeaderComponent={
            <View style={{ gap: spacing.sm, marginBottom: spacing.xs }}>
              <PlantMap plants={mapPlants} userLocation={userLocation} />

              <View style={[styles.searchBar, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <Ionicons name="search-outline" size={20} color={colors.onSurfaceTertiary} />
                <TextInput
                  testID="plants-search"
                  value={q}
                  onChangeText={setQ}
                  placeholder="Search plants or area…"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  returnKeyType="search"
                  onSubmitEditing={() => { if (q.trim()) void discoverOnGoogle(); }}
                  style={[styles.searchInput, { color: colors.onSurface }]}
                />
                <Pressable
                  testID="plants-use-location"
                  accessibilityLabel="Refresh nearby plants and location"
                  onPress={refreshLocation}
                  disabled={locating}
                  style={({ pressed }) => [styles.refreshButton, { backgroundColor: colors.brandSoft, opacity: pressed || locating ? 0.65 : 1 }]}
                >
                  {locating ? <ActivityIndicator size="small" color={colors.brand} /> : <Ionicons name="refresh" size={20} color={colors.brand} />}
                </Pressable>
              </View>

              <View style={styles.discoveryRow}>
                <View style={styles.discoveryMeta}>
                  <Ionicons name="location" size={15} color={colors.brand} />
                  <AppText style={[styles.discoveryMetaText, { color: colors.onSurfaceSecondary }]}>
                    {locating && !userLocation ? "Locating…" : `${ranked.length} nearby`}
                  </AppText>
                  <View style={[styles.dotDivider, { backgroundColor: colors.border }]} />
                  <Ionicons name="search-circle-outline" size={17} color={colors.brand} />
                  <AppText style={[styles.discoveryMetaText, { color: colors.onSurfaceSecondary }]}>Google discovery</AppText>
                </View>
                <Pressable
                  testID="discover-google-rmc"
                  onPress={discoverOnGoogle}
                  disabled={discovering}
                  style={({ pressed }) => [styles.findMore, { backgroundColor: colors.brand, opacity: pressed || discovering ? 0.72 : 1 }]}
                >
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.onBrand }}>
                    {discovering ? "Searching…" : "Find More"}
                  </AppText>
                </Pressable>
              </View>

              <LocationBanner status={locationStatus} locating={locating} onEnable={enableLocation} onRetry={refreshLocation} />
              {isPlayReviewCustomer ? (
                <View testID="play-review-nearby-hint" style={[styles.reviewHint, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "44" }]}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={colors.brand} />
                  <AppText style={[styles.reviewHintText, { color: colors.onSurfaceSecondary }]}>
                    Google Play review: {PLAY_REVIEW_PLANT_NAME} is included in this list. Location is optional; choose Not now and the review plant remains available for inspection.
                  </AppText>
                </View>
              ) : null}
              {discoveryError ? <AppText variant="caption" color={colors.warning}>{discoveryError}</AppText> : null}

              <View style={styles.registeredHeading}>
                <AppText variant="heading">Registered plants</AppText>
                <AppText variant="caption">Order-enabled plants appear first by proximity.</AppText>
              </View>
            </View>
          }
          renderItem={({ item }) => loading && !data ? null : (
            <PlantCard plant={item} onOrder={() => router.push(`/new-order?plantId=${item.id}` as any)} />
          )}
          ListFooterComponent={googlePlants.length ? (
            <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
              <View style={{ gap: 2 }}>
                <AppText variant="heading">More RMC plants nearby</AppText>
                <AppText variant="caption">Google-discovered businesses are not orderable until Authority approval and plant setup.</AppText>
              </View>
              {googlePlants.map((place) => (
                <GooglePlantCard key={place.place_id} place={place} requesting={requestingPlace === place.place_id} onRequest={() => requestListing(place)} />
              ))}
            </View>
          ) : null}
          ListEmptyComponent={googlePlants.length ? null : loading && !data ? (
            <View style={{ gap: spacing.md }}>{[0, 1].map((i) => <Skeleton key={i} height={140} style={{ borderRadius: radius.lg }} />)}</View>
          ) : (
            <EmptyView icon="business-outline" title="No registered plants found" subtitle={q.trim() ? "Try another search or use Find More" : "Use Find More to discover RMC businesses nearby"} />
          )}
        />
      )}
    </View>
  );
}

function LocationBanner({ status, locating, onEnable, onRetry }: {
  status: NearbyLocationStatus | null;
  locating: boolean;
  onEnable: () => void;
  onRetry: () => void;
}) {
  const { colors } = useTheme();

  if (locating) {
    return (
      <View style={[styles.locationBanner, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "33" }]}>
        <ActivityIndicator size="small" color={colors.brand} />
        <AppText style={[styles.locationBannerText, { color: colors.onSurfaceSecondary }]}>Finding plants near you…</AppText>
      </View>
    );
  }

  if (!status || status === "ok") return null;

  const config: Record<Exclude<NearbyLocationStatus, "ok">, { icon: any; text: string; label: string; onPress: () => void }> = {
    denied: {
      icon: "location-outline",
      text: "Location is off. Showing all registered plants — search by name above, or enable location for nearest-first.",
      label: "Enable Location",
      onPress: onEnable,
    },
    "services-disabled": {
      icon: "navigate-circle-outline",
      text: "Location services are turned off. Turn them on to see the closest plants first.",
      label: "Enable Location",
      onPress: onEnable,
    },
    timeout: {
      icon: "time-outline",
      text: "Couldn’t get your location in time. Showing all plants — tap Retry to try again.",
      label: "Retry",
      onPress: onRetry,
    },
    unavailable: {
      icon: "alert-circle-outline",
      text: "Location unavailable right now. Showing all registered plants.",
      label: "Retry",
      onPress: onRetry,
    },
  };

  const c = config[status];
  return (
    <View style={[styles.locationBanner, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <Ionicons name={c.icon} size={16} color={colors.warning} />
      <AppText style={[styles.locationBannerText, { color: colors.onSurfaceSecondary }]}>{c.text}</AppText>
      <Pressable
        testID="location-banner-action"
        accessibilityRole="button"
        accessibilityLabel={c.label}
        onPress={c.onPress}
        style={({ pressed }) => [styles.locationBannerBtn, { backgroundColor: colors.brand, opacity: pressed ? 0.75 : 1 }]}
      >
        <AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.onBrand }}>{c.label}</AppText>
      </Pressable>
    </View>
  );
}

function GooglePlantCard({ place, requesting, onRequest }: { place: GooglePlant; requesting: boolean; onRequest: () => void }) {
  const { colors } = useTheme();
  const pending = place.request_status === "PENDING";
  const approved = place.request_status === "APPROVED";
  const buttonLabel = place.registered ? "Already listed" : pending ? "Sent for review" : approved ? "Approved" : requesting ? "Submitting…" : "Add to TrackMyRMC";

  const openDirections = () => {
    const url = place.google_maps_uri || `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
    void Linking.openURL(url);
  };

  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <View style={[styles.googleIcon, { backgroundColor: colors.surfaceTertiary }]}><Ionicons name="location-outline" size={18} color={colors.brand} /></View>
        <View style={{ flex: 1, gap: 3 }}>
          <AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.base, color: colors.onSurface }} numberOfLines={2}>{place.name}</AppText>
          <AppText variant="caption" numberOfLines={2}>{place.address || [place.city, place.district].filter(Boolean).join(" · ")}</AppText>
          <AppText variant="caption" color={place.registered ? colors.success : colors.warning}>
            {place.registered ? "Registered TrackMyRMC plant" : "Google-discovered · not yet verified for orders"}
          </AppText>
        </View>
      </View>
      <View style={styles.googleActions}>
        <Pressable onPress={openDirections} style={[styles.googleOutlineButton, { borderColor: colors.border }]}>
          <Ionicons name="navigate-outline" size={15} color={colors.onSurfaceSecondary} />
          <AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.onSurfaceSecondary }}>Directions</AppText>
        </Pressable>
        <Pressable
          testID={`request-google-plant-${place.place_id}`}
          disabled={place.registered || pending || approved || requesting}
          onPress={onRequest}
          style={[styles.googleRequestButton, { backgroundColor: place.registered || pending || approved ? colors.surfaceTertiary : colors.brand, opacity: requesting ? 0.7 : 1 }]}
        >
          <Ionicons name={place.registered ? "checkmark-circle-outline" : pending ? "time-outline" : "add-circle-outline"} size={15} color={place.registered || pending || approved ? colors.onSurfaceTertiary : colors.onBrand} />
          <AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: place.registered || pending || approved ? colors.onSurfaceTertiary : colors.onBrand }}>{buttonLabel}</AppText>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: 2 },
  searchBar: { minHeight: 54, borderWidth: 1, borderRadius: 18, paddingLeft: spacing.md, paddingRight: 6, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  searchInput: { flex: 1, minHeight: 52, fontFamily: fonts.medium, fontSize: fontSize.base, paddingVertical: 0 },
  refreshButton: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  discoveryRow: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  discoveryMeta: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  discoveryMetaText: { fontFamily: fonts.medium, fontSize: 12 },
  dotDivider: { width: 1, height: 18, marginHorizontal: 3 },
  findMore: { minHeight: 38, paddingHorizontal: spacing.md, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  registeredHeading: { gap: 2, paddingTop: spacing.xs },
  reviewHint: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  reviewHintText: { flex: 1, fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 },
  locationBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  locationBannerText: { flex: 1, fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 },
  locationBannerBtn: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  googleIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  googleActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  googleOutlineButton: { minHeight: 38, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  googleRequestButton: { minHeight: 38, paddingHorizontal: spacing.md, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginLeft: "auto" },
});