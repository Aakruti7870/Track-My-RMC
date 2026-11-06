import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Share, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiGet, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useTheme } from "@/src/theme/ThemeProvider";
import { spacing } from "@/src/theme/tokens";

const GRADES = ["M10","M15","M20","M25","M30","M35","M40","M45","M50","M55","M60"];
type Place = { place_id: string; description: string };
type PlaceSuggestions = { predictions: Place[] };
type Location = { place_id: string; address: string; lat: number; lng: number };
type CreatedLead = { id: string; status: string; message?: string; canonical_request_id?: string };
const isoDate = (d: Date) => [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
const uuid = () => {
  const raw = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  raw[12] = "4"; raw[16] = ((parseInt(raw[16],16) & 3) | 8).toString(16);
  return [raw.slice(0,8),raw.slice(8,12),raw.slice(12,16),raw.slice(16,20),raw.slice(20)].map(a=>a.join("")).join("-");
};

export default function RequestQuotation() {
  const router = useRouter();
  const { token, user } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ googlePlaceId?: string; plantId?: string; plantName?: string }>();
  const [requestKey] = useState(uuid);
  const [customerName, setCustomerName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [gstin, setGstin] = useState("");
  const [grade, setGrade] = useState("M25");
  const [quantity, setQuantity] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [siteCoords, setSiteCoords] = useState<{lat: number; lng: number} | null>(null);
  const [deliveryDate, setDeliveryDate] = useState(isoDate(new Date()));
  const [sitePhone, setSitePhone] = useState(user?.phone || "");
  const [pump, setPump] = useState(false);
  const [shareConsent, setShareConsent] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [locationBusy, setLocationBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreatedLead | null>(null);

  useEffect(() => {
    if (!token || siteCoords || siteAddress.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      apiGet<PlaceSuggestions>("/maps/autocomplete?input=" + encodeURIComponent(siteAddress.trim()), token)
        .then(data => { if (alive) setSuggestions(data.predictions || []); })
        .catch(() => { if (alive) setSuggestions([]); });
    }, 450);
    return () => { alive = false; clearTimeout(timer); };
  }, [siteAddress, siteCoords, token]);

  const choosePlace = async (place: Place) => {
    if (!token) return;
    setLocationBusy(true); setError("");
    try {
      const info = await apiGet<Location>("/maps/place/" + encodeURIComponent(place.place_id), token);
      setSiteAddress(info.address || place.description);
      setSiteCoords({ lat: info.lat, lng: info.lng });
      setSuggestions([]);
    } catch (e: unknown) {
      setError(apiErrorDetail(e, "Could not retrieve map location. Enter the address manually."));
    } finally { setLocationBusy(false); }
  };

  const submit = async () => {
    if (!token || busy || result) return;
    if ((!params.googlePlaceId && !params.plantId) || (params.googlePlaceId && params.plantId)) {
      setError("Choose a supplier from Nearby Plants first."); return;
    }
    if (customerName.trim().length < 2 || siteAddress.trim().length < 5
        || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0 || Number(quantity) > 10000
        || !/^\+?[0-9]{10,15}$/.test(sitePhone.trim())) {
      setError("Enter customer name, quantity, full site address and valid site phone."); return;
    }
    if (deliveryDate < isoDate(new Date())) { setError("Select today or a future delivery date."); return; }
    if (gstin.trim() && !/^[A-Z0-9]{15}$/.test(gstin.trim().toUpperCase())) {
      setError("GSTIN must have 15 letters or digits."); return;
    }
    if (!shareConsent) { setError("Confirm supplier-sharing permission to continue."); return; }
    setBusy(true); setError("");
    try {
      const created = await apiPost<CreatedLead>("/customer/rmc-rfq-leads", token, {
        request_key: requestKey,
        google_place_id: params.googlePlaceId || null,
        plant_id: params.plantId || null,
        customer_name: customerName.trim(),
        customer_email: email.trim() || null,
        customer_gstin: gstin.trim().toUpperCase() || null,
        grade, quantity_m3: Number(quantity), site_address: siteAddress.trim(),
        site_lat: siteCoords?.lat ?? null, site_lng: siteCoords?.lng ?? null,
        delivery_date: deliveryDate, pump_required: pump,
        site_contact_phone: sitePhone.trim(), share_with_supplier: shareConsent,
      });
      setResult(created);
    } catch (e: unknown) {
      setError(apiErrorDetail(e, "Unable to submit quotation request."));
    } finally { setBusy(false); }
  };

  const days = Array.from({length: new Date(calendarMonth.getFullYear(), calendarMonth.getMonth()+1, 0).getDate()},(_,i)=>i+1);
  const blanks = Array.from({length: new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay()},(_,i)=>i);
  return (
    <View style={{flex:1,backgroundColor:colors.surface}}>
      <View style={{height:insets.top}}/>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:spacing.lg,paddingBottom:120,gap:spacing.md}}>
        <Pressable onPress={()=>router.back()} style={{flexDirection:"row",alignItems:"center",gap:8,paddingVertical:8}}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface}/>
          <AppText variant="heading">Request RMC Quotation</AppText>
        </Pressable>
        {result ? (
          <Card style={{gap:spacing.md}}>
            <Ionicons name="checkmark-circle" size={45} color={colors.success}/>
            <AppText variant="heading">Enquiry recorded</AppText>
            <AppText>Reference: {result.id}</AppText>
            <AppText>{result.status === "PENDING_SUPPLIER"
              ? "This supplier has not joined TrackMyRMC. Our team can assist with your enquiry. No supplier notification has been sent."
              : "Your request is available to the approved plant in TrackMyRMC."}</AppText>
            {result.status === "PENDING_SUPPLIER" ? <Button label="Share Plant Onboarding Invitation" variant="outline"
              onPress={()=>void Share.share({
                message:"TrackMyRMC connects customers with verified Ready-Mix Concrete suppliers. Register your RMC plant to receive and manage quotation requests: https://trackmyrmc.com/plant-onboarding"
              }).catch(()=>setError("Sharing is not available on this device."))}/> : null}
            <AppText variant="caption">The invitation contains no customer name, contact, GSTIN or site address.</AppText>
            <Button label="Back to Plants" onPress={()=>router.replace("/customer/plants")}/>
          </Card>
        ) : (
          <Card style={{gap:spacing.md}}>
            <AppText variant="caption">Selected supplier: {params.plantName || "From Nearby Plants"}</AppText>
            <Input label="Customer Name *" value={customerName} onChangeText={setCustomerName} maxLength={160}/>
            <Input label="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={254}/>
            <Input label="GSTIN (optional)" value={gstin} onChangeText={setGstin} autoCapitalize="characters" maxLength={15}/>
            <AppText>Required Concrete Grade *</AppText>
            <Pressable onPress={()=>setGradeOpen(v=>!v)} accessibilityRole="button"
              style={{borderWidth:1,borderColor:colors.border,borderRadius:12,padding:14,flexDirection:"row",justifyContent:"space-between"}}>
              <AppText>{grade}</AppText>
              <Ionicons name="chevron-down" size={18} color={colors.onSurface}/>
            </Pressable>
            {gradeOpen ? <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>
              {GRADES.map(g=><Pressable key={g} onPress={()=>{setGrade(g);setGradeOpen(false);}}
                style={{borderColor:colors.border,borderWidth:1,borderRadius:9,paddingHorizontal:13,paddingVertical:10,backgroundColor:g===grade?colors.brandSoft:colors.surfaceSecondary}}>
                <AppText>{g}</AppText>
              </Pressable>)}
            </View>:null}
            <Input label="Required Quantity (m³) *" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad"/>
            <Input label="Delivery Site Address *" value={siteAddress} onChangeText={v=>{setSiteAddress(v);setSiteCoords(null);}} maxLength={500} placeholder="Search a delivery address"/>
            {locationBusy ? <AppText variant="caption">Locating address…</AppText> : null}
            {suggestions.length ? <Card style={{gap:6}}>
              {suggestions.slice(0,5).map(p=><Pressable key={p.place_id} onPress={()=>void choosePlace(p)} style={{padding:8}}>
                <AppText>{p.description}</AppText>
              </Pressable>)}
              <AppText variant="caption">Google Places suggestions</AppText>
            </Card>:null}
            {siteCoords ? <AppText variant="caption" color={colors.success}>Map location selected. Edit address if needed.</AppText> : null}
            <AppText>Required Delivery Date *</AppText>
            <Pressable onPress={()=>setDateOpen(true)} accessibilityRole="button"
              style={{borderWidth:1,borderColor:colors.border,borderRadius:12,padding:14,flexDirection:"row",alignItems:"center",gap:10}}>
              <Ionicons name="calendar-outline" size={20} color={colors.onSurface}/>
              <AppText>{deliveryDate}</AppText>
            </Pressable>
            <AppText>Concrete Pump Required *</AppText>
            <View style={{flexDirection:"row",gap:10}}>
              {[false,true].map(value=><Pressable key={String(value)} onPress={()=>setPump(value)}
                style={{padding:12,paddingHorizontal:24,borderRadius:10,borderWidth:1,borderColor:colors.border,backgroundColor:pump===value?colors.brandSoft:colors.surfaceSecondary}}>
                <AppText>{value?"Yes":"No"}</AppText>
              </Pressable>)}
            </View>
            <Input label="Site Contact Number *" value={sitePhone} onChangeText={setSitePhone} keyboardType="phone-pad" maxLength={16}/>
            <Pressable onPress={()=>setShareConsent(v=>!v)} accessibilityRole="checkbox" accessibilityState={{checked:shareConsent}}
              style={{flexDirection:"row",alignItems:"flex-start",gap:10,paddingVertical:8}}>
              <Ionicons name={shareConsent?"checkbox":"square-outline"} size={24} color={colors.brand}/>
              <AppText style={{flex:1}}>I agree that TrackMyRMC may share this enquiry and my contact details with the selected supplier after its verification, or use them for admin follow-up. This is not an order.</AppText>
            </Pressable>
            {error ? <AppText color={colors.error}>{error}</AppText> : null}
            <Button label="Submit Quotation Request" loading={busy} onPress={()=>void submit()} disabled={!token}/>
            <AppText variant="caption">For unregistered Google-listed businesses the enquiry reaches TrackMyRMC admin first. No WhatsApp message is sent to an unverified business.</AppText>
          </Card>
        )}
      </ScrollView>
      <Modal visible={dateOpen} transparent animationType="slide" onRequestClose={()=>setDateOpen(false)}>
        <View style={{flex:1,backgroundColor:"rgba(0,0,0,0.55)",justifyContent:"center",padding:20}}>
          <View style={{backgroundColor:colors.surface,borderRadius:18,padding:20,gap:14}}>
            <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}>
              <Pressable onPress={()=>setCalendarMonth(d=>new Date(d.getFullYear(),d.getMonth()-1,1))}><Ionicons name="chevron-back" size={24} color={colors.onSurface}/></Pressable>
              <AppText variant="heading">{calendarMonth.toLocaleString("en-IN",{month:"long",year:"numeric"})}</AppText>
              <Pressable onPress={()=>setCalendarMonth(d=>new Date(d.getFullYear(),d.getMonth()+1,1))}><Ionicons name="chevron-forward" size={24} color={colors.onSurface}/></Pressable>
            </View>
            <View style={{flexDirection:"row",justifyContent:"space-around"}}>{["S","M","T","W","T","F","S"].map((w,i)=><AppText key={i}>{w}</AppText>)}</View>
            <View style={{flexDirection:"row",flexWrap:"wrap"}}>
              {blanks.map(i=><View key={"blank"+i} style={{width:"14.28%",height:44}}/>)}
              {days.map(day=>{
                const value=isoDate(new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),day));
                const disabled=value<isoDate(new Date());
                return <Pressable key={day} disabled={disabled} onPress={()=>{setDeliveryDate(value);setDateOpen(false);}}
                  style={{width:"14.28%",height:44,alignItems:"center",justifyContent:"center",backgroundColor:value===deliveryDate?colors.brandSoft:"transparent"}}>
                  <AppText color={disabled?colors.onSurfaceTertiary:colors.onSurface}>{day}</AppText>
                </Pressable>;
              })}
            </View>
            <Button label="Close Calendar" variant="outline" onPress={()=>setDateOpen(false)}/>
          </View>
        </View>
      </Modal>
    </View>
  );
}
