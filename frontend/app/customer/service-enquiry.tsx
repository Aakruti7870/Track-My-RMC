import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, spacing } from "@/src/theme/tokens";

type Service = "cement" | "labour" | "material";
type FormKey =
  | "customer_name" | "contact_number" | "cement_brand" | "required_bags"
  | "location" | "required_date" | "work_name" | "duration_days"
  | "work_start_date" | "total_sq_ft" | "expected_price_per_sq_ft"
  | "material_type" | "contact_person_name" | "mobile_number" | "delivery_date";

const MATERIALS = ["10 MM", "20 MM", "40 MM", "Crushed Sand", "Gujrat Washed Sand", "Cement Bag"] as const;
const TITLES: Record<Service, string> = {
  cement: "Cement Enquiry",
  labour: "Labour Contractor Enquiry",
  material: "Building Material Enquiry",
};
const TYPES: Record<Service, string> = {
  cement: "CEMENT", labour: "LABOUR_CONTRACTOR", material: "BUILDING_MATERIAL",
};
type Enquiry = { id: string; service_type: string; status: string; created_at: string; required_date: string };
type EnquiryResponse = { enquiries: Enquiry[] };

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value >= new Date().toLocaleDateString("en-CA");
}
function validPhone(value: string): boolean {
  return /^\+?[0-9]{10,15}$/.test(value.trim());
}

