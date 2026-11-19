import { Ionicons } from "@expo/vector-icons";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiPost } from "@/src/api/client";
import { useAuth, type Me } from "@/src/auth/AuthContext";
import { IconTile } from "@/src/components/IconTile";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { DateField, localDate } from "@/src/components/ui/DateField";
import { Input } from "@/src/components/ui/Input";
import { useGet } from "@/src/hooks/useApi";
import { DEALER_SERVICES, type DealerService } from "@/src/owner/DealerCards";
import { PlantSelector, usePlantWorkspace } from "@/src/owner/PlantOperations";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";

const ACCESSORIES = ["Silo", "Conveyor Belt", "Cement Filters", "DG Set", "CCTV Setup", "Office Cabin", "Other"] as const;
type Accessory = (typeof ACCESSORIES)[number];
type Receipt = { id: string; status: string };
type History = Receipt & { service_type: string; plant_name: string; required_date: string };

const ENDPOINT = "/owner/dealer-enquiries";
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{0,58}[a-z0-9])$/i;

export default function DealerEnquiry() {
  const { user, token, hydrating } = useAuth();
  const { service, plantId } = useLocalSearchParams<{ service?: string; plantId?: string }>();
  if (hydrating) return null;
  if (!user || !token) return <Redirect href="/login" />;
  if (user.role !== "owner" && user.role !== "plant_owner") return <Redirect href="/role-home" />;
  if (typeof service !== "string" || !Object.prototype.hasOwnProperty.call(DEALER_SERVICES, service)) {
    return <Redirect href="/owner" />;
  }
  return <DealerForm key={`${user.id}:${service}:${plantId ?? ""}`} service={service as DealerService}
    preferredPlant={plantId} user={user} token={token} />;
}

