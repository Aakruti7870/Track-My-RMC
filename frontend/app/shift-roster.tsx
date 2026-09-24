import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost, apiPut } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";

type Shift = { id: string; name: string; start_time: string; end_time: string; grace_minutes: number; half_day_threshold_minutes?: number | null };
type Roster = { id?: string; date: string; shift_id?: string | null; week_off?: boolean; shift?: Shift | null };
type EmployeeRow = { user_id: string; name: string; role: string; classification: string; roster?: Roster | null; shift?: Shift | null; attendance?: any };
type PlantOverview = { plant_id: string; date: string; shifts: Shift[]; employees: EmployeeRow[]; attendance_config?: { radius_m?: number | null; timezone_name?: string } | null };
type OverviewResponse = { date: string; plants: PlantOverview[] };
type MyRosterResponse = { plant_id: string; today: string; attendance_config?: any; roster: Roster[] };

function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

export default function ShiftRosterScreen() {
  const { colors } = useTheme();
  const { token, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const owner = user?.role === "plant_owner";
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dateKey, setDateKey] = useState(todayKey());
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [mine, setMine] = useState<MyRosterResponse | null>(null);
  const [shiftName, setShiftName] = useState("General Shift");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [grace, setGrace] = useState("10");
  const [halfDay, setHalfDay] = useState("");
  const [radius, setRadius] = useState("250");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [selectedShift, setSelectedShift] = useState("");

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      if (owner) {
        const data = await apiGet<OverviewResponse>(`/workforce-roster/overview/${dateKey}`, token);
        setOverview(data);
        const p = data.plants?.[0];
        if (p?.attendance_config?.radius_m != null) setRadius(String(p.attendance_config.radius_m));
      } else {
        setMine(await apiGet<MyRosterResponse>("/workforce-roster/me", token));
      }
    } catch (e: any) { toast(e?.detail || "Unable to load shift roster", "error"); }
    finally { setLoading(false); }
  }, [token, owner, dateKey, toast]);

  useEffect(() => { load(); }, [token, owner, dateKey]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await fn(); toast(message, "success"); await load(); }
    catch (e: any) { toast(e?.detail || "Action failed", "error"); }
    finally { setBusy(false); }
  };

  if (loading && !overview && !mine) return <View style={[styles.center,{backgroundColor:colors.surface}]}><ActivityIndicator color={colors.brand}/></View>;
  const plant = overview?.plants?.[0];

  return <View style={{flex:1,backgroundColor:colors.surface}}>
    <View style={{height:insets.top}} />
    <ScrollView contentContainerStyle={{padding:spacing.lg,paddingBottom:120,gap:spacing.lg}} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><Pressable onPress={() => router.back()} style={[styles.back,{borderColor:colors.border}]}><Ionicons name="arrow-back" size={20} color={colors.onSurface}/></Pressable><View style={{flex:1}}><AppText variant="title">Shifts &amp; Roster</AppText><AppText variant="caption">Geofence evidence · Schedule rules · Attendance exceptions</AppText></View></View>

      {owner && plant ? <>
        <Card style={{gap:spacing.md}}>
          <AppText variant="heading">Attendance Geofence</AppText><AppText variant="caption">Outside-radius punches are flagged for review, not automatically rejected.</AppText>
          <Input label="Radius in metres" value={radius} onChangeText={setRadius} keyboardType="decimal-pad" />
          <Button label="Save Geofence" loading={busy} onPress={() => run(() => apiPut(`/workforce-roster/plants/${plant.plant_id}/attendance-config`, token!, {radius_m:Number(radius),timezone_name:"Asia/Kolkata"}), "Attendance geofence saved")} />
        </Card>
        <Card style={{gap:spacing.md}}>
          <AppText variant="heading">Create Shift</AppText>
          <Input label="Shift name" value={shiftName} onChangeText={setShiftName}/><Input label="Start HH:MM" value={startTime} onChangeText={setStartTime}/><Input label="End HH:MM" value={endTime} onChangeText={setEndTime}/><Input label="Grace minutes" value={grace} onChangeText={setGrace} keyboardType="number-pad"/><Input label="Half-day threshold minutes (optional)" value={halfDay} onChangeText={setHalfDay} keyboardType="number-pad"/>
          <Button label="Create Shift" loading={busy} onPress={() => run(() => apiPost(`/workforce-roster/plants/${plant.plant_id}/shifts`, token!, {name:shiftName,start_time:startTime,end_time:endTime,grace_minutes:Number(grace||0),half_day_threshold_minutes:halfDay?Number(halfDay):null,active:true}), "Shift created")} />
        </Card>
        <Card style={{gap:spacing.md}}>
          <AppText variant="heading">Daily Roster</AppText><Input label="Roster date" value={dateKey} onChangeText={setDateKey}/>
          <View style={styles.wrap}>{plant.employees.map((e) => <Pressable key={e.user_id} onPress={() => setSelectedEmployee(e.user_id)} style={[styles.chip,{borderColor:selectedEmployee===e.user_id?colors.brand:colors.border,backgroundColor:colors.surfaceSecondary}]}><AppText style={{fontFamily:fonts.semibold}}>{e.name}</AppText><AppText variant="caption">{e.classification}</AppText></Pressable>)}</View>
          <View style={styles.wrap}>{plant.shifts.map((s) => <Pressable key={s.id} onPress={() => setSelectedShift(s.id)} style={[styles.chip,{borderColor:selectedShift===s.id?colors.brand:colors.border,backgroundColor:colors.surfaceSecondary}]}><AppText style={{fontFamily:fonts.semibold}}>{s.name}</AppText><AppText variant="caption">{s.start_time}–{s.end_time}</AppText></Pressable>)}</View>
          <Button label="Assign Selected Shift" disabled={!selectedEmployee||!selectedShift} loading={busy} onPress={() => run(() => apiPut(`/workforce-roster/plants/${plant.plant_id}/roster/${dateKey}/${selectedEmployee}`, token!, {shift_id:selectedShift,week_off:false}), "Roster updated")} />
          <Button label="Mark Week Off" variant="outline" disabled={!selectedEmployee} loading={busy} onPress={() => run(() => apiPut(`/workforce-roster/plants/${plant.plant_id}/roster/${dateKey}/${selectedEmployee}`, token!, {shift_id:null,week_off:true}), "Week off saved")} />
        </Card>
        <Card style={{gap:spacing.sm}}><AppText variant="heading">Attendance Exceptions</AppText>{plant.employees.map((e)=><View key={e.user_id} style={styles.row}><View style={{flex:1}}><AppText>{e.name}</AppText><AppText variant="caption">{e.shift?.name || "No shift"} · {e.classification}</AppText></View><Badge label={e.attendance?.owner_override_status || e.classification} color={e.attendance?.check_in_geofence?.within_geofence===false?colors.warning:colors.brand}/></View>)}</Card>
      </> : <>
        <Card style={{gap:spacing.md}}><AppText variant="heading">My Upcoming Roster</AppText><AppText variant="caption">Attendance and GPS are evidence only; salary is never automatically deducted.</AppText>{(mine?.roster||[]).map((r)=><View key={r.id||r.date} style={styles.row}><View style={{flex:1}}><AppText>{r.date}</AppText><AppText variant="caption">{r.week_off?"Week Off":r.shift?`${r.shift.name} · ${r.shift.start_time}–${r.shift.end_time}`:"No shift assigned"}</AppText></View><Badge label={r.week_off?"WEEK OFF":r.shift?.name||"OPEN"} color={colors.brand}/></View>)}</Card>
        <Card style={{gap:spacing.sm}}><AppText variant="heading">Location Attendance</AppText><AppText variant="caption">Your Punch In / Punch Out screen records distance from the plant when a geofence is configured. Outside-location punches remain reviewable by the Plant Owner.</AppText></Card>
      </>}
    </ScrollView>
  </View>;
}

const styles=StyleSheet.create({center:{flex:1,alignItems:"center",justifyContent:"center"},header:{flexDirection:"row",alignItems:"center",gap:spacing.md},back:{width:42,height:42,borderRadius:radius.md,borderWidth:1,alignItems:"center",justifyContent:"center"},wrap:{flexDirection:"row",flexWrap:"wrap",gap:spacing.sm},chip:{minWidth:140,borderWidth:1,borderRadius:radius.md,padding:spacing.md,gap:2},row:{flexDirection:"row",alignItems:"center",gap:spacing.md,paddingVertical:spacing.sm}});
