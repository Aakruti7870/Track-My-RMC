import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiPut } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { useToast } from "@/src/components/ui/Toast";
import { OwnerFrame, OwnerGlass, OwnerList, useOwnerPalette } from "@/src/owner/OwnerUI";

type Plant = { id: string; name: string };
type Staff = { id: string; name: string; role: string; active: boolean };
type Flags = { view: boolean; edit: boolean; approve: boolean };
type Grant = Flags & { key: string; label: string; ceiling: Flags; overridden: boolean };
type GrantsResponse = { permissions: Grant[] };
type GrantEdit = Flags & { key: string };

export default function StaffModuleAccess() {
  const { hydrating, token, user } = useAuth();
  const router = useRouter();
  const p = useOwnerPalette();
  const toast = useToast();
  const isOwner = user?.role === "owner" || user?.role === "plant_owner";
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plant, setPlant] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState("");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token || !isOwner) return;
    let active = true;
    apiGet<{ plants: Plant[] }>("/master/my-plants", token).then(r => {
      if (!active) return;
      setPlants(r.plants || []);
      setPlant(r.plants?.[0]?.id || "");
    }).catch((e: any) => { if (active) { setLoading(false); setError(e.detail || "Could not load plants"); } });
    return () => { active = false; };
  }, [token, isOwner]);

  useEffect(() => {
    if (!token || !plant) return;
    let active = true;
    setStaffId(""); setStaff([]); setGrants([]); setError(""); setLoading(true);
    apiGet<{ people: Staff[] }>("/master/plants/" + plant + "/people", token).then(r => {
      if (!active) return;
      const dispatchers = (r.people || []).filter(s => s.role === "dispatcher" && s.active);
      setStaff(dispatchers);
      setStaffId(dispatchers[0]?.id || "");
      if (!dispatchers.length) setLoading(false);
    }).catch((e: any) => { if (active) { setLoading(false); setError(e.detail || "Could not load staff"); } });
    return () => { active = false; };
  }, [token, plant]);

  const refresh = useCallback(async () => {
    if (!token || !plant || !staffId) return;
    setLoading(true); setError("");
    try {
      const response = await apiGet<GrantsResponse>(
        "/owner/plants/" + plant + "/staff/" + staffId + "/module-permissions", token
      );
      setGrants(response.permissions);
      setDirty(false);
    } catch (e: any) {
      setGrants([]);
      setError(e.detail || "Unable to load staff permissions");
    } finally { setLoading(false); }
  }, [token, plant, staffId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const update = (key: string, action: keyof Flags, enabled: boolean) => {
    setDirty(true);
    setGrants(old => old.map(g => {
      if (g.key !== key || (enabled && !g.ceiling[action])) return g;
      if (action === "view" && !enabled) return { ...g, view: false, edit: false, approve: false };
      if (action === "edit" && enabled) return { ...g, view: true, edit: true };
      if (action === "approve" && enabled) return { ...g, view: true, approve: true };
      return { ...g, [action]: enabled };
    }));
  };
  const save = async () => {
    if (!token || !plant || !staffId || grants.length !== 6 || !dirty) return;
    setSaving(true);
    try {
      const permissions: GrantEdit[] = grants.map(g => ({
        key: g.key, view: g.view, edit: g.edit, approve: g.approve,
      }));
      const result = await apiPut<GrantsResponse>(
        "/owner/plants/" + plant + "/staff/" + staffId + "/module-permissions",
        token, { permissions }
      );
      setGrants(result.permissions); setDirty(false);
      toast("Staff permissions saved and audited", "success");
    } catch (e: any) { toast(e.detail || "Permission update failed", "error"); }
    finally { setSaving(false); }
  };

  if (hydrating) return null;
  if (!token || !user) return <Redirect href="/login" />;
  if (!isOwner) return <Redirect href="/role-home" />;

  return (
    <OwnerFrame title="Staff Module Access" subtitle="Plant Owner · Dispatcher pilot · audited restrictions">
      <OwnerList>
        <Button label="Back to Workforce" variant="ghost" size="sm" fullWidth={false} onPress={() => router.back()} />
        <OwnerGlass style={{ padding: 14, gap: 10 }}>
          <AppText style={{ color: p.text, fontWeight: "700" }}>Select plant</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {plants.map(item => (
              <Pressable key={item.id} testID={"permission-plant-" + item.id}
                onPress={() => { if (dirty) { toast("Save or discard current changes first", "info"); return; } setPlant(item.id); }}
                style={{ backgroundColor: plant === item.id ? p.accent : p.glass, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
                <AppText style={{ color: plant === item.id ? "#FFFFFF" : p.text }}>{item.name}</AppText>
              </Pressable>
            ))}
          </View>
          <AppText style={{ color: p.text, fontWeight: "700" }}>Active Dispatchers</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {staff.map(member => (
              <Pressable key={member.id} testID={"permission-staff-" + member.id}
                onPress={() => { if (dirty) { toast("Save or discard current changes first", "info"); return; } setStaffId(member.id); }}
                style={{ backgroundColor: staffId === member.id ? p.accent : p.glass, padding: 11, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
                <AppText style={{ color: staffId === member.id ? "#FFFFFF" : p.text }}>{member.name}</AppText>
              </Pressable>
            ))}
          </View>
          {!staff.length && !loading ? <AppText style={{ color: p.muted }}>No active Dispatcher is linked to this plant.</AppText> : null}
        </OwnerGlass>
        {error ? <OwnerGlass style={{ padding: 14, gap: 8 }}><AppText style={{ color: "#CF342A" }}>{error}</AppText><Button label="Retry" onPress={() => void refresh()} /></OwnerGlass> : null}
        {loading ? <AppText style={{ color: p.muted }}>Loading staff permissions…</AppText> : null}
        {!loading && grants.length > 0 ? (
          <>
            <OwnerGlass style={{ padding: 14, gap: 7 }}>
              <AppText style={{ color: p.text, fontWeight: "700" }}>Permission matrix</AppText>
              <AppText style={{ color: p.muted, fontSize: 12 }}>
                Permissions cannot exceed the Dispatcher role ceiling. Approvals, billing and payroll cannot be granted here. Changes affect the next authorized API request.
              </AppText>
            </OwnerGlass>
            {grants.map(g => (
              <OwnerGlass key={g.key} style={{ padding: 14, gap: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={p.accent} />
                  <AppText style={{ color: p.text, fontSize: 15, fontWeight: "700", flex: 1 }}>{g.label}</AppText>
                  {g.overridden ? <AppText style={{ color: p.muted, fontSize: 11 }}>Customized</AppText> : null}
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  {(["view", "edit", "approve"] as const).map(action => {
                    const disabled = !g.ceiling[action] || (action !== "view" && !g.view);
                    return (
                      <View key={action} style={{ alignItems: "center", gap: 5 }}>
                        <AppText style={{ color: disabled ? p.muted : p.text, fontSize: 12 }}>{action[0].toUpperCase() + action.slice(1)}</AppText>
                        <Switch testID={"permission-" + g.key + "-" + action} disabled={saving || disabled}
                          accessibilityLabel={g.label + " " + action}
                          value={g[action]} onValueChange={v => update(g.key, action, v)}
                          trackColor={{ true: p.accent, false: p.border }} />
                      </View>
                    );
                  })}
                </View>
              </OwnerGlass>
            ))}
            <Button testID="save-staff-permissions" label="Save permissions" loading={saving}
              disabled={!dirty} onPress={() => void save()} />
            <Button label="Discard changes" variant="outline" disabled={!dirty || saving}
              onPress={() => void refresh()} />
          </>
        ) : null}
      </OwnerList>
    </OwnerFrame>
  );
}
