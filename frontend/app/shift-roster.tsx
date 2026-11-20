import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost, apiPut } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useGet } from "@/src/hooks/useApi";
import { ErrorView } from "@/src/components/StateViews";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";

type Shift = { id: string; name: string; start_time: string; end_time: string; grace_minutes: number; half_day_threshold_minutes?: number | null; active?: boolean };
type Roster = { id?: string; date: string; shift_id?: string | null; week_off?: boolean; shift?: Shift | null };
type GeofenceEvidence = { within_geofence: boolean; distance_m: number; radius_m: number };
type EmployeeRow = {
  user_id: string;
  name: string;
  role: string;
  classification: string;
  roster?: Roster | null;
  shift?: Shift | null;
  attendance?: { check_in_geofence?: GeofenceEvidence | null; check_out_geofence?: GeofenceEvidence | null } | null;
};
type PlantOverview = { plant_id: string; plant_name: string; date: string; shifts: Shift[]; employees: EmployeeRow[]; attendance_config?: { radius_m?: number | null; timezone_name?: string } | null };
type OverviewResponse = { date: string; plants: PlantOverview[] };
type MyRosterResponse = { plant_id: string; today: string; attendance_config?: any; roster: Roster[] };

function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

export default function ShiftRosterScreen() {
  const { colors } = useTheme();
  const { token, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const owner = user?.role === "plant_owner" || user?.role === "owner";
  const [busy, setBusy] = useState(false);
  const [dateKey, setDateKey] = useState(todayKey());
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);
  const [shiftName, setShiftName] = useState("General Shift");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [grace, setGrace] = useState("10");
  const [halfDay, setHalfDay] = useState("");
  const [radius, setRadius] = useState("250");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [selectedShift, setSelectedShift] = useState("");

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
  const overview = useGet<OverviewResponse>(owner && dateValid ? `/workforce-roster/overview/${dateKey}` : null);
  const mine = useGet<MyRosterResponse>(user && !owner ? "/workforce-roster/me" : null);
  const plants = overview.data?.plants ?? [];
  const plant = plants.find(item => item.plant_id === selectedPlant) ?? plants[0];
  const savedRadius = plant?.attendance_config?.radius_m;
  const activePlant = plant?.plant_id;
  const radiusValid = Number.isFinite(Number(radius)) && Number(radius) > 0;
  const request = owner ? overview : mine;

  useEffect(() => {
    if (savedRadius != null) setRadius(String(savedRadius));
  }, [activePlant, savedRadius]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await fn(); toast(message, "success"); await request.refetch(); }
    catch (e: any) { toast(e?.detail || "Action failed", "error"); }
    finally { setBusy(false); }
  };


  return <View style={{flex:1,backgroundColor:colors.surface}}>
    <View style={{height:insets.top}} />
    <ScrollView contentContainerStyle={{padding:spacing.lg,paddingBottom:120,gap:spacing.lg}} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><Pressable onPress={() => router.back()} style={[styles.back,{borderColor:colors.border}]}><Ionicons name="arrow-back" size={20} color={colors.onSurface}/></Pressable><View style={{flex:1}}><AppText variant="title">Shifts &amp; Roster</AppText><AppText variant="caption">Geofence evidence · Schedule rules · Attendance exceptions</AppText></View></View>

      {request.error ? <ErrorView message={request.error} onRetry={request.reload} /> : null}
      {request.loading && !request.data ? <ActivityIndicator color={colors.brand} /> : null}
      {owner ? <Card style={{gap: spacing.sm}}>
        <Input label="Roster date" value={dateKey} editable={!busy} onChangeText={setDateKey} />
        {!dateValid ? <AppText variant="caption" color={colors.error}>Use YYYY-MM-DD.</AppText> : null}
        {plants.length > 1 ? <View style={styles.wrap}>{plants.map(item => (
          <Pressable key={item.plant_id} accessibilityRole="button" accessibilityState={{ selected: item.plant_id === activePlant }}
            style={[styles.chip, { borderColor: item.plant_id === activePlant ? colors.brand : colors.border }]} disabled={busy}
            onPress={() => { setSelectedPlant(item.plant_id); setSelectedEmployee(""); setSelectedShift(""); }}>
            <AppText>{item.plant_name}</AppText>
          </Pressable>
        ))}</View> : null}
      </Card> : null}
      {owner && plant ? <>
        <Card style={{gap:spacing.md}}>
          <AppText variant="heading">Attendance Geofence</AppText><AppText variant="caption">Outside-radius punches are flagged for review, not automatically rejected.</AppText>
          <Input label="Radius in metres" value={radius} onChangeText={setRadius} keyboardType="decimal-pad" />
          <Button label="Save Geofence" disabled={!radiusValid} loading={busy} onPress={() => run(() => apiPut(`/workforce-roster/plants/${plant.plant_id}/attendance-config`, token!, {radius_m:Number(radius),timezone_name:"Asia/Kolkata"}), "Attendance geofence saved")} />
        </Card>
        <Card style={{gap:spacing.md}}>
          <AppText variant="heading">Create Shift</AppText>
          <Input label="Shift name" value={shiftName} onChangeText={setShiftName}/><Input label="Start HH:MM" value={startTime} onChangeText={setStartTime}/><Input label="End HH:MM" value={endTime} onChangeText={setEndTime}/><Input label="Grace minutes" value={grace} onChangeText={setGrace} keyboardType="number-pad"/><Input label="Half-day threshold minutes (optional)" value={halfDay} onChangeText={setHalfDay} keyboardType="number-pad"/>
          <Button label="Create Shift" loading={busy} onPress={() => run(() => apiPost(`/workforce-roster/plants/${plant.plant_id}/shifts`, token!, {name:shiftName,start_time:startTime,end_time:endTime,grace_minutes:Number(grace||0),half_day_threshold_minutes:halfDay?Number(halfDay):null,active:true}), "Shift created")} />
        </Card>
        <Card style={{gap:spacing.md}}>
          <AppText variant="heading">Daily Roster</AppText>
          <View style={styles.wrap}>{plant.employees.map((e) => <Pressable key={e.user_id} onPress={() => setSelectedEmployee(e.user_id)} style={[styles.chip,{borderColor:selectedEmployee===e.user_id?colors.brand:colors.border,backgroundColor:colors.surfaceSecondary}]}><AppText style={{fontFamily:fonts.semibold}}>{e.name}</AppText><AppText variant="caption">{e.classification}</AppText></Pressable>)}</View>
          <View style={styles.wrap}>{plant.shifts.filter(s => s.active !== false).map((s) => <Pressable key={s.id} onPress={() => setSelectedShift(s.id)} style={[styles.chip,{borderColor:selectedShift===s.id?colors.brand:colors.border,backgroundColor:colors.surfaceSecondary}]}><AppText style={{fontFamily:fonts.semibold}}>{s.name}</AppText><AppText variant="caption">{s.start_time}–{s.end_time} · {s.grace_minutes} min grace{s.half_day_threshold_minutes ? ` · ${s.half_day_threshold_minutes} min half-day threshold` : ""}</AppText></Pressable>)}</View>
          <Button label="Assign Selected Shift" disabled={!selectedEmployee||!selectedShift} loading={busy} onPress={() => run(() => apiPut(`/workforce-roster/plants/${plant.plant_id}/roster/${dateKey}/${selectedEmployee}`, token!, {shift_id:selectedShift,week_off:false}), "Roster updated")} />
          <Button label="Mark Week Off" variant="outline" disabled={!selectedEmployee} loading={busy} onPress={() => run(() => apiPut(`/workforce-roster/plants/${plant.plant_id}/roster/${dateKey}/${selectedEmployee}`, token!, {shift_id:null,week_off:true}), "Week off saved")} />
        </Card>
        <Card style={{gap:spacing.sm}}>
          <AppText variant="heading">Attendance Exceptions</AppText>
          {plant.employees.map(e => {
            const checkIn = e.attendance?.check_in_geofence;
            const checkOut = e.attendance?.check_out_geofence;
            const outside = [checkIn, checkOut].some(punch => punch?.within_geofence === false);
            return <View key={e.user_id} style={styles.row}>
              <View style={{flex:1}}>
                <AppText>{e.name}</AppText>
                <AppText variant="caption">{e.shift?.name || "No shift"} · {e.classification}</AppText>
                {checkIn ? <AppText variant="caption">Check in · {Math.round(checkIn.distance_m)} m from plant</AppText> : null}
                {checkOut ? <AppText variant="caption">Check out · {Math.round(checkOut.distance_m)} m from plant</AppText> : null}
              </View>
              <Badge label={outside ? "OUTSIDE RADIUS" : e.classification} color={outside ? colors.warning : colors.brand} />
            </View>;
          })}
        </Card>
      </> : !owner ? <>
        <Card style={{gap:spacing.md}}><AppText variant="heading">My Upcoming Roster</AppText><AppText variant="caption">Attendance and GPS are evidence only; salary is never automatically deducted.</AppText>{(mine.data?.roster||[]).map((r)=><View key={r.id||r.date} style={styles.row}><View style={{flex:1}}><AppText>{r.date}</AppText><AppText variant="caption">{r.week_off?"Week Off":r.shift?`${r.shift.name} · ${r.shift.start_time}–${r.shift.end_time}`:"No shift assigned"}</AppText></View><Badge label={r.week_off?"WEEK OFF":r.shift?.name||"OPEN"} color={colors.brand}/></View>)}</Card>
        <Card style={{gap:spacing.sm}}><AppText variant="heading">Location Attendance</AppText><AppText variant="caption">Your Punch In / Punch Out screen records distance from the plant when a geofence is configured. Outside-location punches remain reviewable by the Plant Owner.</AppText></Card>
      </> : null}
    </ScrollView>
  </View>;
}

const styles=StyleSheet.create({center:{flex:1,alignItems:"center",justifyContent:"center"},header:{flexDirection:"row",alignItems:"center",gap:spacing.md},back:{width:42,height:42,borderRadius:radius.md,borderWidth:1,alignItems:"center",justifyContent:"center"},wrap:{flexDirection:"row",flexWrap:"wrap",gap:spacing.sm},chip:{minWidth:140,borderWidth:1,borderRadius:radius.md,padding:spacing.md,gap:2},row:{flexDirection:"row",alignItems:"center",gap:spacing.md,paddingVertical:spacing.sm}});
