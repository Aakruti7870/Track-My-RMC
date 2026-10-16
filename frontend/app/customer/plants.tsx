import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VectorSymbol } from "@/src/components/VectorSymbol";
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
import { usePermissions } from "@/src/permissions/PermissionProvider";
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
      const last = await Location.getLastKnownPositionAsync({maxAge:NEARBY_CACHE_TTL_MS});
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
  const { locationEnabled, enableDiscoveryLocation } = usePermissions();
  const enablePreference = useRef(enableDiscoveryLocation);
  enablePreference.current = enableDiscoveryLocation;
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
  const [showFilters,setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({q:"",grade:"",radius_km:50,verified:false});
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [recent, setRecent] = useState<{label:string;coords:LatLng}[]>([]);
  const [siteAddress,setSiteAddress] = useState("");
  const [details,setDetails] = useState<PlantData | null>(null);
  const manualLocation = useRef(false);
  const { data, loading, error, refetch, reload, clearCache } = usePlantSearch(userLocation, filters, page);
  const didInit = useRef(false);
  const previousLocationStatus = useRef<NearbyLocationStatus | null>(null);
  const locationRequest = useRef(0);
  const isPlayReviewCustomer = user?.name === PLAY_REVIEW_CUSTOMER_NAME;

  const applyLocation = useCallback(async (opts: { forceRefresh?: boolean; allowPrompt?: boolean; refetchPlants?: boolean }) => {
    const request = ++locationRequest.current;
    setLocating(true);
    try {
      const result = await resolveNearbyLocation({ forceRefresh: opts.forceRefresh, allowPrompt: opts.allowPrompt });
      if (request !== locationRequest.current) return result;
      const changed = previousLocationStatus.current !== null && previousLocationStatus.current !== result.status;
      if (changed) clearCache();
      previousLocationStatus.current=result.status;
      setLocationStatus(manualLocation.current && !opts.allowPrompt ? "ok" : result.status);
      if (result.status === "ok" && opts.allowPrompt) {didInit.current=true;void enablePreference.current();}
      if (result.status === "ok" && result.coords && (!manualLocation.current || opts.allowPrompt)) {manualLocation.current=false;setUserLocation(result.coords);setPage(1);}
      if (result.status === "denied" && !manualLocation.current) {nearbyLocationCache=null;setUserLocation(null);setPage(1);}
      if (result.status === "ok" && (opts.refetchPlants || changed)) await refetch();
      return result;
    } finally {
      if (request === locationRequest.current) setLocating(false);
    }
  },[refetch,clearCache]);

  useEffect(() => {
    if (!locationEnabled) {
      didInit.current=false;
      nearbyLocationCache=null;
      if (!manualLocation.current) {setLocationStatus("denied");setUserLocation(null);}
      return;
    }
    if (didInit.current) return;
    didInit.current = true;
    void applyLocation({ forceRefresh: false, allowPrompt: false, refetchPlants: false });
  }, [applyLocation,locationEnabled]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active" && locationEnabled) void applyLocation({forceRefresh:true,allowPrompt:false});
    });
    let disposed = false;
    let permission: PermissionStatus | null = null;
    const changed = () => {if (locationEnabled) void applyLocation({forceRefresh:true,allowPrompt:false});};
    if (Platform.OS === "web" && navigator.permissions) {
      void navigator.permissions.query({name:"geolocation"}).then(status => {
        if (disposed) return;
        permission=status;status.addEventListener("change",changed);
      }).catch(() => { /* Browser without permission-status support: use resume refresh. */ });
    }
    return () => {disposed=true;subscription.remove();permission?.removeEventListener("change",changed);};
  }, [applyLocation,locationEnabled]);
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
          contentContainerStyle={{ width:"100%",maxWidth:1100,alignSelf:"center",paddingHorizontal: 16, paddingTop: 12, paddingBottom: 120, gap: 14, flexGrow: 1 }}
          ListHeaderComponent={
            <View style={{ gap: spacing.sm, marginBottom: spacing.xs }}>
              <View style={styles.mapShell}>
                <PlantMap plants={filtered} userLocation={userLocation} onSelectPlant={setDetails} onRegionChange={coords => { if (!userLocation || distanceKm(userLocation,coords)>1) { manualLocation.current=true;setUserLocation(coords); setPage(1); } }} />
              </View>

              <View style={styles.searchRow}>
                <View style={[styles.searchBar,{backgroundColor:"#FFFFFF",borderColor:"#E2E8F0"}]}>
                  <VectorSymbol name="search" size={29} />
                  <TextInput testID="plants-search" value={q}
                    onChangeText={value=>{setQ(value);setPage(1);setFilters(current=>({...current,q:value}));}}
                    placeholder="Search plant by name" placeholderTextColor="#94A3B8"
                    returnKeyType="search" style={styles.searchInput} />
                  {q ? <Pressable onPress={()=>{setQ("");setPage(1);setFilters(current=>({...current,q:""}));}} accessibilityLabel="Clear search"><Ionicons name="close" size={20} color="#94A3B8" /></Pressable> : null}
                </View>
                <Pressable testID="plants-filter-toggle" accessibilityLabel={showFilters ? "Hide filters and site selection" : "Filters and site selection"} onPress={()=>setShowFilters(v=>!v)} style={styles.orangeFilter} accessibilityRole="button">
                  <VectorSymbol name="filter" size={28} /><AppText style={styles.orangeFilterText}>Filters</AppText>
                </Pressable>
              </View>
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
            <ScreenshotPlantCard plant={item} onDetails={()=>setDetails(item)}
              onQuotation={()=>router.push({pathname:"/customer/compare-plants",params:{plantId:item.id}} as any)}
              onOrder={()=>router.push(`/new-order?plantId=${item.id}` as any)} />
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
          {details ? <><AppText variant="title">Plant Specifications</AppText><AppText style={{color:"#F25C05"}}>{details.name}</AppText><AppText>{details.address}</AppText>
          <DetailLine label="Available concrete grades" value={details.grades?.join(", ") || "Not provided"} />
          <DetailLine label="Delivery radius" value={details.service_area_km ? `${details.service_area_km} km` : "Not provided"} />
          <DetailLine label="Contact" value={details.contact_phone || "Not provided"} />
          <DetailLine label="Verification" value={details.verified ? "Verified listing" : "Verification pending"} />
          <AppText variant="caption">Plant capacity, available mixers, laboratory, loading hours and government approvals are shown only when verified records are available. Customers cannot edit plant data.</AppText>
          <Button label="Place Order" onPress={()=>{setDetails(null);router.push(`/new-order?plantId=${details.id}` as any);}} />
          </> : null}
          <Button label="Close details" onPress={() => setDetails(null)} />
        </ScrollView>
      </Modal>
    </View>
  );
}

