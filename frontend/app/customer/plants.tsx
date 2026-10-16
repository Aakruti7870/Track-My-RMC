import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { usePlantSearch } from "@/src/hooks/usePlantSearch";
import { storage } from "@/src/utils/storage";
import { Button } from "@/src/components/ui/Button";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { PlantMap } from "@/src/components/PlantMap";
import { PlantCard, PlantData } from "@/src/components/PlantCard";
import { EmptyView, ErrorView } from "@/src/components/StateViews";
import { requestNearbyPlantsLocationConsent } from "@/src/location/BackgroundLocationConsent";
import { distanceKm, LatLng, validLatLng } from "@/src/maps/geo";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

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
  const [grade, setGrade] = useState("");
  const [radiusKm, setRadiusKm] = useState("50");
  const [verified, setVerified] = useState(false);
  const [mapView, setMapView] = useState(true);
  const [showFilters,setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({q:"",grade:"",radius_km:50,verified:false});
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [recent, setRecent] = useState<{label:string;coords:LatLng}[]>([]);
  const [siteAddress,setSiteAddress] = useState("");
  const [details,setDetails] = useState<PlantData | null>(null);
  const manualLocation = useRef(false);
  const { data, loading, error, refetch, reload } = usePlantSearch(userLocation, filters, page);
  const didInit = useRef(false);
  const isPlayReviewCustomer = user?.name === PLAY_REVIEW_CUSTOMER_NAME;

  const applyLocation = useCallback(async (opts: { forceRefresh?: boolean; allowPrompt?: boolean; refetchPlants?: boolean }) => {
    setLocating(true);
    try {
      const result = await resolveNearbyLocation({ forceRefresh: opts.forceRefresh, allowPrompt: opts.allowPrompt });
      setLocationStatus(result.status);
      if (result.coords && (!manualLocation.current || opts.allowPrompt)) {manualLocation.current=false;setUserLocation(result.coords);setPage(1);}
      if (result.status === "ok" && opts.refetchPlants) await refetch();
      return result;
    } finally {
      setLocating(false);
    }
  },[refetch]);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void applyLocation({ forceRefresh: false, allowPrompt: false, refetchPlants: false });
  }, [applyLocation]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void applyLocation({forceRefresh:true,allowPrompt:false});
    });
    return () => subscription.remove();
  }, [applyLocation]);
  useEffect(() => {
    let active = true;
    setRecent([]);
    if (user?.id) void storage.getItem(`recent-plant-locations-${user.id}`, "").then(raw => {
      try { const values = raw ? JSON.parse(raw) : []; if (active && Array.isArray(values)) setRecent(values.filter(v => validLatLng(v.coords)).slice(0,5)); } catch { /* Ignore invalid preferences. */ }
    });
    return () => { active = false; };
  }, [user?.id]);
  const chooseManualLocation = () => {
    const coords = {lat:Number(manualLat),lng:Number(manualLng)};
    if (!manualLat.trim() || !manualLng.trim() || !validLatLng(coords)) { toast("Enter a valid latitude and longitude", "error"); return; }
    setUserLocation(coords); setPage(1); setLocationStatus("ok");
    manualLocation.current=true;
    const locations = [{label:q.trim() || `${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)}`,coords}, ...recent.filter(v => distanceKm(v.coords,coords)>0.1)].slice(0,5);
    setRecent(locations);
    if (user?.id) void storage.setItem(`recent-plant-locations-${user.id}`,JSON.stringify(locations));
  };

  const locateAddress = async () => {
    if (!token) return;
    setLocating(true);
    try {
      const result = await apiPost<LatLng & {label:string}>("/customer/plants/locate",token,{address:siteAddress});
      if (!validLatLng(result)) throw new Error("Invalid coordinates");
      manualLocation.current=true;setUserLocation(result);setPage(1);setLocationStatus("ok");
      const locations = [{label:result.label,coords:{lat:result.lat,lng:result.lng}},...recent.filter(v=>distanceKm(v.coords,result)>0.1)].slice(0,5);
      setRecent(locations);
      if (user?.id) await storage.setItem(`recent-plant-locations-${user.id}`,JSON.stringify(locations));
    } catch (e:any) {toast(e?.detail || "Could not locate this address. Try coordinates or search plants by city.","error");}
    finally {setLocating(false);}
  };

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
    return ranked;
  }, [ranked]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={styles.titleRow}>
        <AppText variant="title">Nearby Plants</AppText>
        <AppText variant="caption">Find registered RMC plants for your delivery site.</AppText>
      </View>

      {error && !data ? <ErrorView message={error} onRetry={reload} /> : (
        <FlatList
          testID="plants-list"
          data={filtered}
          keyExtractor={(p) => p.id}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={loading && !!data}
          contentContainerStyle={{ width:"100%",maxWidth:1100,alignSelf:"center",padding: spacing.lg, paddingBottom: 120, gap: spacing.md, flexGrow: 1 }}
          ListHeaderComponent={
            <View style={{ gap: spacing.sm, marginBottom: spacing.xs }}>
              <Button label={mapView ? "List View" : "Map View"} onPress={() => setMapView(v => !v)} />
              {mapView ? <PlantMap plants={filtered} userLocation={userLocation} onSelectPlant={setDetails} onRegionChange={coords => { if (!userLocation || distanceKm(userLocation,coords)>1) { manualLocation.current=true;setUserLocation(coords); setPage(1); } }} /> : null}

              <View style={[styles.searchBar, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <Ionicons name="search-outline" size={20} color={colors.onSurfaceTertiary} />
                <TextInput
                  testID="plants-search"
                  value={q}
                  onChangeText={value => {setQ(value);setPage(1);setFilters(current=>({...current,q:value}));}}
                  placeholder="Plant name, area, city or PIN code…"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  returnKeyType="search"
                  onSubmitEditing={() => {setPage(1);setFilters({q,grade,radius_km:Number(radiusKm)||50,verified});}}
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

              <Button label={showFilters ? "Hide filters and site selection" : "Filters and site selection"} onPress={() => setShowFilters(v=>!v)} />
              {showFilters ? <Card style={{gap:12}}>
                <AppText variant="heading">Refine your search</AppText>
                <TextInput accessibilityLabel="Concrete grade" placeholder="Concrete grade, e.g. M25" value={grade} onChangeText={setGrade} style={{minHeight:48,color:colors.onSurface}} />
                <TextInput accessibilityLabel="Search radius in kilometres" placeholder="Radius in km (1–200)" value={radiusKm} onChangeText={setRadiusKm} keyboardType="numeric" style={{minHeight:48,color:colors.onSurface}} />
                <Button label={verified ? "Verified plants only ✓" : "All registered plants"} onPress={() => setVerified(v => !v)} />
                <AppText variant="caption">Active plants, sorted by distance when a location is selected. Delivery eligibility is confirmed when ordering.</AppText>
                <Button label="Apply" onPress={() => { const radius = Number(radiusKm); if (!Number.isFinite(radius)||radius<1||radius>200) {toast("Choose a radius between 1 and 200 km","error");return;} setPage(1);setFilters({q,grade,radius_km:radius,verified});}} />
                <Button label="Clear Filters" onPress={() => {setQ("");setGrade("");setRadiusKm("50");setVerified(false);setPage(1);setFilters({q:"",grade:"",radius_km:50,verified:false});}} />
                <AppText variant="heading">Choose a site manually</AppText>
                <TextInput accessibilityLabel="Site area, city or PIN code" placeholder="Site address, city or PIN code" value={siteAddress} onChangeText={setSiteAddress} style={{minHeight:48,color:colors.onSurface}} />
                <Button label="Find this location" loading={locating} onPress={locateAddress} />
                <AppText variant="caption">Search by area or PIN above without location access, or enter site coordinates to search by distance.</AppText>
                <TextInput accessibilityLabel="Site latitude" placeholder="Latitude" value={manualLat} onChangeText={setManualLat} keyboardType="numbers-and-punctuation" style={{minHeight:48,color:colors.onSurface}} />
                <TextInput accessibilityLabel="Site longitude" placeholder="Longitude" value={manualLng} onChangeText={setManualLng} keyboardType="numbers-and-punctuation" style={{minHeight:48,color:colors.onSurface}} />
                <Button label="Use this site" onPress={chooseManualLocation} />
                {recent.map((entry,i) => <Button key={i} label={`Recent: ${entry.label}`} onPress={() => {manualLocation.current=true;setUserLocation(entry.coords);setPage(1);setLocationStatus("ok");}} />)}
                {loading ? <ActivityIndicator color={colors.brand} /> : null}
                {error ? <Button label="Search failed — Retry" onPress={reload} /> : null}
              </Card> : null}

              <AppText variant="caption">{filtered.length} registered plants on this page · Sorted by distance when a site is selected</AppText>
              {loading ? <ActivityIndicator accessibilityLabel="Searching nearby plants" color={colors.brand} /> : null}
              <LocationBanner status={locationStatus} locating={locating} onEnable={enableLocation} onRetry={refreshLocation} />
              {isPlayReviewCustomer ? (
                <View testID="play-review-nearby-hint" style={[styles.reviewHint, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "44" }]}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={colors.brand} />
                  <AppText style={[styles.reviewHintText, { color: colors.onSurfaceSecondary }]}>
                    Google Play review: {PLAY_REVIEW_PLANT_NAME} is included in this list. Location is optional; choose Not now and the review plant remains available for inspection.
                  </AppText>
                </View>
              ) : null}

              <View style={styles.registeredHeading}>
                <AppText variant="heading">Registered plants</AppText>
                <AppText variant="caption">Active plants near your selected site. Delivery eligibility is checked when ordering.</AppText>
              </View>
            </View>
          }
          renderItem={({ item }) => loading && !data ? null : (
            <PlantCard plant={item} onDetails={() => setDetails(item)} onOrder={() => router.push(`/new-order?plantId=${item.id}` as any)} />
          )}
          ListFooterComponent={<View style={{gap:12}}>
            <AppText variant="caption">Page {page}</AppText>
            <Button label="Previous" variant="outline" disabled={page===1 || loading} onPress={() => setPage(v=>v-1)} />
            <Button label="Next" variant="outline" disabled={!data?.has_more || loading} onPress={() => setPage(v=>v+1)} />
          </View>}
          ListEmptyComponent={loading && !data ? (
            <View style={{ gap: spacing.md }}>{[0, 1].map((i) => <Skeleton key={i} height={140} style={{ borderRadius: radius.lg }} />)}</View>
          ) : (
            <EmptyView icon="business-outline" title="No registered plants found" subtitle={q.trim() ? "Try another name, city, PIN code or grade" : "Choose a site, increase the radius or clear your filters"} />
          )}
        />
      )}
      <Modal visible={!!details} animationType="slide" onRequestClose={() => setDetails(null)}>
        <ScrollView contentContainerStyle={{padding:24,paddingTop:56,gap:16,backgroundColor:colors.surface,flexGrow:1}}>
          {details ? <><AppText variant="title">{details.name}</AppText><AppText>{details.address}</AppText><PlantCard plant={details} onOrder={() => {setDetails(null);router.push(`/new-order?plantId=${details.id}` as any);}} /></> : null}
          <Button label="Close details" onPress={() => setDetails(null)} />
        </ScrollView>
      </Modal>
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
