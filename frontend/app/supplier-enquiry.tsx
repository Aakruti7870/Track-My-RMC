import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiPost } from "@/src/api/client";
import { useAuth, type Me } from "@/src/auth/AuthContext";
import { ROLE_ROUTES } from "@/src/auth/roleRoutes";
import { IconTile } from "@/src/components/IconTile";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { DateField, localDate } from "@/src/components/ui/DateField";
import { Input } from "@/src/components/ui/Input";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { radius, spacing } from "@/src/theme/tokens";

const MATERIALS = ["OPC Cement", "PPC Cement", "Aggregate", "Crushed Sand", "Water Tank", "Chemical", "Fly Ash"] as const;
type Material = typeof MATERIALS[number];
type EnquiryReceipt = { id: string; status: string; plant_name?: string; materials?: string[]; required_date?: string };
type Plant = { id: string; name: string; city: string };

export default function SupplierEnquiry() {
  const { hydrating, token, user } = useAuth();
  if (hydrating) return null;
  if (!user || !token) return <Redirect href="/login" />;
  if (user.role === "customer" || !Object.prototype.hasOwnProperty.call(ROLE_ROUTES, user.role)) return <Redirect href="/" />;
  return <SupplierEnquiryForm key={user.id} user={user} token={token} />;
}

