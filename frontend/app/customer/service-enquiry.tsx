import React, { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { DateField } from "@/src/components/ui/DateField";
import { RadioChoice } from "@/src/components/ui/RadioChoice";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, spacing } from "@/src/theme/tokens";
import { Badge } from "@/src/components/ui/Badge";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";

type Service = "cement" | "labour" | "material" | "pump" | "bulk";
type FormKey =
  | "customer_name" | "contact_number" | "cement_brand" | "required_bags"
  | "location" | "required_date" | "work_name" | "duration_days"
  | "work_start_date" | "total_sq_ft" | "expected_price_per_sq_ft"
  | "material_type" | "contact_person_name" | "mobile_number" | "delivery_date"
  | "pump_type" | "estimated_hours" | "grade" | "quantity_m3";

const SAND_OPTIONS = ["Crushed Sand", "Gujrat Washed Sand"] as const;
const MATERIAL_CATEGORIES = {
  sand: { title: "Sand Enquiry", symbol: "stock-register", options: SAND_OPTIONS },
  bricks: { title: "Bricks Enquiry", symbol: "building-material", options: ["Bricks"] },
  steel: { title: "Steel Enquiry", symbol: "material-receipts", options: ["Steel"] },
  "office-cabin": { title: "Office Cabin Enquiry", symbol: "store-dashboard", options: ["Office Cabin"] },
  shuttering: { title: "Shuttering Material Enquiry", symbol: "material-inventory", options: ["Shuttering Material"] },
} as const;
const MATERIALS = ["10 MM", "20 MM", "40 MM", ...SAND_OPTIONS, "Cement Bag",
  ...Object.entries(MATERIAL_CATEGORIES).flatMap(([key, category]) => key === "sand" ? [] : [...category.options])] as const;
const GRADES = ["M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60"] as const;
const TITLES: Record<Service, string> = {
  cement: "Cement Enquiry",
  labour: "Labour Contractor Enquiry",
  material: "Building Material Enquiry",
  pump: "Concrete Pump Rental Enquiry",
  bulk: "Bulk Concrete Enquiry",
};
const TYPES: Record<Service, string> = {
  cement: "CEMENT", labour: "LABOUR_CONTRACTOR", material: "BUILDING_MATERIAL", pump: "PUMP_RENTAL", bulk: "BULK_CONCRETE",
};
const ENQUIRY_SYMBOLS: Record<Service, VectorSymbolName> = {
  cement: "cement", labour: "labour-contractor", material: "building-material", pump: "pump-rental", bulk: "quotation-requests",
};
type Enquiry = { id: string; service_type: string; status: string; required_date: string; details?: { material_type?: string } };
type EnquiryResponse = { enquiries: Enquiry[] };

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00");
  const today = new Date();
  const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return !Number.isNaN(date.getTime()) && date.getFullYear() === Number(value.slice(0, 4))
    && date.getMonth() + 1 === Number(value.slice(5, 7))
    && date.getDate() === Number(value.slice(8, 10)) && value >= isoToday;
}
function validPhone(value: string): boolean {
  return /^\+?[0-9]{10,15}$/.test(value.trim());
}

export default function ServiceEnquiryScreen() {
  const { service, material } = useLocalSearchParams<{ service?: string; material?: string }>();
  const selected: Service = service === "labour" || service === "material" || service === "pump" || service === "bulk"
    ? service : "cement";
  const categoryKey = selected === "material" ? (Object.keys(MATERIAL_CATEGORIES) as (keyof typeof MATERIAL_CATEGORIES)[])
    .find(key => key === material) : undefined;
  return <EnquiryForm key={selected + ":" + (categoryKey ?? "")} selected={selected} categoryKey={categoryKey} />;
}