function DealerForm({ service, preferredPlant, user, token }: {
  service: DealerService; preferredPlant?: string; user: Me; token: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const workspace = usePlantWorkspace(preferredPlant);
  const history = useGet<{ enquiries: History[] }>(ENDPOINT);
  const [name, setName] = useState(user.name ?? "");
  const [phone, setPhone] = useState(user.phone ?? user.mobile ?? "");
  const [requirements, setRequirements] = useState("");
  const [domain, setDomain] = useState("");
  const [accessories, setAccessories] = useState<Accessory[]>([]);
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const sending = useRef(false);
  const retry = useRef<{ payload: string; key: string } | null>(null);
  const item = DEALER_SERVICES[service];
  const domainForm = service === "buy_domain";
  const accessoryForm = service === "plant_accessories";
  const requirementsRequired = !accessoryForm || accessories.includes("Other");
  const requirementsLabel = accessoryForm ? "Accessory requirements" :
    service === "website_design" ? "Website requirements" : "Marketing goals";
  const historyItems = history.data?.enquiries?.filter(row => row.service_type === item.type);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/owner");
  }

  async function submit() {
    if (sending.current || receipt) return;
    if (!workspace.plant) return setError("Choose your plant.");
    if (name.trim().length < 2) return setError("Enter the contact name.");
    if (!/^\+?[0-9]{10,15}$/.test(phone.trim())) return setError("Enter a valid 10–15 digit contact number.");
    if (!date || date < localDate()) return setError("Choose today's date or a later date.");
    if (domainForm && !domainPattern.test(domain.trim())) return setError("Enter a domain name such as yourplant.in.");
    if (accessoryForm && !accessories.length) return setError("Choose at least one accessory.");
    if (accessoryForm && location.trim().length < 3) return setError("Enter the delivery or installation location.");
    const description = requirements.trim().replace(/\s+/g, " ");
    if (!domainForm && (requirementsRequired || description) && description.length < (accessoryForm ? 3 : 5)) {
      return setError(`Enter ${requirementsLabel.toLowerCase()}.`);
    }

    const request = domainForm ? { type: service, domain: domain.trim().toLowerCase() }
      : accessoryForm ? { type: service, accessories, location: location.trim(), requirements: description || null }
      : { type: service, requirements: description };
    const payload = {
      plant_id: workspace.plant.id, contact_name: name.trim(), contact_phone: phone.trim(),
      required_date: date, request,
    };
    const serialized = JSON.stringify(payload);
    if (retry.current?.payload !== serialized) {
      retry.current = { payload: serialized, key: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      setReceipt(await apiPost<Receipt>(ENDPOINT, token, { ...payload, request_key: retry.current.key }));
      void history.refetch();
    } catch (err) {
      setError(apiErrorDetail(err, "Could not submit your enquiry. Try again."));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return <ThemedScreen>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, {
      paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl,
    }]}>
      <Button label="Back" variant="ghost" onPress={goBack} fullWidth={false}
        icon={<Ionicons name="arrow-back" size={18} color={colors.accentText} />} />
      <View style={styles.heading}>
        <IconTile icon={item.icon} />
        <AppText accessibilityRole="header" variant="heading" style={styles.grow}>{item.label}</AppText>
      </View>
      {receipt ? <Card style={styles.form} testID="dealer-enquiry-success">
        <AppText accessibilityLiveRegion="polite" variant="heading" color={colors.success}>Enquiry submitted</AppText>
        <AppText>Our team will follow up using your contact number.</AppText>
        <AppText variant="caption">Reference {receipt.id}</AppText>
        <Button label="Done" onPress={goBack} />
      </Card> : workspace.error ? <Card style={styles.form}>
        <AppText color={colors.error}>{workspace.error}</AppText>
        <Button label="Retry" variant="outline" onPress={workspace.reload} />
      </Card> : workspace.loading && !workspace.plant ? <AppText>Loading assigned plants…</AppText>
        : !workspace.plant ? <Card><AppText>No active plant is assigned to your account.</AppText></Card> :
      <Card testID="dealer-enquiry-form" style={styles.form}>
        <AppText variant="label">Plant</AppText>
        <PlantSelector plants={workspace.plants} plant={workspace.plant} select={id => { if (!busy) workspace.setSelection(id); }} />
        {accessoryForm ? <View style={styles.form}>
          <AppText variant="label">Plant accessories *</AppText>
          <View style={styles.choices}>
            {ACCESSORIES.map(accessory => {
              const checked = accessories.includes(accessory);
              return <Pressable key={accessory} accessibilityRole="checkbox" accessibilityLabel={accessory}
                accessibilityState={{ checked, disabled: busy }} disabled={busy}
                onPress={() => setAccessories(current => current.includes(accessory) ? current.filter(value => value !== accessory) : [...current, accessory])}
                style={[styles.choice, { borderColor: checked ? colors.accentText : colors.divider,
                  backgroundColor: checked ? colors.brandSoft : colors.surfaceSecondary }]}>
                <Ionicons name={checked ? "checkbox" : "square-outline"} size={18} color={colors.accentText} />
                <AppText>{accessory}</AppText>
              </Pressable>;
            })}
          </View>
          <Input label="Delivery or installation location" value={location} onChangeText={setLocation}
            required maxLength={500} editable={!busy} />
        </View> : null}
        {domainForm ? <Input label="Preferred domain name" placeholder="yourplant.in" value={domain}
          onChangeText={setDomain} autoCapitalize="none" keyboardType="url" required maxLength={253} editable={!busy} />
          : <View style={{ gap: 5 }}>
            <AppText variant="label">{requirementsLabel}{requirementsRequired ? " *" : ""}</AppText>
            <TextInput accessibilityLabel={requirementsLabel} value={requirements} onChangeText={setRequirements}
              editable={!busy} multiline maxLength={1000}
              style={[styles.multiline, { borderColor: colors.controlOutline, color: colors.onSurface, backgroundColor: colors.surfaceSecondary }]} />
          </View>}
        <Input label="Contact name" value={name} onChangeText={setName} autoCapitalize="words" required maxLength={150} editable={!busy} />
        <Input label="Contact phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" required maxLength={16} editable={!busy} />
        <DateField label="Needed by" date={date} onChange={setDate} required />
        {domainForm ? <AppText variant="caption">Our team will check availability and share pricing before registration.</AppText> : null}
        {error ? <AppText testID="dealer-enquiry-error" accessibilityLiveRegion="polite" color={colors.error}>{error}</AppText> : null}
        <Button label={domainForm ? "Request Domain" : "Submit Enquiry"} loading={busy} onPress={() => void submit()} />
      </Card>}
      <Card style={styles.form}>
        <AppText variant="heading">My enquiries</AppText>
        {history.error ? <Button label="Retry enquiry history" variant="outline" onPress={history.reload} /> : null}
        {history.loading && !history.data ? <AppText>Loading enquiries…</AppText> : null}
        {historyItems?.length === 0 ? <AppText>No enquiries submitted.</AppText> : null}
        {historyItems?.map(row => <View key={row.id} style={{ gap: 3 }}>
          <AppText>{row.plant_name} · {row.status}</AppText>
          <AppText variant="caption">Needed by {row.required_date} · Reference {row.id}</AppText>
        </View>)}
      </Card>
    </ScrollView>
  </ThemedScreen>;
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 620, alignSelf: "center", paddingHorizontal: spacing.md, gap: spacing.md },
  heading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  form: { gap: spacing.md },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  choice: { minHeight: 44, maxWidth: "100%", borderWidth: 1, borderRadius: radius.md, padding: spacing.sm,
    flexDirection: "row", alignItems: "center", gap: spacing.xs },
  multiline: { minHeight: 84, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm,
    fontFamily: fonts.regular, fontSize: 14, textAlignVertical: "top" },
});
