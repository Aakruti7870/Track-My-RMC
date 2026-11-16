import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Share, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiPost } from "@/src/api/client";
import { getPlaceDetails, predictPlaces, type PlacePrediction } from "@/src/api/places";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { DateField, localDate } from "@/src/components/ui/DateField";
import { RadioChoice } from "@/src/components/ui/RadioChoice";
import { Input } from "@/src/components/ui/Input";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { layout, spacing } from "@/src/theme/tokens";

const GRADES = ["M10","M15","M20","M25","M30","M35","M40","M45","M50","M55","M60"];
type CreatedLead = { id: string; status: string; message?: string; canonical_request_id?: string };
type ReviewRequest = {
  id: string; quotation_plant_id?: string; plant_name?: string; grade: string; quantity_m3: number;
  site_address: string; delivery_lat?: number; delivery_lng?: number; delivery_date: string; pump_required: boolean;
};
type RequestParams = { reviewId?: string; siteId?: string; grade?: string; quantity?: string; pumpRequired?: string; googlePlaceId?: string; plantId?: string; plantName?: string; orderReview?: string; visit?: string };
type FieldName = "customerName" | "email" | "gstin" | "quantity" | "address" | "date" | "phone" | "consent";
type FieldErrors = Partial<Record<FieldName, string>>;
const uuid = () => {
  const raw = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  raw[12] = "4"; raw[16] = ((parseInt(raw[16],16) & 3) | 8).toString(16);
  return [raw.slice(0,8),raw.slice(8,12),raw.slice(12,16),raw.slice(16,20),raw.slice(20)].map(a=>a.join("")).join("-");
};

export default function RequestQuotation() {
  const params = useLocalSearchParams<RequestParams>();
  const { user } = useAuth();
  const router = useRouter();
  const review = useGet<{ requests: ReviewRequest[] }>(params.reviewId
    ? `/customer/plant-order-requests?id=${encodeURIComponent(params.reviewId)}` : null);
  const sites = useGet<{ sites: { id: string; address: string; lat?: number; lng?: number }[] }>(params.siteId ? "/master/customer/sites" : null);
  const request = review.data?.requests[0];
  const site = sites.data?.sites.find(entry => entry.id === params.siteId);
  const formKey = JSON.stringify([user?.id, params.plantId, params.googlePlaceId, params.orderReview, params.visit, params.reviewId, params.siteId]);
  if (params.reviewId && !request?.quotation_plant_id) {
    return <View style={{ padding: spacing.lg }}><AppText>
      {review.loading ? "Loading order request…" : review.error ?? "This order request is unavailable for quotation."}
    </AppText>
      {review.error ? <Button label="Retry" onPress={review.reload} /> : null}
      <Button label="My Orders" variant="outline" onPress={() => router.replace("/customer/orders")} />
    </View>;
  }
  if (params.siteId && sites.loading && !sites.data) return <AppText>Loading saved site…</AppText>;
  const effectiveParams = request ? { ...params, plantId: request.quotation_plant_id, plantName: request.plant_name } : params;
  const address = request?.site_address ?? site?.address ?? "";
  const lat = request?.delivery_lat ?? site?.lat;
  const lng = request?.delivery_lng ?? site?.lng;
  return <SupplierRequestForm key={formKey} params={effectiveParams} request={request} address={address}
    coords={lat != null && lng != null ? { lat, lng } : null} />;
}