function SupplierEnquiryForm({ user, token }: { user: Me; token: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const plants = useGet<{ plants: Plant[] }>("/master/my-plants");
  const history = useGet<{ enquiries: EnquiryReceipt[] }>("/staff/supplier-enquiries");
  const [selectedPlant, setSelectedPlant] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [contactName, setContactName] = useState(user.name ?? "");
  const [contactPhone, setContactPhone] = useState(user.phone ?? user.mobile ?? "");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<EnquiryReceipt | null>(null);
  const sending = useRef(false);
  const request = useRef<{ payload: string; key: string } | null>(null);
  const options = plants.data?.plants ?? [];
  const plantId = options.length === 1 ? options[0].id : selectedPlant;

  async function submit() {
    if (sending.current || submitted) return;
    if (!options.some(plant => plant.id === plantId)) return setError("Choose your plant.");
    if (!materials.length) return setError("Select at least one material.");
    if (contactName.trim().length < 2) return setError("Enter the contact name.");
    if (!/^\+?[0-9]{10,15}$/.test(contactPhone.trim())) return setError("Enter a valid 10–15 digit contact number.");
    if (location.trim().length < 3) return setError("Enter the delivery location.");
    if (!date || date < localDate()) return setError("Choose today's date or a later date.");

    const payload = {
      plant_id: plantId, materials, contact_name: contactName.trim(),
      contact_phone: contactPhone.trim(), location: location.trim(), required_date: date,
    };
    const signature = JSON.stringify(payload);
    if (request.current?.payload !== signature) {
      request.current = { payload: signature, key: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    }
    sending.current = true;
    setBusy(true);
    setError("");
    setMaterialsOpen(false);
    try {
      const receipt = await apiPost<EnquiryReceipt>("/staff/supplier-enquiries", token, { ...payload, request_key: request.current.key });
      setSubmitted(receipt);
      void history.refetch();
    } catch (err) {
      setError(apiErrorDetail(err, "Could not submit your enquiry. Try again."));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  return (
    <ThemedScreen>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, {
        paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl,
      }]}>
        <Button label="Back" variant="ghost" fullWidth={false} onPress={goBack}
          icon={<Ionicons name="arrow-back" size={18} color={colors.accentText} />} />
        <View style={styles.heading}>
          <IconTile symbol="suppliers" />
          <AppText accessibilityRole="header" variant="heading" style={styles.copy}>Material Supplier Enquiry</AppText>
        </View>
        {submitted ? (
          <Card style={styles.form} testID="supplier-enquiry-success">
            <AppText accessibilityLiveRegion="polite" variant="heading" color={colors.success}>Enquiry submitted</AppText>
            <AppText>Our team will contact you on the number you provided.</AppText>
            {submitted.id ? <AppText variant="caption">Reference {submitted.id}</AppText> : null}
            <Button label="Done" onPress={goBack} />
          </Card>
        ) : plants.error ? (
          <Card style={styles.form}>
            <AppText color={colors.error}>{plants.error}</AppText>
            <Button label="Retry" variant="outline" onPress={plants.reload} />
          </Card>
        ) : plants.loading ? <AppText accessibilityLiveRegion="polite">Loading assigned plants…</AppText>
          : !options.length ? <Card><AppText>No active plant is assigned to your account. Contact your Plant Owner for help.</AppText></Card>
          : (
            <Card style={styles.form} testID="supplier-enquiry-form">
              <AppText variant="label">Plant</AppText>
              {options.length === 1 ? <AppText>{options[0].name}</AppText> : (
                <View accessibilityRole="radiogroup" style={styles.choices}>
                  {options.map(plant => (
                    <Pressable key={plant.id} accessibilityRole="radio" accessibilityLabel={plant.name}
                      accessibilityState={{ checked: plantId === plant.id, disabled: busy }}
                      disabled={busy} onPress={() => setSelectedPlant(plant.id)}
                      style={[styles.option, { borderColor: colors.divider }]}>
                      <Ionicons name={plantId === plant.id ? "radio-button-on" : "radio-button-off"} size={20} color={colors.accentText} accessible={false} />
                      <AppText style={styles.copy}>{plant.name}{plant.city ? " · " + plant.city : ""}</AppText>
                    </Pressable>
                  ))}
                </View>
              )}

              <View style={styles.choices}>
                <AppText variant="label">Materials *</AppText>
                <Pressable testID="supplier-material-dropdown" accessibilityRole="button"
                  accessibilityLabel={`Materials, ${materials.length} of 3 selected`} accessibilityState={{ expanded: materialsOpen }}
                  disabled={busy} onPress={() => setMaterialsOpen(!materialsOpen)}
                  style={[styles.option, { borderColor: colors.controlOutline }]}>
                  <AppText style={styles.copy}>{materials.length ? materials.join(", ") : "Select materials"}</AppText>
                  <Ionicons name={materialsOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.onSurfaceTertiary} accessible={false} />
                </Pressable>
                <AppText variant="caption" accessibilityLiveRegion="polite">{materials.length} of 3 selected</AppText>
                {materialsOpen ? MATERIALS.map(material => {
                  const checked = materials.includes(material);
                  const disabled = busy || (!checked && materials.length >= 3);
                  return (
                    <Pressable key={material} accessibilityRole="checkbox" accessibilityLabel={material}
                      accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => setMaterials(current => current.includes(material)
                        ? current.filter(item => item !== material) : current.length < 3 ? [...current, material] : current)}
                      style={[styles.option, { borderColor: checked ? colors.accentText : colors.divider,
                        backgroundColor: checked ? colors.brandSoft : colors.surfaceSecondary, opacity: disabled ? 0.62 : 1 }]}>
                      <Ionicons name={checked ? "checkbox" : "square-outline"} size={20} color={colors.accentText} accessible={false} />
                      <AppText style={styles.copy}>{material}</AppText>
                    </Pressable>
                  );
                }) : null}
              </View>
              <Input label="Contact name" value={contactName} onChangeText={setContactName} required editable={!busy} maxLength={150} autoCapitalize="words" />
              <Input label="Contact phone" value={contactPhone} onChangeText={setContactPhone} required editable={!busy} keyboardType="phone-pad" maxLength={16} />
              <Input label="Delivery location" value={location} onChangeText={setLocation} required editable={!busy} maxLength={500} />
              <DateField label="Required delivery date" date={date} onChange={setDate} required />
              {error ? <AppText testID="supplier-enquiry-error" accessibilityLiveRegion="polite" color={colors.error}>{error}</AppText> : null}
              <Button label="Submit Enquiry" loading={busy} onPress={() => void submit()} />
            </Card>
          )}
        <Card style={styles.form}>
          <AppText variant="heading">My supplier enquiries</AppText>
          {history.error ? <Button label="Retry enquiry history" variant="outline" onPress={history.reload} /> : null}
          {history.loading && !history.data ? <AppText>Loading enquiries…</AppText> : null}
          {history.data?.enquiries?.length === 0 ? <AppText>No supplier enquiries submitted.</AppText> : null}
          {history.data?.enquiries?.map(item => <View key={item.id} style={{ gap: 3 }}>
            <AppText>{item.plant_name} · {item.status}</AppText>
            <AppText variant="caption">{item.materials?.join(", ")} · {item.required_date}</AppText>
            <AppText variant="caption">Reference {item.id}</AppText>
          </View>)}
        </Card>
      </ScrollView>
    </ThemedScreen>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 620, alignSelf: "center", paddingHorizontal: spacing.md, gap: spacing.md },
  heading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  form: { gap: spacing.md },
  choices: { gap: spacing.xs },
  option: { minHeight: 44, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