function EnquiryForm({ selected, categoryKey }: { selected: Service; categoryKey?: keyof typeof MATERIAL_CATEGORIES }) {
  const category = categoryKey ? MATERIAL_CATEGORIES[categoryKey] : undefined;
  const materialOptions: readonly string[] = category?.options ?? MATERIALS;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const [fields, setFields] = useState<Record<FormKey, string>>({
    customer_name: user?.name || "", contact_number: user?.phone || "",
    cement_brand: "", required_bags: "", location: "", required_date: "",
    work_name: "", duration_days: "", work_start_date: "", total_sq_ft: "",
    expected_price_per_sq_ft: "", material_type: materialOptions.length === 1 ? materialOptions[0] : "",
    contact_person_name: user?.name || "", mobile_number: user?.phone || "", delivery_date: "",
    pump_type: "", estimated_hours: "", grade: "", quantity_m3: "",
  });
  const [showChoices, setShowChoices] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const inputs = useRef<Partial<Record<FormKey, TextInput | null>>>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FormKey, string>>>({});
  const [successId, setSuccessId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const history = useGet<EnquiryResponse>("/customer/service-enquiries");
  const recent = (history.data?.enquiries ?? []).filter(item => {
    if (item.service_type !== TYPES[selected]) return false;
    return !category || !!item.details?.material_type && materialOptions.includes(item.details.material_type);
  }).slice(0, 5);

  const set = (key: FormKey) => (value: string) => {
    setFields(previous => ({ ...previous, [key]: value }));
    setMessage(null);
    setFieldErrors(old => old[key] ? { ...old, [key]: undefined } : old);
  };
  const field = (key: FormKey, label: string, extra?: { keyboardType?: "numeric" | "decimal-pad" | "phone-pad" | "default"; placeholder?: string }) => (
    <Input
      testID={`enquiry-${key}`}
      label={label}
      required
      error={fieldErrors[key]}
      ref={input => { inputs.current[key] = input; }}
      value={fields[key]}
      onChangeText={set(key)}
      keyboardType={extra?.keyboardType}
      placeholder={extra?.placeholder}
      maxLength={key === "location" ? 500 : 150}
    />
  );
  const date = (key: FormKey, label: string) => <DateField label={label} required date={fields[key]} error={fieldErrors[key]} onChange={set(key)} />;

  const choices = (key: "grade" | "material_type", label: string, options: readonly string[]) => (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="label">{label} *</AppText>
      {options.length === 1 ? <AppText>{options[0]}</AppText> : (
        <>
          <Button testID={key === "grade" ? "bulk-grade-dropdown" : "material-type-dropdown"}
            label={fields[key] || "Choose " + label.toLowerCase()} variant="outline" expanded={showChoices}
            onPress={() => setShowChoices(open => !open)} />
          {showChoices ? <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: spacing.xs }}>
            {options.map(option => <RadioChoice key={option} label={option} checked={fields[key] === option}
              onPress={() => { set(key)(option); setShowChoices(false); }} />)}
          </View> : null}
        </>
      )}
      {fieldErrors[key] ? <AppText accessibilityLiveRegion="polite" color={colors.error}>{fieldErrors[key]}</AppText> : null}
    </View>
  );

  const submit = async () => {
    if (!token || inFlight.current || successId) return;
    const invalid: Partial<Record<FormKey, string>> = {};
    let payload: Record<string, string | number>;
    const location = fields.location.trim();
    if (selected === "cement" || selected === "pump" || selected === "bulk") {
      if (fields.customer_name.trim().length < 2) invalid.customer_name = "Enter your name.";
      if (!validPhone(fields.contact_number)) invalid.contact_number = "Enter a valid contact number.";
    }
    if (selected === "cement") {
      const bags = Number(fields.required_bags);
      if (fields.cement_brand.trim().length < 2) invalid.cement_brand = "Enter a cement brand.";
      if (!Number.isInteger(bags) || bags < 1 || bags > 100000) invalid.required_bags = "Enter between 1 and 100,000 bags.";
      if (location.length < 3) invalid.location = "Enter a delivery address.";
      if (!validDate(fields.required_date)) invalid.required_date = "Choose today or a future date.";
      payload = {
        service_type: "CEMENT", customer_name: fields.customer_name.trim(),
        contact_number: fields.contact_number.trim(), cement_brand: fields.cement_brand.trim(),
        required_bags: bags, location, required_date: fields.required_date,
      };
    } else if (selected === "labour") {
      const days = Number(fields.duration_days);
      const area = Number(fields.total_sq_ft);
      const price = Number(fields.expected_price_per_sq_ft);
      if (fields.work_name.trim().length < 2) invalid.work_name = "Enter the work name.";
      if (location.length < 3) invalid.location = "Enter the work location.";
      if (!Number.isInteger(days) || days < 1 || days > 3650) invalid.duration_days = "Enter between 1 and 3,650 days.";
      if (!validDate(fields.work_start_date)) invalid.work_start_date = "Choose today or a future date.";
      if (!Number.isFinite(area) || area <= 0) invalid.total_sq_ft = "Enter an area greater than zero.";
      if (!Number.isFinite(price) || price <= 0) invalid.expected_price_per_sq_ft = "Enter a rate greater than zero.";
      payload = {
        service_type: "LABOUR_CONTRACTOR", work_name: fields.work_name.trim(), location,
        duration_days: days, work_start_date: fields.work_start_date,
        total_sq_ft: area, expected_price_per_sq_ft: price,
      };
    } else if (selected === "pump") {
      const hours = Number(fields.estimated_hours);
      if (location.length < 3) invalid.location = "Enter the pump rental site address.";
      if (fields.pump_type.trim().length < 2) invalid.pump_type = "Enter the pump type.";
      if (!Number.isFinite(hours) || hours <= 0 || hours > 72) invalid.estimated_hours = "Enter rental hours greater than 0 and up to 72.";
      if (!validDate(fields.required_date)) invalid.required_date = "Choose today or a future date.";
      payload = {
        service_type: "PUMP_RENTAL", customer_name: fields.customer_name.trim(),
        contact_number: fields.contact_number.trim(), location, required_date: fields.required_date,
        pump_type: fields.pump_type.trim(), estimated_hours: hours,
      };
    } else if (selected === "bulk") {
      const quantity = Number(fields.quantity_m3.trim());
      if (!GRADES.some(grade => grade === fields.grade)) invalid.grade = "Choose a concrete grade.";
      if (!/^\d+(\.\d{1,2})?$/.test(fields.quantity_m3.trim()) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) {
        invalid.quantity_m3 = "Enter 0.01–10,000 m³ with up to two decimal places.";
      }
      if (location.length < 3) invalid.location = "Enter a delivery address.";
      if (!validDate(fields.required_date)) invalid.required_date = "Choose today or a future date.";
      payload = {
        service_type: "BULK_CONCRETE", customer_name: fields.customer_name.trim(), contact_number: fields.contact_number.trim(),
        location, required_date: fields.required_date, grade: fields.grade, quantity_m3: quantity,
      };
    } else {
      if (!materialOptions.includes(fields.material_type)) invalid.material_type = "Choose a material.";
      if (location.length < 3) invalid.location = "Enter a delivery address.";
      if (fields.contact_person_name.trim().length < 2) invalid.contact_person_name = "Enter the contact name.";
      if (!validPhone(fields.mobile_number)) invalid.mobile_number = "Enter a valid mobile number.";
      if (!validDate(fields.delivery_date)) invalid.delivery_date = "Choose today or a future date.";
      payload = {
        service_type: "BUILDING_MATERIAL", material_type: fields.material_type,
        contact_person_name: fields.contact_person_name.trim(),
        mobile_number: fields.mobile_number.trim(), location, delivery_date: fields.delivery_date,
      };
    }
    setFieldErrors(invalid);
    const first = (Object.keys(invalid) as FormKey[])[0];
    if (first) {
      setMessage(null);
      inputs.current[first]?.focus();
      return;
    }
    inFlight.current = true;
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
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace("/customer")} style={styles.back}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <VectorSymbol name={category?.symbol ?? ENQUIRY_SYMBOLS[selected]} size={24} />
        <View style={{ flex: 1 }}>
          <AppText style={[styles.heading, { color: colors.onSurface }]}>{category?.title ?? TITLES[selected]}</AppText>
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
            ) : selected === "pump" ? (
              <>
                {field("customer_name", "Customer Name")}
                {field("contact_number", "Contact Number", { keyboardType: "phone-pad" })}
                {field("location", "Pump Rental Site Address")}
                {field("pump_type", "Pump Type (boom / line / other)")}
                {field("estimated_hours", "Estimated Rental Hours", { keyboardType: "numeric" })}
                {date("required_date", "Required Date")}
                <AppText variant="caption">Availability and quotation require manual supplier confirmation. This is not a confirmed booking.</AppText>
              </>
            ) : selected === "bulk" ? (
              <>
                {field("customer_name", "Customer Name")}
                {field("contact_number", "Contact Number", { keyboardType: "phone-pad" })}
                {choices("grade", "Concrete grade", GRADES)}
                {field("quantity_m3", "Required Quantity (m³)", { keyboardType: "decimal-pad" })}
                {field("location", "Delivery Address")}
                {date("required_date", "Required Date")}
              </>
            ) : (
              <>
                {choices("material_type", "Material type", materialOptions)}
                {field("location", "Location / Delivery Address")}
                {field("contact_person_name", "Contact Person Name")}
                {field("mobile_number", "Mobile Number", { keyboardType: "phone-pad" })}
                {date("delivery_date", "Delivery Date")}
              </>
            )}
            <AppText variant="caption">Submitting this enquiry does not confirm a booking.</AppText>
            {message ? <AppText accessibilityLiveRegion="polite" color={colors.error} testID="service-enquiry-error">{message}</AppText> : null}
            <Button label="Submit Enquiry" loading={submitting} disabled={!token} onPress={() => void submit()} testID="submit-service-enquiry" />
          </Card>
        )}

        <Card style={{ gap: spacing.sm }}>
          <AppText variant="heading">My Recent Enquiries</AppText>
          {recent.map(item => (
            <View key={item.id} style={[styles.historyRow, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontFamily: fonts.semibold }}>{item.details?.material_type ?? TITLES[selected]}</AppText>
                <AppText variant="caption">Requested: {item.required_date}</AppText>
              </View>
              <Badge label={item.status} status={item.status} size="sm" />
            </View>
          ))}
          {history.data && !recent.length ? <AppText variant="caption">No previous enquiries for this service.</AppText> : null}
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
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md, width: "100%", maxWidth: 680, alignSelf: "center" },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1 },
});
