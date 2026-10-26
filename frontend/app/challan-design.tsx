import React, { useEffect, useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { WebView } from "react-native-webview";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiDelete, apiErrorDetail, apiPut } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import {
  buildChallanHtml, DEFAULT_CHALLAN_DESIGN, sampleChallan,
  type ChallanDesign, type PlantPrint,
} from "@/src/challan/print";

type TemplateResponse = { plant: PlantPrint; design: ChallanDesign; play_store_url: string };
type PlantOption = { id: string; name: string; city: string };

export default function ChallanDesigner() {
  const { token, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const [plantId, setPlantId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ChallanDesign>(DEFAULT_CHALLAN_DESIGN);
  const [busy, setBusy] = useState(false);
  const plants = useGet<{ plants: PlantOption[] }>("/master/my-plants");
  const selected = useGet<TemplateResponse>(plantId ? "/challan-design/plants/" + plantId : null);
  const manageRole = ["owner", "plant_owner", "admin"].includes(user?.role || "");

  useEffect(() => {
    if (!plantId && plants.data?.plants?.length) setPlantId(plants.data.plants[0].id);
  }, [plantId, plants.data]);
  useEffect(() => {
    if (selected.data?.design) setDraft(selected.data.design);
  }, [selected.data]);

  const html = useMemo(() => selected.data
    ? buildChallanHtml(selected.data.plant, draft, sampleChallan(), true)
    : "", [selected.data, draft]);

  const update = <K extends keyof ChallanDesign>(key: K, value: ChallanDesign[K]) =>
    setDraft(previous => ({...previous, [key]: value}));

  const save = async () => {
    if (!token || !plantId || busy) return;
    if (!/^#[0-9a-fA-F]{6}$/.test(draft.accent_color) || !draft.title.trim()) {
      toast("Enter a title and a six-digit colour code like #17313A", "error"); return;
    }
    setBusy(true);
    try {
      await apiPut("/challan-design/plants/" + plantId, token, {
        expected_version: draft.version, title: draft.title.trim(), accent_color: draft.accent_color,
        header_note: draft.header_note, footer_note: draft.footer_note,
        logo_data_uri: draft.logo_data_uri,
        show_po: draft.show_po, show_slump: draft.show_slump, show_batch: draft.show_batch,
      });
      toast("Challan design saved and assigned to this plant", "success");
      await selected.reload();
    } catch (err) {
      toast(apiErrorDetail(err, "Could not save challan design"), "error");
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!token || !plantId || busy) return;
    setBusy(true);
    try {
      await apiDelete("/challan-design/plants/" + plantId, token);
      await selected.reload();
      toast("This plant now uses the standard TrackMyRMC challan", "success");
    } catch (err) {
      toast(apiErrorDetail(err, "Could not restore default"), "error");
    } finally { setBusy(false); }
  };
  const confirmReset = () => {
    if (Platform.OS === "web") {
      if (window.confirm("Restore the standard design for this plant?")) void reset();
    } else {
      Alert.alert("Restore default challan?", "The current custom design will be removed for this plant.", [
        { text: "Cancel", style: "cancel" },
        { text: "Restore", style: "destructive", onPress: () => void reset() },
      ]);
    }
  };

  const selectLogo = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"], allowsEditing: true, quality: 0.55, base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64) throw new Error("Could not read this image. Choose a PNG or JPEG.");
      const mime = asset.mimeType === "image/png" || asset.mimeType === "image/webp"
        ? asset.mimeType : "image/jpeg";
      const data = "data:" + mime + ";base64," + asset.base64;
      if (data.length > 500000) throw new Error("Logo exceeds 350 KB. Choose a smaller image.");
      update("logo_data_uri", data);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not read logo", "error");
    }
  };

  if (!manageRole) return <View style={{padding:24}}><AppText>Challan design is available only to a Plant Owner or assigned Plant Manager.</AppText></View>;

  const setting = (label:string, key:"show_po"|"show_slump"|"show_batch") =>
    <View style={{ flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingVertical:6 }}>
      <AppText style={{color:colors.onSurface}}>{label}</AppText>
      <Switch value={draft[key]} onValueChange={value=>update(key,value)} />
    </View>;

  const field = (label:string, key:"title"|"accent_color"|"header_note"|"footer_note", multiline=false) =>
    <View style={{gap:5}}>
      <AppText style={{fontWeight:"700",color:colors.onSurface}}>{label}</AppText>
      <TextInput
        testID={"challan-"+key}
        value={draft[key]}
        onChangeText={value=>update(key,value)}
        maxLength={key==="title"?100:key==="header_note"?140:key==="footer_note"?200:7}
        multiline={multiline}
        accessibilityLabel={label}
        style={{color:colors.onSurface,backgroundColor:colors.surfaceSecondary,borderWidth:1,
          borderColor:colors.border,borderRadius:10,padding:12,minHeight:46}}
      />
    </View>;

  return <View style={{flex:1,backgroundColor:colors.surface}}>
    <ScrollView contentContainerStyle={{padding:16,paddingBottom:70,gap:14}}>
      <Pressable onPress={()=>router.back()} style={{flexDirection:"row",alignItems:"center",gap:8,paddingVertical:8}}>
        <Ionicons name="arrow-back" size={22} color={colors.onSurface}/>
        <AppText variant="title">Design Challan</AppText>
      </Pressable>
      <AppText style={{color:colors.onSurfaceSecondary}}>Plant-specific A4 portrait · 2 copies per page · automatic default when no design is saved</AppText>
      <Card style={{gap:8}}>
        <AppText variant="heading">Select plant</AppText>
        {plants.error ? <AppText>{plants.error}</AppText> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>
          {(plants.data?.plants??[]).map(p=>
            <Pressable key={p.id} testID={"plant-"+p.id} accessibilityRole="button" onPress={()=>setPlantId(p.id)}
              style={{padding:10,borderRadius:10,borderWidth:1,borderColor:p.id===plantId?colors.brand:colors.border,
                backgroundColor:p.id===plantId?colors.surfaceSecondary:colors.surface}}>
              <AppText style={{color:colors.onSurface,fontWeight:p.id===plantId?"800":"400"}}>{p.name}</AppText>
              <AppText variant="caption">{p.city}</AppText>
            </Pressable>)}
        </ScrollView>
        {!plants.loading && !plants.data?.plants.length ? <AppText>No active plants are assigned to this login.</AppText> : null}
      </Card>
      {selected.error ? <Card><AppText>{selected.error}</AppText><Button label="Retry" onPress={selected.reload}/></Card> : null}
      {selected.data && <React.Fragment>
        <Card style={{gap:12}}>
          <AppText variant="heading">Branding and layout</AppText>
          <AppText variant="caption">{draft.is_custom?"Custom template v"+draft.version:"Default design in use"}</AppText>
          {field("Challan heading", "title")}
          {field("Header accent colour (#RRGGBB)", "accent_color")}
          {field("Header note / plant subtitle", "header_note")}
          {field("Footer delivery note", "footer_note", true)}
          <View style={{flexDirection:"row",alignItems:"center",gap:10}}>
            <Button label={draft.logo_data_uri?"Replace logo":"Upload plant logo"} onPress={()=>void selectLogo()}/>
            {draft.logo_data_uri ? <Pressable onPress={()=>update("logo_data_uri",null)}><AppText style={{color:colors.error}}>Remove logo</AppText></Pressable> : null}
          </View>
          <AppText variant="caption">PNG, JPEG or WebP · maximum 350 KB · no SVG or arbitrary HTML</AppText>
          {setting("Show PO reference", "show_po")}
          {setting("Show target slump", "show_slump")}
          {setting("Show batching time", "show_batch")}
          <AppText variant="caption">Plant name, customer, grade, quantity, vehicle, signatures, both copies and the TrackMyRMC QR cannot be removed.</AppText>
          <Button testID="challan-save" loading={busy} label="Save & Assign to This Plant" onPress={()=>void save()} fullWidth />
          <Button testID="challan-reset" variant="secondary" disabled={busy} label="Restore Standard Challan" onPress={confirmReset} fullWidth />
        </Card>
        <Card style={{gap:8,padding:8}}>
          <AppText variant="heading">Live A4 preview</AppText>
          <AppText variant="caption">Sample values are preview-only. Real challans use dispatched order records.</AppText>
          {Platform.OS === "web"
            ? React.createElement("iframe", { title: "Challan preview", srcDoc: html,
                style: {width:"100%",height:620,border:"1px solid #d1d5db",backgroundColor:"#fff"} } as any)
            : <WebView key={plantId} originWhitelist={["*"]} source={{html}}
                javaScriptEnabled={true} scrollEnabled={true}
                style={{height:520,width:"100%",backgroundColor:"#fff"}} />}
          <AppText variant="caption">Web: use the Print / Save as PDF button in the preview. Android: preview is available; native PDF printing requires separate print integration.</AppText>
        </Card>
      </React.Fragment>}
    </ScrollView>
  </View>;
}
