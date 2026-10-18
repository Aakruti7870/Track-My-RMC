import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { apiErrorDetail, apiGet, apiPut } from "@/src/api/client";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { Button } from "@/src/components/ui/Button";
import { useToast } from "@/src/components/ui/Toast";
import { spacing, fonts } from "@/src/theme/tokens";

type Plant = { id: string; name: string };
type Mixer = { id: string; registration_number: string };
type DriverRecord = {
  driver_id: string; driver_name: string; phone: string;
  employee_id: string | null; company_joining_date: string | null;
  total_driving_experience_months: number | null; blood_group: string | null;
  emergency_contact_1_name: string | null; emergency_contact_1_phone: string | null;
  emergency_contact_2_name: string | null; emergency_contact_2_phone: string | null;
  tm_number: string | null; is_active: boolean;
};
const empty = {
  phone: "", employee_id: "", company_joining_date: "",
  exp_years: "", exp_months: "", blood_group: "",
  emergency_contact_1_name: "", emergency_contact_1_phone: "",
  emergency_contact_2_name: "", emergency_contact_2_phone: "",
  transit_mixer_id: "",
};
type Form = typeof empty;
const bloodGroups = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export default function OwnerDriverManagement() {
  const { token, user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantId, setPlantId] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [mixers, setMixers] = useState<Mixer[]>([]);
  const [form, setForm] = useState<Form>({ ...empty });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canEdit = user?.role === "plant_owner" || user?.role === "owner";
  const setField = (key: keyof Form) => (value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const loadPlants = useCallback(async () => {
    if (!token || !canEdit) return;
    try {
      const response = await apiGet<{ plants: Plant[] }>("/master/my-plants", token);
      setPlants(response.plants ?? []);
      setPlantId(previous => previous && response.plants.some(p => p.id === previous)
        ? previous : response.plants[0]?.id || null);
    } catch (err: unknown) {
      setError(apiErrorDetail(err, "Unable to load plants"));
      setLoading(false);
    }
  }, [token, canEdit]);
  const loadDrivers = useCallback(async () => {
    if (!token || !plantId || !canEdit) return;
    setError(null); setLoading(true);
    try {
      const [d, m] = await Promise.all([
        apiGet<{ drivers: DriverRecord[] }>(`/business/plants/${plantId}/drivers`, token),
        apiGet<{ resources: { transit_mixers: Mixer[] } }>(`/master/plants/${plantId}/resources`, token),
      ]);
      setDrivers(d.drivers || []);
      setMixers(m.resources?.transit_mixers || []);
    } catch (err: unknown) {
      setError(apiErrorDetail(err, "Unable to load driver records"));
    } finally {
      setLoading(false);
    }
  }, [token, plantId, canEdit]);
  useEffect(() => { void loadPlants(); }, [loadPlants]);
  useEffect(() => { void loadDrivers(); }, [loadDrivers]);

  const chooseDriver = (driver: DriverRecord) => {
    const months = driver.total_driving_experience_months;
    setForm({
      phone: driver.phone,
      employee_id: driver.employee_id ?? "",
      company_joining_date: driver.company_joining_date ?? "",
      exp_years: months == null ? "" : String(Math.floor(months / 12)),
      exp_months: months == null ? "" : String(months % 12),
      blood_group: driver.blood_group ?? "",
      emergency_contact_1_name: driver.emergency_contact_1_name ?? "",
      emergency_contact_1_phone: driver.emergency_contact_1_phone ?? "",
      emergency_contact_2_name: driver.emergency_contact_2_name ?? "",
      emergency_contact_2_phone: driver.emergency_contact_2_phone ?? "",
      transit_mixer_id: "",
    });
  };
  const save = async () => {
    if (!plantId || !token || !canEdit) return;
    const years = Number(form.exp_years);
    const months = Number(form.exp_months);
    if (!form.phone.trim() || !/^[A-Za-z0-9_-]{2,50}$/.test(form.employee_id.trim())
      || !/^\d{4}-\d{2}-\d{2}$/.test(form.company_joining_date)
      || !form.exp_years.trim() || !form.exp_months.trim()
      || !Number.isInteger(years) || !Number.isInteger(months)
      || years < 0 || years > 80 || months < 0 || months > 11 || years * 12 + months > 960) {
      setError("Enter a valid registered driver mobile, employee ID, joining date, and driving experience");
      return;
    }
    setSaving(true); setError(null);
    try {
      await apiPut(`/business/plants/${plantId}/drivers`, token, {
        phone: form.phone.trim(),
        employee_id: form.employee_id.trim(),
        company_joining_date: form.company_joining_date,
        total_driving_experience_months: years * 12 + months,
        blood_group: form.blood_group || null,
        emergency_contact_1_name: form.emergency_contact_1_name || null,
        emergency_contact_1_phone: form.emergency_contact_1_phone || null,
        emergency_contact_2_name: form.emergency_contact_2_name || null,
        emergency_contact_2_phone: form.emergency_contact_2_phone || null,
        transit_mixer_id: form.transit_mixer_id || null,
      });
      toast("Driver record saved", "success");
      setForm({ ...empty });
      await loadDrivers();
    } catch (err: unknown) {
      setError(apiErrorDetail(err, "Unable to save driver employment record"));
    } finally {
      setSaving(false);
    }
  };
  if (!canEdit) {
    return <View style={{ flex: 1, backgroundColor: colors.surface, padding: 20 }}>
      <AppText>Only a plant owner can edit private driver employment records.</AppText>
    </View>;
  }
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: 130, gap: spacing.md }}>
      <AppText variant="title">Onboard & Manage Drivers</AppText>
      <AppText variant="caption">Use an existing WhatsApp-registered driver mobile. Drivers never receive plant-staff login privileges.</AppText>
      {plants.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {plants.map(p => <Pressable key={p.id} accessibilityRole="button" onPress={() => setPlantId(p.id)}
            style={{ padding: 10, borderRadius: 10, backgroundColor: p.id === plantId ? colors.brandSoft : colors.surfaceSecondary, borderWidth: 1, borderColor: p.id === plantId ? colors.brand : colors.border }}>
            <AppText>{p.name}</AppText>
          </Pressable>)}
        </View>
      ) : null}
      {error ? <Card><AppText style={{ color: colors.error }}>{error}</AppText><Button label="Retry" variant="outline" onPress={() => { void loadDrivers(); }} /></Card> : null}
      <Card style={{ gap: 10 }}>
        <AppText variant="heading">Driver onboarding / Employment details</AppText>
        <AppText variant="caption">Existing driver profile? Select it below to edit. A verified driver must register by WhatsApp OTP before onboarding.</AppText>
        <Input label="Registered driver mobile *" value={form.phone} onChangeText={setField("phone")} keyboardType="phone-pad" placeholder="91XXXXXXXXXX" />
        <Input label="Employee ID *" value={form.employee_id} onChangeText={setField("employee_id")} placeholder="EMP-001" />
        <Input label="Company joining date *" value={form.company_joining_date} onChangeText={setField("company_joining_date")} placeholder="YYYY-MM-DD" />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Input label="Driving years *" value={form.exp_years} keyboardType="numeric" onChangeText={setField("exp_years")} /></View>
          <View style={{ flex: 1 }}><Input label="Additional months *" value={form.exp_months} keyboardType="numeric" onChangeText={setField("exp_months")} /></View>
        </View>
        <AppText variant="caption">Blood group (optional medical information)</AppText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {bloodGroups.map(b => <Pressable key={b || "none"} onPress={() => setField("blood_group")(b)} accessibilityRole="button"
            style={{ minHeight: 40, minWidth: 46, padding: 8, borderRadius: 8,
              borderWidth: 1, borderColor: form.blood_group === b ? colors.brand : colors.border,
              backgroundColor: form.blood_group === b ? colors.brandSoft : colors.surfaceSecondary }}>
            <AppText style={{ fontFamily: fonts.medium }}>{b || "None"}</AppText>
          </Pressable>)}
        </View>
        <Input label="Emergency contact 1 name" value={form.emergency_contact_1_name} onChangeText={setField("emergency_contact_1_name")} />
        <Input label="Emergency contact 1 phone" value={form.emergency_contact_1_phone} onChangeText={setField("emergency_contact_1_phone")} keyboardType="phone-pad" />
        <Input label="Emergency contact 2 name" value={form.emergency_contact_2_name} onChangeText={setField("emergency_contact_2_name")} />
        <Input label="Emergency contact 2 phone" value={form.emergency_contact_2_phone} onChangeText={setField("emergency_contact_2_phone")} keyboardType="phone-pad" />
        <AppText variant="caption">Transit Mixer (optional; a mixer must not belong to another driver)</AppText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Pressable onPress={() => setField("transit_mixer_id")("")} style={{ padding: 8 }}><AppText>Keep existing assignment</AppText></Pressable>
          {mixers.map(m => <Pressable key={m.id} accessibilityRole="button" onPress={() => setField("transit_mixer_id")(m.id)}
            style={{ padding: 8, borderWidth: 1, borderRadius: 8, borderColor: form.transit_mixer_id === m.id ? colors.brand : colors.border }}>
            <AppText>{m.registration_number}</AppText>
          </Pressable>)}
        </View>
        <Button label="Save Driver Profile" loading={saving} disabled={!plantId || saving} onPress={() => void save()} />
      </Card>
      <Card style={{ gap: 8 }}>
        <AppText variant="heading">Existing Driver Records</AppText>
        {loading ? <AppText variant="caption">Loading records…</AppText> : null}
        {drivers.length === 0 && !loading ? <AppText variant="caption">No drivers onboarded for this plant yet.</AppText> : null}
        {drivers.map(d => (
          <Pressable key={d.driver_id} accessibilityRole="button" onPress={() => chooseDriver(d)}
            style={{ padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, gap: 2, backgroundColor: colors.surfaceSecondary }}>
            <AppText style={{ fontFamily: fonts.bold }}>{d.driver_name} · {d.employee_id || "ID pending"}</AppText>
            <AppText variant="caption">{d.tm_number || "No mixer"} · {d.phone} · {d.is_active ? "Active" : "Inactive"}</AppText>
            <AppText style={{ color: colors.brand, fontFamily: fonts.semibold }}>Edit profile</AppText>
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}
