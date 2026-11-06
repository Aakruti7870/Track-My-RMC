import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { apiErrorDetail, apiGet, apiPost, apiPut, apiUploadCertificate } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { AppText } from "@/src/components/ui/AppText";

const CARDS = [
  { key:"identification", title:"Plant Identification", icon:"location-outline" },
  { key:"certifications", title:"Clearances & Quality", icon:"shield-checkmark-outline" },
  { key:"specifications", title:"Plant Specifications", icon:"business-outline" },
  { key:"materials", title:"Raw Material Sources", icon:"layers-outline" },
  { key:"quality", title:"Mix Designs & Quality", icon:"flask-outline" },
  { key:"fleet", title:"Fleet Management", icon:"bus-outline" },
];
function Action({ title, onPress, colors, outline=false, disabled=false, testID }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityState={{disabled}}
    disabled={disabled} onPress={onPress} style={{backgroundColor:outline?colors.surfaceSecondary:disabled?colors.disabledSurface:colors.brand,
      borderWidth:outline?1:0,borderColor:colors.borderStrong,paddingVertical:12,paddingHorizontal:14,
      alignItems:"center",justifyContent:"center",borderRadius:12,minHeight:44}}>
    <AppText style={{color:outline?colors.onSurface:disabled?colors.disabledContent:colors.onBrand,fontWeight:"700",fontSize:13}}>{title}</AppText>
  </Pressable>;
}
function Unavailable({colors}) {
  return <View style={{backgroundColor:colors.surfaceSecondary,borderColor:colors.border,borderWidth:1,
    borderRadius:16,padding:24,alignItems:"center",gap:10}}>
    <Ionicons name="information-circle-outline" size={42} color={colors.brand}/>
    <AppText style={{fontWeight:"700",fontSize:17,textAlign:"center"}}>Plant Profile Update in Progress</AppText>
    <AppText variant="caption" style={{textAlign:"center",lineHeight:22}}>We apologize for the inconvenience.
      This plant's information is being updated. Verified details will be available here shortly.</AppText>
  </View>;
}
function DetailRows({details,colors,draft=false}) {
  if (!details?.length) return <Unavailable colors={colors}/>;
  return <View style={{gap:9}}>
    {draft && <AppText variant="caption">Draft preview only — not yet verified or published.</AppText>}
    {details.map(item=><View key={item.key} style={{backgroundColor:colors.surfaceSecondary,borderColor:colors.border,
      borderWidth:1,borderRadius:12,padding:12,flexDirection:"row",alignItems:"center",gap:10}}>
      <Ionicons name={item.value==="yes"?"checkmark-circle":"document-text-outline"} size={21}
        color={item.value==="yes"?colors.success:colors.brand}/>
      <View style={{flex:1,gap:2}}>
        <AppText style={{fontSize:13,color:colors.onSurfaceSecondary}}>{item.label}</AppText>
        <AppText style={{fontSize:15,fontWeight:"700"}}>{item.value==="yes"?"Available":item.value}</AppText>
      </View>
    </View>)}
  </View>;
}
function draftDetails(fields,answers) {
  return (fields||[]).filter(field=>field.kind!=="attachment" && (!field.depends_on||answers[field.depends_on]==="yes")
    && typeof answers[field.key]==="string" && !!answers[field.key].trim()
    && answers[field.key]!=="no" && answers[field.key]!=="unknown")
    .map(field=>({...field,value:answers[field.key]}));
}
function chooseWebFile() {
  return new Promise(resolve=>{
    if (typeof document==="undefined") return resolve(null);
    const input=document.createElement("input");input.type="file";input.accept=".pdf,image/jpeg,image/png,image/webp";
    input.onchange=()=>resolve(input.files?.[0]||null);
    input.oncancel=()=>resolve(null);
    input.click();
  });
}
export default function PlantProfile() {
  const router=useRouter();
  const {plantId:rawId}=useLocalSearchParams();
  const {token,user}=useAuth();
  const {colors}=useTheme();
  const explicitId=Array.isArray(rawId)?rawId[0]:rawId;
  const [selectedPlant,setSelectedPlant]=useState(null);
  const plantId=explicitId||user?.plant_id||selectedPlant;
  const [publicData,setPublicData]=useState(null);
  const [editor,setEditor]=useState(null);
  const [selected,setSelected]=useState(null);
  const [draft,setDraft]=useState({});
  const [dirty,setDirty]=useState(false);
  const [mode,setMode]=useState("published");
  const [gridWidth,setGridWidth]=useState(0);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const [notice,setNotice]=useState(null);

  useEffect(()=>{
    if (explicitId||user?.plant_id||!token) return;
    let live=true;
    apiGet("/master/my-plants",token).then(result=>{
      if(live)setSelectedPlant(result?.plants?.[0]?.id||null);
    }).catch(()=>{if(live)setSelectedPlant(null);});
    return ()=>{live=false;};
  },[explicitId,user?.plant_id,token]);
  const refresh=useCallback(async()=>{
    if(!token||!plantId){setLoading(false);return;}
    setLoading(true);setError(null);
    try {
      const published=await apiGet("/plant-profile/"+plantId,token);
      const editable=await apiGet("/plant-profile/"+plantId+"/editor",token).catch(()=>null);
      setPublicData(published);setEditor(editable);
    } catch(e){setError(apiErrorDetail(e,"Could not load this plant profile"));}
    finally{setLoading(false);}
  },[token,plantId]);
  useEffect(()=>{void refresh();},[refresh]);
  const editableSection=editor?.sections?.find(s=>s.key===selected);
  const publicSection=publicData?.sections?.find(s=>s.key===selected);
  const selectSection=key=>{
    const section=editor?.sections?.find(s=>s.key===key);
    setSelected(key);setMode("published");setDraft({...section?.answers});
    setDirty(false);setError(null);setNotice(null);
  };
  const change=(key,value)=>{setDraft(old=>({...old,[key]:value}));setDirty(true);setNotice(null);};
  const save=async()=>{
    if(!editableSection||!token||!plantId)return;
    setBusy(true);setError(null);setNotice(null);
    try{
      const result=await apiPut("/plant-profile/"+plantId+"/sections/"+selected,token,
        {answers:draft,expected_revision:editableSection.draft_revision});
      setEditor(old=>({...old,sections:old.sections.map(s=>s.key===selected?{...s,
        answers:{...draft},draft_revision:result.draft_revision,status:"draft"}:s)}));
      setDirty(false);setNotice("Draft saved. Only centrally approved details appear to customers.");
    }catch(e){setError(apiErrorDetail(e,"Could not save draft"));}
    finally{setBusy(false);}
  };
  const submit=async()=>{
    if(!editableSection||!token||!plantId)return;
    if(dirty){setError("Save your draft before submitting for review.");return;}
    setBusy(true);setError(null);setNotice(null);
    try{
      await apiPost("/plant-profile/"+plantId+"/sections/"+selected+"/submit",token,{});
      setEditor(old=>({...old,sections:old.sections.map(s=>s.key===selected?{...s,status:"pending_review"}:s)}));
      setMode("published");
      setNotice("Submitted for admin verification. Your currently published information is unchanged.");
    }catch(e){setError(apiErrorDetail(e,"Submission failed"));}
    finally{setBusy(false);}
  };
  const upload=async(key)=>{
    if(!token)return;
    try{
      let file=null;
      if(Platform.OS==="web")file=await chooseWebFile();
      else{
        const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();
        if(!permission.granted){setError("Photo-library access is required for scanning certificates.");return;}
        const selectedFile=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsEditing:false,quality:0.9});
        if(selectedFile.canceled)return;
        const asset=selectedFile.assets[0];
        file={uri:asset.uri,type:asset.mimeType||"image/jpeg",name:asset.fileName||"certificate.jpg"};
      }
      if(!file)return;
      setBusy(true);setError(null);
      const result=await apiUploadCertificate(token,file);
      change(key,result.path);
      setNotice("Certificate uploaded. Save Draft to attach it to your application.");
    }catch(e){setError(apiErrorDetail(e,"Certificate upload failed"));}
    finally{setBusy(false);}
  };
  const columns=gridWidth>=350?3:2;
  const docs=publicData?.documents||[];
  return <ThemedScreen><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{
    width:"100%",maxWidth:860,alignSelf:"center",padding:16,paddingBottom:130,gap:14}}>
    <Pressable accessibilityRole="button" onPress={()=>selected?setSelected(null):router.back()}
      style={{minHeight:44,flexDirection:"row",alignItems:"center",gap:8}}>
      <Ionicons name="arrow-back" color={colors.onSurface} size={22}/>
      <AppText style={{fontWeight:"700",fontSize:16}}>{selected?"Plant Profile":"Back"}</AppText>
    </Pressable>
    <AppText variant="title">{CARDS.find(c=>c.key===selected)?.title||(selected==="documents"?"Government Documents":"Plant Profile")}</AppText>
    <AppText variant="caption">{publicData?.plant_name||"RMC Plant"} · TrackMyRMC</AppText>
    {loading&&<ActivityIndicator size="large" color={colors.brand}/>}
    {error&&<View style={{backgroundColor:colors.errorSoft,padding:12,borderRadius:12,gap:7}}>
      <AppText style={{color:colors.error}}>{error}</AppText>
      <Pressable onPress={refresh}><AppText style={{color:colors.error,fontWeight:"700"}}>Refresh</AppText></Pressable>
    </View>}
    {notice&&<View style={{backgroundColor:colors.verifiedSoft,borderRadius:10,padding:12}}>
      <AppText style={{color:colors.success,fontWeight:"700"}}>{notice}</AppText>
    </View>}
    {!loading&&!publicData&&!error&&<Unavailable colors={colors}/>}
    {!selected&&publicData&&<>
      <View onLayout={event=>setGridWidth(event.nativeEvent.layout.width)}
        style={{flexDirection:"row",justifyContent:"space-between",flexWrap:"wrap",rowGap:8}}>
        {CARDS.map(card=><Pressable key={card.key} testID={"plant-profile-"+card.key}
          accessibilityRole="button" accessibilityLabel={card.title} onPress={()=>selectSection(card.key)}
          style={{width:columns===3?"32%":"49%",minHeight:108,backgroundColor:colors.surfaceSecondary,
            borderColor:colors.border,borderWidth:1,borderRadius:15,justifyContent:"center",alignItems:"center",gap:8,padding:8}}>
          <Ionicons name={card.icon} color={colors.brand} size={33}/>
          <AppText numberOfLines={3} style={{fontSize:12,lineHeight:17,fontWeight:"700",textAlign:"center"}}>{card.title}</AppText>
        </Pressable>)}
      </View>
      <Pressable accessibilityRole="button" testID="plant-profile-documents"
        onPress={()=>setSelected("documents")} style={{flexDirection:"row",alignItems:"center",gap:12,
          padding:14,borderColor:colors.border,borderWidth:1,borderRadius:14,minHeight:75,
          backgroundColor:colors.surfaceSecondary}}>
        <Ionicons name="document-text-outline" size={32} color={colors.success}/>
        <View style={{flex:1,gap:3}}>
          <AppText style={{fontWeight:"700",fontSize:14}}>Government Documents & Certifications</AppText>
          <AppText variant="caption">{docs.length?docs.length+" admin-reviewed certificate(s)":"Verified documents will appear here"}</AppText>
        </View>
        <Ionicons name="chevron-forward" size={19} color={colors.onSurfaceTertiary}/>
      </Pressable>
    </>}
    {selected==="documents"&&(docs.length?docs.map(doc=><View key={doc.key}
      style={{backgroundColor:colors.surfaceSecondary,borderColor:colors.border,borderWidth:1,
        borderRadius:12,padding:15,gap:5}}>
      <Ionicons name="shield-checkmark" color={colors.success} size={25}/>
      <AppText style={{fontSize:15,fontWeight:"700"}}>{doc.title}</AppText>
      <AppText variant="caption">Certificate: {doc.certificate_number}</AppText>
      <AppText variant="caption">Valid Until: {doc.valid_until}</AppText>
      <AppText style={{color:colors.success,fontWeight:"600",fontSize:12}}>Verified document on file</AppText>
    </View>):<Unavailable colors={colors}/>)}
    {!!CARDS.find(c=>c.key===selected)&&publicData&&<>
      {editableSection&&<>
        <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>
          <Action testID="profile-edit" title="Edit Form" colors={colors} outline={mode!=="edit"} onPress={()=>setMode("edit")}/>
          <Action testID="profile-preview" title="Preview" colors={colors} outline={mode!=="preview"} onPress={()=>setMode("preview")}/>
          <Action testID="profile-public" title="Published" colors={colors} outline={mode!=="published"} onPress={()=>setMode("published")}/>
        </View>
        <AppText variant="caption">Status: {editableSection.status.replace(/_/g," ")} · Revision {editableSection.draft_revision}</AppText>
      </>}
      {editableSection&&mode==="edit"?<>
        {editableSection.fields.map(field=>{
          if(field.depends_on&&draft[field.depends_on]!=="yes")return null;
          if(field.kind==="attachment")return <View key={field.key} style={{gap:6}}>
            <AppText style={{fontWeight:"600"}}>{field.label}</AppText>
            <Action title={draft[field.key]?"Replace Certificate":"Upload Certificate (PDF / Image)"}
              colors={colors} outline disabled={busy} onPress={()=>upload(field.key)}/>
            {!!draft[field.key]&&<AppText style={{color:colors.success,fontSize:12}}>✓ Document attached</AppText>}
          </View>;
          if(field.kind==="yesno")return <View key={field.key} style={{gap:6}}>
            <AppText style={{fontWeight:"600"}}>{field.label}</AppText>
            <View style={{flexDirection:"row",gap:9}}>
              {["yes","no"].map(value=>{
                const active=draft[field.key]===value,positive=value==="yes";
                return <Pressable key={value} testID={"answer-"+field.key+"-"+value}
                  accessibilityRole="radio" accessibilityState={{checked:active}}
                  onPress={()=>change(field.key,value)} style={{flex:1,minHeight:45,borderRadius:11,borderWidth:active?2:1,
                    flexDirection:"row",justifyContent:"center",alignItems:"center",gap:7,
                    borderColor:active?(positive?colors.success:colors.error):colors.border,
                    backgroundColor:active?(positive?colors.verifiedSoft:colors.errorSoft):colors.surfaceSecondary}}>
                  <Ionicons name={active?(positive?"checkbox":"close-circle"):"square-outline"} size={20}
                    color={active?(positive?colors.success:colors.error):colors.onSurfaceTertiary}/>
                  <AppText style={{fontWeight:active?"800":"400",color:active?(positive?colors.success:colors.error):colors.onSurface}}>{positive?"Yes":"No"}</AppText>
                </Pressable>;
              })}
            </View>
          </View>;
          if(field.kind.startsWith("choice:"))return <View key={field.key} style={{gap:6}}>
            <AppText style={{fontWeight:"600"}}>{field.label}</AppText>
            <View style={{flexDirection:"row",gap:7,flexWrap:"wrap"}}>
              {field.kind.slice(7).split("|").map(option=><Pressable key={option} onPress={()=>change(field.key,option)}
                accessibilityRole="radio" accessibilityState={{checked:draft[field.key]===option}}
                style={{padding:10,borderRadius:10,borderWidth:1,
                  borderColor:draft[field.key]===option?colors.success:colors.border,
                  backgroundColor:draft[field.key]===option?colors.verifiedSoft:colors.surfaceSecondary}}>
                <AppText style={{color:draft[field.key]===option?colors.success:colors.onSurface,
                  fontWeight:draft[field.key]===option?"700":"400"}}>{option}</AppText>
              </Pressable>)}
            </View>
          </View>;
          return <View key={field.key} style={{gap:6}}>
            <AppText style={{fontWeight:"600"}}>{field.label}</AppText>
            <TextInput testID={"field-"+field.key} accessibilityLabel={field.label} value={draft[field.key]||""}
              onChangeText={text=>change(field.key,text)}
              keyboardType={["number","integer","latitude","longitude"].includes(field.kind)?"decimal-pad":
                field.kind==="email"?"email-address":field.kind==="phone"?"phone-pad":"default"}
              placeholder={field.kind==="date"?"YYYY-MM-DD":field.kind==="grades"?"M20,M25,M30":"Enter "+field.label.toLowerCase()}
              placeholderTextColor={colors.onSurfaceTertiary}
              style={{borderRadius:11,borderColor:colors.border,borderWidth:1,
                backgroundColor:colors.surfaceSecondary,color:colors.onSurface,paddingHorizontal:12,minHeight:46,fontSize:15}}/>
          </View>;
        })}
        <View style={{flexDirection:"row",gap:8}}>
          <View style={{flex:1}}><Action testID="profile-save" title={busy?"Saving...":"Save Draft"}
            colors={colors} disabled={busy} onPress={save}/></View>
          <View style={{flex:1}}><Action testID="profile-submit" title={busy?"Submitting...":"Submit for Review"}
            colors={colors} outline disabled={busy||dirty} onPress={submit}/></View>
        </View>
        <AppText variant="caption">Save is private. Only approved positive responses are published.</AppText>
      </>:<DetailRows colors={colors} draft={!!editableSection&&mode==="preview"}
        details={editableSection&&mode==="preview"?draftDetails(editableSection.fields,draft):publicSection?.details||[]}/>}
    </>}
  </ScrollView></ThemedScreen>;
}