const PLANT_ORANGE = "#F25C05";
function DetailLine({label,value}:{label:string;value:string}) {
  return <View style={{gap:4,borderBottomWidth:1,borderColor:"#E2E8F0",paddingVertical:10}}><AppText variant="caption">{label}</AppText><AppText>{value}</AppText></View>;
}
function ScreenshotPlantCard({plant,onDetails,onQuotation,onOrder}:{plant:PlantData;onDetails:()=>void;onQuotation:()=>void;onOrder:()=>void}) {
  const active=(plant.status||"active").toLowerCase()==="active";
  const eligible=plant.order_enabled ?? (active && plant.verified);
  return <View style={styles.screenshotCard}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><VectorSymbol name={plant.verified ? "verified-plant" : "unverified-plant"} size={29} /><AppText style={[styles.screenshotPlantName, { flex: 1 }]}>{plant.name}</AppText></View>
    <AppText style={styles.screenshotAddress}>{plant.address || [plant.city,plant.district].filter(Boolean).join(", ")}</AppText>
    <View style={styles.screenshotActions}>
      <Pressable accessibilityRole="button" onPress={onQuotation} style={styles.screenshotOutline}><AppText numberOfLines={2} style={styles.screenshotOutlineText}>Request Quotation</AppText></Pressable>
      <Pressable accessibilityRole="button" onPress={onDetails} accessibilityLabel="View Details" style={styles.screenshotOutline}><AppText numberOfLines={2} style={styles.screenshotOutlineText}>Plant Details</AppText></Pressable>
      <Pressable accessibilityRole="button" disabled={!eligible} onPress={onOrder} style={[styles.screenshotSolid,!eligible&&{backgroundColor:"#CBD5E1",borderColor:"#CBD5E1"}]}>
        <AppText numberOfLines={2} style={styles.screenshotSolidText}>{eligible?"Place Order":"Unavailable"}</AppText>
      </Pressable>
    </View>
  </View>;
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
  titleRow: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8, gap: 3 },
  mapShell:{height:242,borderRadius:16,overflow:"hidden",borderWidth:1,borderColor:"#E2E8F0",position:"relative"},
  mapPill:{position:"absolute",top:10,right:10,backgroundColor:"#FFFFFF",borderRadius:24,paddingVertical:7,paddingHorizontal:13,flexDirection:"row",alignItems:"center",gap:6,elevation:3},
  mapPillText:{color:"#1E293B",fontFamily:fonts.bold,fontSize:13},
  searchRow:{flexDirection:"row",gap:10,alignItems:"center"},
  orangeFilter:{backgroundColor:"#F25C05",borderRadius:12,height:46,paddingHorizontal:14,flexDirection:"row",alignItems:"center",gap:6},
  orangeFilterText:{fontFamily:fonts.semibold,fontSize:14,color:"#FFFFFF"},
  screenshotCard:{backgroundColor:"#FFFFFF",borderWidth:1,borderColor:"#E2E8F0",borderRadius:16,padding:16,gap:7,elevation:2},
  screenshotPlantName:{fontFamily:fonts.bold,fontSize:17,color:"#0F172A"},
  screenshotAddress:{fontFamily:fonts.medium,fontSize:13,lineHeight:19,color:"#475569",marginBottom:8},
  screenshotActions:{flexDirection:"row",gap:8},
  screenshotOutline:{flex:1,minHeight:42,borderWidth:1.5,borderColor:"#F25C05",borderRadius:10,alignItems:"center",justifyContent:"center",paddingHorizontal:3},
  screenshotOutlineText:{fontFamily:fonts.semibold,fontSize:11,color:"#F25C05",textAlign:"center"},
  screenshotSolid:{flex:1,minHeight:42,backgroundColor:"#F25C05",borderWidth:1.5,borderColor:"#F25C05",borderRadius:10,alignItems:"center",justifyContent:"center",paddingHorizontal:3},
  screenshotSolidText:{fontFamily:fonts.semibold,fontSize:11,color:"#FFFFFF",textAlign:"center"},
  searchBar: { flex:1,minHeight:46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, minHeight: 44, fontFamily: fonts.medium, fontSize: 14, paddingVertical: 0,color:"#1E293B" },
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
