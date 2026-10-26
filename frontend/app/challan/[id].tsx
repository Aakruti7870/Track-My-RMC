import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Share, View } from "react-native";
import { WebView } from "react-native-webview";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ErrorView } from "@/src/components/StateViews";
import { buildChallanHtml, type ChallanDesign, type PlantPrint, type ChallanPrintData } from "@/src/challan/print";

type PrintPayload = {
  plant: PlantPrint;
  design: ChallanDesign;
  challans: ChallanPrintData[];
  play_store_url: string;
};
export default function ChallanScreen() {
  const router=useRouter();
  const { id } = useLocalSearchParams<{id:string}>();
  const { colors } = useTheme();
  const toast=useToast();
  const [index,setIndex]=useState(0);
  const {data,error,loading,reload}=useGet<PrintPayload>(
    typeof id==="string" && id ? "/challan-design/orders/" + id : null
  );
  const item=data?.challans[index]||data?.challans[0];
  const html=useMemo(()=>data&&item
    ?buildChallanHtml(data.plant,data.design,item):"",
    [data,item]);
  const share=async ()=>{
    if(!data||!item)return;
    try { await Share.share({
      message: "Delivery Challan: "+item.challan_number+"\nOrder: "+item.order_number+
        "\nPlant: "+data.plant.name+"\nCustomer: "+item.customer_name+
        "\nGrade: "+item.grade+"\nQuantity: "+item.quantity_m3+
        " m³\nTM: "+(item.mixer_number||""),
    }); }catch {toast("Could not open share sheet","error");}
  };
  return <View style={{flex:1,backgroundColor:colors.surface}}>
    <ScrollView contentContainerStyle={{gap:12,padding:16,paddingBottom:42}}>
      <Pressable testID="challan-back" onPress={()=>router.back()} style={{flexDirection:"row",alignItems:"center",gap:10,paddingVertical:10}}>
        <Ionicons name="arrow-back" size={23} color={colors.onSurface}/>
        <AppText variant="title">Delivery Challan</AppText>
      </Pressable>
      {loading&&!data?<AppText>Loading issued challans...</AppText>:null}
      {error?<ErrorView message={error} onRetry={reload}/>:null}
      {data&&item?<React.Fragment>
        <Card style={{gap:8}}>
          <AppText variant="heading">{data.plant.name}</AppText>
          <AppText variant="caption">Issued challan {item.challan_number} · {data.design.is_custom?"Plant custom design":"Standard plant design"}</AppText>
          {data.challans.length>1?<ScrollView horizontal contentContainerStyle={{gap:8}}>
            {data.challans.map((c,i)=><Pressable key={c.id||i} accessibilityRole="button" onPress={()=>setIndex(i)}
              style={{padding:10,borderWidth:1,borderRadius:8,borderColor:i===index?colors.brand:colors.border}}>
              <AppText>Load {c.load_number??i+1}</AppText>
            </Pressable>)}
          </ScrollView>:null}
          <AppText variant="caption">A4 portrait · 2 identical copies · original dispatch data</AppText>
        </Card>
        <Card style={{padding:8,gap:8}}>
          {Platform.OS==="web"
            ? React.createElement("iframe",{srcDoc:html,title:"Print two-copy delivery challan",
                style:{width:"100%",height:760,border:"1px solid #cbd5e1",backgroundColor:"#fff"}} as any)
            :<WebView source={{html}} originWhitelist={["*"]} javaScriptEnabled
                 style={{height:620,width:"100%",backgroundColor:"#fff"}} />}
          <AppText variant="caption">In the web preview select Print / Save as PDF, A4 and 100% scale. Android preview supports inspection; native PDF export is not yet connected.</AppText>
        </Card>
        <Button testID="challan-share" label="Share Challan Details" onPress={()=>void share()} />
      </React.Fragment>:null}
    </ScrollView>
  </View>;
}
