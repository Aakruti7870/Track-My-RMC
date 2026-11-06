import React, { useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { spacing } from "@/src/theme/tokens";

type RmcLead = {
  id: string; customer_name: string; customer_email?: string | null; customer_gstin?: string | null;
  grade: string; quantity_m3: number; site_address: string; delivery_date: string;
  site_contact_phone: string; pump_required: boolean; google_place_id?: string | null;
  plant_id?: string | null; canonical_request_id?: string | null;
  status: string; created_at: string; expires_at: string;
};
type Filter = "ALL" | "PENDING_SUPPLIER" | "MATCHED_RECONFIRMATION_REQUIRED" | "REQUESTED";
const FILTERS: Filter[] = ["ALL","PENDING_SUPPLIER","MATCHED_RECONFIRMATION_REQUIRED","REQUESTED"];

export default function AdminRmcRfqLeads() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch } = useGet<{ leads: RmcLead[] }>("/admin/rmc-rfq-leads");
  const [filter, setFilter] = useState<Filter>("PENDING_SUPPLIER");
  const rows = useMemo(
    () => (data?.leads || []).filter(l => filter === "ALL" || l.status === filter),
    [data,filter]
  );
  return (
    <View style={{flex:1,backgroundColor:colors.surface}}>
      <View style={{height:insets.top}}/>
      <ScrollView contentContainerStyle={{padding:spacing.lg,paddingBottom:120,gap:spacing.md}}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.brand}/>}>
        <View style={{flexDirection:"row",alignItems:"center",gap:10}}>
          <Ionicons name="document-text-outline" size={27} color={colors.brand}/>
          <AppText variant="title">RMC Lead Center</AppText>
        </View>
        <Card style={{gap:spacing.sm}}>
          <AppText variant="heading">Supplier onboarding enquiries</AppText>
          <AppText variant="caption">
            Admin-only customer requirements. Google Place ID is used for matching, not for scraping supplier phone numbers.
            Do not send WhatsApp invitations without independent consent.
          </AppText>
          <AppText variant="caption">Records shown: {data?.leads.length || 0} (latest 200)</AppText>
        </Card>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>
          {FILTERS.map(key=>(
            <View key={key} style={{padding:9,borderRadius:9,backgroundColor:key===filter?colors.brandSoft:colors.surfaceSecondary}}
              onTouchEnd={()=>setFilter(key)}>
              <AppText>{key.replace(/_/g," ")}</AppText>
            </View>
          ))}
        </ScrollView>
        {loading && !data ? <><Skeleton height={150}/><Skeleton height={150}/></>:null}
        {error ? <Card><AppText color={colors.error}>{error}</AppText></Card>:null}
        {rows.map(lead=>(
          <Card key={lead.id} style={{gap:spacing.sm}}>
            <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}}>
              <AppText variant="heading">{lead.customer_name}</AppText>
              <Badge label={lead.status.replace(/_/g," ")} color={colors.brand}/>
            </View>
            <AppText variant="caption">RFQ {lead.id}</AppText>
            <AppText>{lead.grade} · {lead.quantity_m3} m³ · {lead.pump_required?"Pump required":"Direct unloading"}</AppText>
            <AppText>Delivery date: {lead.delivery_date}</AppText>
            <AppText>Site: {lead.site_address}</AppText>
            <AppText>Site phone: {lead.site_contact_phone}</AppText>
            {lead.customer_email ? <AppText>Email: {lead.customer_email}</AppText>:null}
            {lead.customer_gstin ? <AppText>GSTIN: {lead.customer_gstin}</AppText>:null}
            <AppText variant="caption">
              {lead.canonical_request_id?"Official RFQ created":lead.google_place_id?"Google-listed supplier awaiting/undergoing verification":"Registered supplier"}
            </AppText>
            <AppText variant="caption">Created {new Date(lead.created_at).toLocaleString("en-IN")}</AppText>
          </Card>
        ))}
        {data && rows.length===0 ? <Card><AppText variant="caption">No enquiries in this filter.</AppText></Card>:null}
      </ScrollView>
    </View>
  );
}