export default function ServiceEnquiryScreen() {
  const { service } = useLocalSearchParams<{ service?: string }>();
  const selected: Service = service === "labour" || service === "material" ? service : "cement";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const [fields, setFields] = useState<Record<FormKey, string>>({
    customer_name: user?.name || "", contact_number: user?.phone || "",
    cement_brand: "", required_bags: "", location: "", required_date: "",
    work_name: "", duration_days: "", work_start_date: "", total_sq_ft: "",
    expected_price_per_sq_ft: "", material_type: "", contact_person_name: user?.name || "",
    mobile_number: user?.phone || "", delivery_date: "",
  });
  const [showMaterials, setShowMaterials] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const history = useGet<EnquiryResponse>("/customer/service-enquiries");

  const set = (key: FormKey) => (value: string) => {
    setFields(previous => ({ ...previous, [key]: value }));
    setMessage(null);
  };
  const field = (key: FormKey, label: string, extra?: { keyboardType?: "numeric" | "phone-pad" | "default"; placeholder?: string }) => (
    <Input
      testID={`enquiry-${key}`}
      label={label}
      value={fields[key]}
      onChangeText={set(key)}
      keyboardType={extra?.keyboardType}
      placeholder={extra?.placeholder}
      maxLength={key === "location" ? 500 : 150}
    />
  );
  const date = (key: FormKey, label: string) => field(key, label, { placeholder: "YYYY-MM-DD" });

  const submit = async () => {
    if (!token || submitting) return;
    let payload: Record<string, string | number>;
    const location = fields.location.trim();
    if (location.length < 3) { setMessage("Enter a valid delivery or work location."); return; }
    if (selected === "cement") {
      const bags = Number(fields.required_bags);
      if (fields.customer_name.trim().length < 2 || !validPhone(fields.contact_number) ||
          fields.cement_brand.trim().length < 2 || !Number.isInteger(bags) || bags < 1 || bags > 100000 ||
          !validDate(fields.required_date)) {
        setMessage("Complete the name, contact, brand, bag quantity and valid future date."); return;
      }
      payload = {
        service_type: "CEMENT", customer_name: fields.customer_name.trim(),
        contact_number: fields.contact_number.trim(), cement_brand: fields.cement_brand.trim(),
        required_bags: bags, location, required_date: fields.required_date,
      };
    } else if (selected === "labour") {
      const days = Number(fields.duration_days);
      const area = Number(fields.total_sq_ft);
      const price = Number(fields.expected_price_per_sq_ft);
      if (fields.work_name.trim().length < 2 || !Number.isInteger(days) || days < 1 || days > 3650 ||
          !(area > 0) || !Number.isFinite(area) || !(price > 0) || !Number.isFinite(price) ||
          !validDate(fields.work_start_date)) {
        setMessage("Enter work details, duration in days, square footage, expected rate and start date."); return;
      }
      payload = {
        service_type: "LABOUR_CONTRACTOR", work_name: fields.work_name.trim(), location,
        duration_days: days, work_start_date: fields.work_start_date,
        total_sq_ft: area, expected_price_per_sq_ft: price,
      };
    } else {
      if (!MATERIALS.some(item => item === fields.material_type) ||
          fields.contact_person_name.trim().length < 2 ||
          !validPhone(fields.mobile_number) || !validDate(fields.delivery_date)) {
        setMessage("Choose a material and enter contact details and a valid delivery date."); return;
      }
      payload = {
        service_type: "BUILDING_MATERIAL", material_type: fields.material_type,
        contact_person_name: fields.contact_person_name.trim(),
        mobile_number: fields.mobile_number.trim(), location, delivery_date: fields.delivery_date,
      };
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await apiPost<{ id: string; status: string }>("/customer/service-enquiries", token, payload);
      setSuccessId(result.id);
      await history.refetch();
      toast("Enquiry submitted successfully", "success");
    } catch (error: unknown) {
      setMessage(apiErrorDetail(error, "Unable to submit enquiry. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText style={[styles.heading, { color: colors.onSurface }]}>{TITLES[selected]}</AppText>
          <AppText variant="caption">Request a call or quotation. No payment required.</AppText>
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {successId ? (
          <Card style={{ gap: spacing.md }}>
            <Ionicons name="checkmark-circle" size={46} color={colors.verified} />
            <AppText variant="heading">Enquiry received</AppText>
            <AppText>Your request has been saved with status NEW. Our team can review it and contact you.</AppText>
            <AppText variant="caption">Reference: {successId}</AppText>
            <Button label="Back to Home" onPress={() => router.replace("/customer")} />
          </Card>
        ) : (
          <Card style={{ gap: spacing.md }} testID="service-enquiry-form">
            <AppText variant="heading">{TITLES[selected]}</AppText>
            {selected === "cement" ? (
              <>
                {field("customer_name", "Customer Name")}
                {field("contact_number", "Contact Number", { keyboardType: "phone-pad" })}
                {field("cement_brand", "Cement Brand")}
                {field("required_bags", "Required Bags", { keyboardType: "numeric" })}
                {field("location", "Location / Delivery Address")}
                {date("required_date", "Required Date")}
              </>
            ) : selected === "labour" ? (
              <>
                {field("work_name", "Work Name")}
                {field("location", "Work Location")}
                {field("duration_days", "Duration (days)", { keyboardType: "numeric" })}
                {date("work_start_date", "Work Start Date")}
                {field("total_sq_ft", "Total Sq Ft", { keyboardType: "numeric" })}
                {field("expected_price_per_sq_ft", "Expected Price Per Sq Ft (₹)", { keyboardType: "numeric" })}
                <AppText variant="caption">Your account name and contact number will be included with the enquiry.</AppText>
              </>
            ) : (
              <>
                <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>Material Type</AppText>
                <Pressable
                  testID="material-type-dropdown"
                  accessibilityRole="button"
                  accessibilityLabel="Select Material Type"
                  accessibilityState={{ expanded: showMaterials }}
                  onPress={() => setShowMaterials(open => !open)}
                  style={[styles.dropdown, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
                >
                  <AppText style={{ flex: 1 }}>{fields.material_type || "Select Material"}</AppText>
                  <Ionicons name={showMaterials ? "chevron-up" : "chevron-down"} size={20} color={colors.onSurfaceSecondary} />
                </Pressable>
                {showMaterials ? MATERIALS.map(item => (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    onPress={() => { set("material_type")(item); setShowMaterials(false); }}
                    style={[styles.materialOption, { borderBottomColor: colors.border }]}
                  >
                    <AppText>{item}</AppText>
                  </Pressable>
                )) : null}
                {field("location", "Location / Delivery Address")}
                {field("contact_person_name", "Contact Person Name")}
                {field("mobile_number", "Mobile Number", { keyboardType: "phone-pad" })}
                {date("delivery_date", "Delivery Date")}
              </>
            )}
            <AppText variant="caption">Dates use YYYY-MM-DD (example: 2026-11-05). Submission is an enquiry, not a confirmed order.</AppText>
            {message ? <AppText style={{ color: colors.error }} testID="service-enquiry-error">{message}</AppText> : null}
            <Button label="Submit Enquiry" loading={submitting} disabled={!token} onPress={() => void submit()} testID="submit-service-enquiry" />
          </Card>
        )}

        <Card style={{ gap: spacing.sm }}>
          <AppText variant="heading">My Recent Enquiries</AppText>
          {history.data?.enquiries.filter(item => item.service_type === TYPES[selected]).slice(0, 5).map(item => (
            <View key={item.id} style={[styles.historyRow, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontFamily: fonts.semibold }}>{item.service_type.replace(/_/g, " ")}</AppText>
                <AppText variant="caption">Requested: {item.required_date}</AppText>
              </View>
              <AppText style={{ color: colors.brand, fontFamily: fonts.semibold }}>{item.status}</AppText>
            </View>
          ))}
          {history.data && !history.data.enquiries.some(item => item.service_type === TYPES[selected]) ? <AppText variant="caption">No previous enquiries for this service.</AppText> : null}
          {history.error ? <AppText style={{ color: colors.error }}>Could not load enquiry history.</AppText> : null}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
  back: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" },
  heading: { fontFamily: fonts.displayBold, fontSize: 20 },
  content: { padding: spacing.md, paddingBottom: 150, gap: spacing.md, width: "100%", maxWidth: 680, alignSelf: "center" },
  dropdown: { minHeight: 50, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center" },
  materialOption: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1 },
});