function SupplierRequestForm({ params, request, address, coords }: {
  params: RequestParams; request?: ReviewRequest; address: string; coords: { lat: number; lng: number } | null;
}) {
  const router = useRouter();
  const { token, user } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reviewOrder = !request && params.orderReview === "1";
  const requestLabel = reviewOrder ? "Order Request" : "Quotation Request";
  const [requestKey] = useState(() => request?.id ?? uuid());
  const [customerName, setCustomerName] = useState(user?.verified_name || user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [gstin, setGstin] = useState("");
  const [grade, setGrade] = useState(request?.grade || (GRADES.includes(params.grade ?? "") ? params.grade! : "M25"));
  const [quantity, setQuantity] = useState(request ? String(request.quantity_m3) : params.quantity ?? "");
  const [siteAddress, setSiteAddress] = useState(address);
  const [siteCoords, setSiteCoords] = useState(coords);
  const [deliveryDate, setDeliveryDate] = useState(request && request.delivery_date >= localDate() ? request.delivery_date : localDate());
  const [sitePhone, setSitePhone] = useState(user?.phone || "");
  const [pump, setPump] = useState(request?.pump_required ?? (params.pumpRequired === "1"));
  const [shareConsent, setShareConsent] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<PlacePrediction[]>([]);
  const [locationBusy, setLocationBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const addressSelection = useRef<AbortController | null>(null);
  const fields = useRef<Partial<Record<FieldName, TextInput | null>>>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreatedLead | null>(null);

  useEffect(() => {
    if (!token || siteCoords || siteAddress.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void predictPlaces(siteAddress.trim(), token, controller.signal)
        .then(items => { if (!controller.signal.aborted) setSuggestions(items); })
        .catch(() => { if (!controller.signal.aborted) setSuggestions([]); });
    }, 350);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [siteAddress, siteCoords, token]);

  useEffect(() => () => addressSelection.current?.abort(), [token]);

  function updateField<T>(name: FieldName, setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setFieldErrors(old => old[name] ? { ...old, [name]: undefined } : old);
    };
  }

  function changeAddress(text: string) {
    addressSelection.current?.abort();
    setLocationBusy(false);
    setSuggestions([]);
    setSiteCoords(null);
    updateField("address", setSiteAddress)(text);
  }

  const choosePlace = async (place: PlacePrediction) => {
    if (!token) return;
    addressSelection.current?.abort();
    const controller = new AbortController();
    addressSelection.current = controller;
    setLocationBusy(true);
    setError("");
    try {
      const info = await getPlaceDetails(place.place_id, token, controller.signal);
      if (controller.signal.aborted) return;
      updateField("address", setSiteAddress)(info.address);
      setSiteCoords({ lat: info.lat, lng: info.lng });
      setSuggestions([]);
    } catch (e: unknown) {
      if (!controller.signal.aborted) setError(apiErrorDetail(e, "Could not retrieve map location. Enter the address manually."));
    } finally {
      if (!controller.signal.aborted) setLocationBusy(false);
    }
  };

  const submit = async () => {
    if (!token || inFlight.current || result) return;
    if (Boolean(params.googlePlaceId) === Boolean(params.plantId)) {
      setError("Choose a supplier from Nearby Plants first.");
      return;
    }
    const invalid: FieldErrors = {};
    if (customerName.trim().length < 2) invalid.customerName = "Enter your name.";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) invalid.email = "Enter a valid email address.";
    if (gstin.trim() && !/^[A-Z0-9]{15}$/.test(gstin.trim().toUpperCase())) invalid.gstin = "GSTIN must have 15 letters or digits.";
    if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0 || Number(quantity) > 10000) invalid.quantity = "Enter a quantity greater than 0 and up to 10,000 m³.";
    if (siteAddress.trim().length < 5) invalid.address = "Enter the full delivery address.";
    if (deliveryDate < localDate()) invalid.date = "Select today or a future date.";
    if (!/^\+?[0-9]{10,15}$/.test(sitePhone.trim())) invalid.phone = "Enter a valid site contact number.";
    if (!reviewOrder && !shareConsent) invalid.consent = "Confirm supplier-sharing permission to continue.";
    setFieldErrors(invalid);
    const first = (Object.keys(invalid) as FieldName[])[0];
    if (first) {
      setError("");
      fields.current[first]?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const created = await apiPost<CreatedLead>(reviewOrder ? "/customer/plant-order-requests" : "/customer/rmc-rfq-leads", token, {
        request_key: requestKey,
        google_place_id: params.googlePlaceId || null,
        plant_id: params.plantId || null,
        customer_name: customerName.trim(),
        customer_email: email.trim() || null,
        customer_gstin: gstin.trim().toUpperCase() || null,
        grade, quantity_m3: Number(quantity), site_address: siteAddress.trim(),
        site_lat: siteCoords?.lat ?? null, site_lng: siteCoords?.lng ?? null,
        delivery_date: deliveryDate, pump_required: pump,
        site_contact_phone: sitePhone.trim(),
        ...(!reviewOrder && { share_with_supplier: shareConsent }),
      });
      setResult(created);
    } catch (e: unknown) {
      setError(apiErrorDetail(e, `Unable to submit ${requestLabel.toLowerCase()}.`));
    } finally { inFlight.current = false; setBusy(false); }
  };

  return (
    <View style={{flex:1,backgroundColor:colors.surface}}>
      <View style={{height:insets.top}}/>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:spacing.lg,paddingBottom:spacing.xl,gap:spacing.md,width:"100%",maxWidth:layout.contentMax,alignSelf:"center"}}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to plants" onPress={() => router.canGoBack() ? router.back() : router.replace("/customer/plants")} style={{flexDirection:"row",alignItems:"center",gap:8,paddingVertical:8}}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface}/>
          <AppText variant="heading">{reviewOrder ? "Place Order" : "Request RMC Quotation"}</AppText>
        </Pressable>
        {result ? (
          <Card style={{gap:spacing.md}}>
            <Ionicons name="checkmark-circle" size={45} color={colors.success}/>
            <AppText variant="heading">{reviewOrder ? "Order request sent" : "Enquiry recorded"}</AppText>
            <AppText>Reference: {result.id}</AppText>
            {reviewOrder ? <>
              <AppText>TrackMyRMC received your request. Your delivery is pending review and confirmation.</AppText>
              <Button label="View My Orders" onPress={() => router.replace("/customer/orders")} />
              <Button label="Back to Plants" variant="outline" onPress={() => router.replace("/customer/plants")} />
            </> : <>
              <AppText>{result.status === "PENDING_SUPPLIER"
                ? "This supplier has not joined TrackMyRMC. Our team can assist with your enquiry. No supplier notification has been sent."
                : "Your request is available to the approved plant in TrackMyRMC."}</AppText>
              {result.status === "PENDING_SUPPLIER" ? <Button label="Share Plant Onboarding Invitation" variant="outline"
                onPress={()=>void Share.share({
                  message:"TrackMyRMC connects customers with verified Ready-Mix Concrete suppliers. Register your RMC plant to receive and manage quotation requests: https://trackmyrmc.com/plant-onboarding"
                }).catch(()=>setError("Sharing is not available on this device."))}/> : null}
              <AppText variant="caption">The invitation contains no customer name, contact, GSTIN or site address.</AppText>
              <Button label="Back to Plants" onPress={()=>router.replace("/customer/plants")}/>
            </>}
          </Card>
        ) : (
          <Card style={{gap:spacing.md}}>
            <AppText variant="caption">Selected supplier: {params.plantName || "From Nearby Plants"}</AppText>
            {reviewOrder ? <AppText>TrackMyRMC will review your request and contact you about availability and delivery.</AppText> : null}
            <Input label="Customer Name" required value={customerName} onChangeText={updateField("customerName", setCustomerName)}
              maxLength={160} error={fieldErrors.customerName} ref={ref => { fields.current.customerName = ref; }} />
            <Input label="Email (optional)" value={email} onChangeText={updateField("email", setEmail)}
              keyboardType="email-address" maxLength={254} error={fieldErrors.email} ref={ref => { fields.current.email = ref; }} />
            <Input label="GSTIN (optional)" value={gstin} onChangeText={updateField("gstin", setGstin)}
              autoCapitalize="characters" maxLength={15} error={fieldErrors.gstin} ref={ref => { fields.current.gstin = ref; }} />
            <AppText variant="label">Required Concrete Grade *</AppText>
            <Button label={`Concrete grade: ${grade}`} variant="outline" onPress={() => setGradeOpen(open => !open)}
              expanded={gradeOpen} />
            {gradeOpen ? <View accessibilityRole="radiogroup" accessibilityLabel="Concrete grade" style={{ gap: spacing.xs }}>
              {GRADES.map(value => <RadioChoice key={value} label={value} checked={value === grade}
                onPress={() => { setGrade(value); setGradeOpen(false); }} />)}
            </View> : null}
            <Input label="Required Quantity (m³)" required value={quantity} onChangeText={updateField("quantity", setQuantity)}
              keyboardType="decimal-pad" error={fieldErrors.quantity} ref={ref => { fields.current.quantity = ref; }} />
            <Input label="Delivery Site Address" required value={siteAddress} onChangeText={changeAddress}
              maxLength={500} placeholder="Search a delivery address" error={fieldErrors.address} ref={ref => { fields.current.address = ref; }} />
            {locationBusy ? <AppText variant="caption">Locating address…</AppText> : null}
            {suggestions.length ? <Card style={{gap:6}}>
              {suggestions.slice(0,5).map(p=><Pressable key={p.place_id} accessibilityRole="button" onPress={()=>void choosePlace(p)} style={{padding:8,minHeight:48,justifyContent:"center"}}>
                <AppText>{p.description}</AppText>
              </Pressable>)}
              <AppText variant="caption">Google Places suggestions</AppText>
            </Card>:null}
            {siteCoords ? <AppText variant="caption" color={colors.success}>Map location selected. Edit address if needed.</AppText> : null}
            <DateField label="Required delivery date" required date={deliveryDate} onChange={updateField("date", setDeliveryDate)}
              error={fieldErrors.date} calendarTestID="rfq-date-calendar" />
            <AppText variant="label">Concrete Pump Required *</AppText>
            <View accessibilityRole="radiogroup" accessibilityLabel="Concrete pump required" style={{ gap: spacing.xs }}>
              <RadioChoice label="No" checked={!pump} onPress={() => setPump(false)} />
              <RadioChoice label="Yes" checked={pump} onPress={() => setPump(true)} />
            </View>
            <Input label="Site Contact Number" required value={sitePhone} onChangeText={updateField("phone", setSitePhone)}
              keyboardType="phone-pad" maxLength={16} error={fieldErrors.phone} ref={ref => { fields.current.phone = ref; }} />
            {!reviewOrder ? <Pressable onPress={() => updateField("consent", setShareConsent)(!shareConsent)} accessibilityRole="checkbox" accessibilityState={{checked:shareConsent}}
              style={{flexDirection:"row",alignItems:"flex-start",gap:10,paddingVertical:8}}>
              <Ionicons name={shareConsent?"checkbox":"square-outline"} size={24} color={colors.accentText}/>
              <AppText style={{flex:1}}>I agree that TrackMyRMC may share this enquiry and my contact details with the selected supplier after its verification, or use them for admin follow-up. This is not an order.</AppText>
            </Pressable> : null}
            {fieldErrors.consent ? <AppText accessibilityLiveRegion="polite" color={colors.error}>{fieldErrors.consent}</AppText> : null}
            {error ? <AppText accessibilityLiveRegion="polite" color={colors.error}>{error}</AppText> : null}
            <Button label={`Submit ${requestLabel}`} loading={busy} onPress={()=>void submit()} disabled={!token || locationBusy}/>
            {!reviewOrder ? <AppText variant="caption">For unregistered Google-listed businesses the enquiry reaches TrackMyRMC admin first. No WhatsApp message is sent to an unverified business.</AppText> : null}
          </Card>
        )}
      </ScrollView>

    </View>
  );
}
