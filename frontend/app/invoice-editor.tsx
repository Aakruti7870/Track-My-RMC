import React, { useCallback, useEffect, useState } from "react";
import { Alert, ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiGet, apiPost, apiPut } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";

type Line = { grade: string; hsn: string; quantity_m3: string; rate_per_m3: string; gst_rate: string };
type Draft = {
  id: string; version: number; status: string; buyer_id: string | null;
  invoice_date: string; manual_invoice_number: string | null;
  seller_name: string; seller_gstin: string | null; seller_address: string; seller_state_code: string | null;
  buyer_name: string; buyer_gstin: string | null; buyer_address: string; buyer_state_code: string | null;
  place_of_supply: string | null; challan_display_reference: string | null; note: string; lines: Line[];
  issued_invoice_id?: string | null;
};
type Buyer = {
  id: string; customer_id?: string | null; company_name: string; gstin?: string | null;
  billing_address: string; state_code: string;
};
type Price = { grade: string; rate_per_m3: string; gst_rate: string; effective_from: string };
type History = { order_id: string; order_number: string; grade: string; quantity_m3: string; amount: string; status: string };
type Ledger = { invoice_id: string; invoice_number: string; total: string; paid: string; balance: string; status: string };
type Order = { order_id: string; order_number: string; plant_id: string; customer_id: string;
  customer_name: string; site_address: string; grade: string; quantity_m3: string; order_total: string; status: string };
type Workspace = {
  order: Order; draft: Draft | null; buyers: Buyer[]; prices: Price[];
  challans: { id: string; challan_number: string; quantity_m3: string; status: string }[];
  order_history: History[]; ledger: Ledger[];
};
const rupees=(value: string | number) => "₹" + Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const emptyToNull=(value: string | null | undefined) => value?.trim() || null;

export default function InvoiceEditor() {
  const { orderId, invoiceId } = useLocalSearchParams<{ orderId?: string; invoiceId?: string }>();
  const { token } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 720;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveBuyer, setSaveBuyer] = useState(false);
  const [buyerList, setBuyerList] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [issuedId, setIssuedId] = useState<string | null>(typeof invoiceId === "string" ? invoiceId : null);
  const [html, setHtml] = useState("");
  const [previewVisible, setPreviewVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!token || typeof orderId !== "string") { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const result = await apiGet<Workspace>(`/invoice-workspace/orders/${encodeURIComponent(orderId)}`, token);
      setWorkspace(result); setDraft(result.draft);
      if (result.draft?.issued_invoice_id) setIssuedId(result.draft.issued_invoice_id);
    } catch (e: unknown) { setError(apiErrorDetail(e, "Could not load invoice workspace")); }
    finally { setLoading(false); }
  }, [orderId, token]);

  useEffect(() => { if (orderId) { void refresh(); } else { setLoading(false); } }, [orderId, refresh]);

  const update=(key: keyof Draft, value: string | null) => {
    setConfirmed(false);
    setDraft(old => old ? { ...old, [key]: value } : old);
  };
  const line=(idx: number, key: keyof Line, value: string) => {
    setConfirmed(false);
    setDraft(old => old ? { ...old, lines: old.lines.map((item, i) => i === idx ? {...item,[key]: value} : item) } : old);
  };
  const setBuyer=(buyer: Buyer) => {
    setDraft(old => old ? {
      ...old, buyer_id: buyer.id, buyer_name: buyer.company_name, buyer_gstin: buyer.gstin ?? null,
      buyer_address: buyer.billing_address, buyer_state_code: buyer.state_code,
      place_of_supply: buyer.state_code,
    } : old);
    setBuyerList(false); setSaveBuyer(false); setConfirmed(false);
  };
  const selectPrice=(idx: number, price: Price) => {
    setDraft(old => old ? {...old,lines:old.lines.map((item,i) => i===idx ?
      {...item,grade:price.grade,rate_per_m3:price.rate_per_m3,gst_rate:price.gst_rate}:item)}:old);
    setConfirmed(false);
  };
  const getPayload=() => {
    if (!draft) return null;
    return {
      version:draft.version,invoice_date:draft.invoice_date,
      manual_invoice_number:emptyToNull(draft.manual_invoice_number),
      seller_name:draft.seller_name,seller_gstin:emptyToNull(draft.seller_gstin),
      seller_address:draft.seller_address,seller_state_code:draft.seller_state_code ?? "",
      buyer_id:draft.buyer_id,buyer_name:draft.buyer_name,buyer_gstin:emptyToNull(draft.buyer_gstin),
      buyer_address:draft.buyer_address,buyer_state_code:draft.buyer_state_code ?? "",
      place_of_supply:draft.place_of_supply ?? "",challan_display_reference:emptyToNull(draft.challan_display_reference),
      note:draft.note,lines:draft.lines,change_reason:emptyToNull(changeReason),save_buyer:saveBuyer,
    };
  };
  const save=async ():Promise<boolean> => {
    if (!token || !draft) return false;
    const payload=getPayload(); if (!payload) return false;
    setPending(true);
    try {
      const answer=await apiPut<{version:number,buyer_id?:string}>(`/invoice-workspace/drafts/${draft.id}`, token, payload);
      setDraft(old=>old?{...old,version:answer.version,buyer_id:answer.buyer_id||old.buyer_id}:old);
      setSaveBuyer(false); setChangeReason(""); setConfirmed(false);
      toast("Draft saved", "success");
      return true;
    } catch(e:unknown) {toast(apiErrorDetail(e,"Draft save failed"),"error"); return false;}
    finally {setPending(false);}
  };
  const preview = async () => {
    if (!token) return;
    setPending(true);
    try {
      const path=issuedId ? `/invoices/${issuedId}/print` :
        draft ? `/invoice-workspace/drafts/${draft.id}/preview` : "";
      if (!path) throw {status:400,detail:"Prepare a challan to create an invoice draft"};
      const result=await apiGet<{html:string}>(path,token);
      setHtml(result.html); setPreviewVisible(true);
    } catch(e:unknown) {toast(apiErrorDetail(e,"Preview is unavailable"),"error");}
    finally {setPending(false);}
  };
  const issue=async () => {
    if (!token || !draft || !confirmed) return;
    setPending(true);
    try {
      // Save any edits first. The server enforces optimistic draft versions.
      const payload=getPayload();
      const updated=await apiPut<{version:number}>(`/invoice-workspace/drafts/${draft.id}`,token,payload);
      const result=await apiPost<{invoice_id:string,invoice_number:string}>(
        `/invoice-workspace/drafts/${draft.id}/issue`,token,{version:updated.version,confirmed:true});
      setIssuedId(result.invoice_id); setConfirmed(false); setSaveBuyer(false);
      toast(`Invoice ${result.invoice_number} issued`,"success");
      await refresh();
    } catch(e:unknown) {toast(apiErrorDetail(e,"Invoice issue failed"),"error");}
    finally {setPending(false);}
  };
  const confirmIssue = () => {
    if (!confirmed) return toast("Confirm buyer, challans and the accepted order amount first", "error");
    if (Platform.OS === "web") { void issue(); return; }
    Alert.alert("Issue tax invoice?", "This creates an immutable financial document. Check all fields and the buyer before continuing.",
      [{text:"Review",style:"cancel"},{text:"Issue Invoice",onPress:()=>{void issue();}}]);
  };
  const openWebPrint = () => {
    if (Platform.OS !== "web" || !html) return;
    // Print documents are only opened from an explicit user tap.
    const win=window.open("", "_blank");
    if (!win) return toast("Allow popups to open the print document","error");
    win.document.open(); win.document.write(html); win.document.close();
  };

  const field = (label: string, key: keyof Draft, max = 200, keyboardType?: "numeric" | "default") => (
    <View key={key} style={{ flexBasis: wide ? "48%" : "100%", flexGrow:1, minWidth:0 }}>
      <Input label={label} value={String(draft?.[key] ?? "")} onChangeText={value=>update(key,value)}
        maxLength={max} keyboardType={keyboardType || "default"} editable={!issuedId}/>
    </View>
  );
  const lineField = (i:number, label:string, key:keyof Line, numeric=false) => (
    <View key={key} style={{ flexBasis:wide?"31%":"47%",flexGrow:1,minWidth:0 }}>
      <Input label={label} value={draft?.lines[i]?.[key]??""} onChangeText={v=>line(i,key,v)}
        maxLength={30} keyboardType={numeric?"numeric":"default"} editable={!issuedId}/>
    </View>
  );
  return (
    <View style={{flex:1,backgroundColor:colors.surface}}>
      <View style={{height:insets.top}}/>
      <View style={[styles.header,{borderBottomColor:colors.divider}]}>
        <Pressable onPress={()=>router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" color={colors.onSurface} size={24}/>
        </Pressable>
        <View style={{flex:1}}>
          <AppText variant="title">Generate Invoice</AppText>
          <AppText variant="caption">Standard TrackMyRMC tax invoice</AppText>
        </View>
        <Ionicons name="receipt-outline" color={colors.brand} size={26}/>
      </View>
      {loading ? <ActivityIndicator style={{marginTop:40}} color={colors.brand}/> :
      error ? <View style={{padding:spacing.lg,gap:spacing.md}}><AppText>{error}</AppText><Button label="Retry" onPress={()=>{void refresh();}}/></View> :
      <ScrollView contentContainerStyle={{padding:spacing.lg,paddingBottom:80,alignItems:"center"}}>
        <View style={{width:"100%",maxWidth:980,gap:spacing.md}}>
          {workspace ? <Card style={{gap:spacing.sm}}>
            <AppText variant="heading">{workspace.order.order_number}</AppText>
            <AppText variant="caption">{workspace.order.customer_name} · {workspace.order.grade} · {workspace.order.quantity_m3} m³</AppText>
            <AppText variant="caption">Accepted order total: {rupees(workspace.order.order_total)} · {workspace.order.status}</AppText>
          </Card> : null}

          {issuedId ? <Card style={{gap:spacing.md}}>
            <AppText variant="heading">Issued Tax Invoice</AppText>
            <AppText variant="caption">Financial details are locked after issuance. The document remains available in Billing & Ledger.</AppText>
            <Button label="Preview Issued Invoice" onPress={()=>{void preview();}} loading={pending}/>
          </Card> : draft ? <>
            <Card style={{gap:spacing.md}}>
              <AppText variant="heading">Seller (Logged-in Plant)</AppText>
              <AppText variant="caption">Display fields can be corrected; GSTIN must match the plant's verified billing profile. Changing the seller legal name requires Plant Owner authorization and a reason.</AppText>
              <View style={[styles.fields,{gap:spacing.sm}]}>
                {field("Seller Company Name","seller_name")}
                {field("Seller GSTIN","seller_gstin",15)}
                {field("Seller Address","seller_address",2000)}
                {field("Seller State Code","seller_state_code",2,"numeric")}
              </View>
            </Card>
            <Card style={{gap:spacing.md}}>
              <View style={styles.between}>
                <AppText variant="heading">Buyer (Bill To)</AppText>
                <Pressable onPress={()=>setBuyerList(v=>!v)} accessibilityRole="button"
                  style={{padding:spacing.sm,backgroundColor:colors.surfaceSecondary,borderRadius:radius.md}}>
                  <AppText style={{fontFamily:fonts.semibold,color:colors.brand}}>Saved buyers <Ionicons name={buyerList?"chevron-up":"chevron-down"} size={14}/></AppText>
                </Pressable>
              </View>
              {buyerList ? <View style={{gap:spacing.xs}}>
                {(workspace?.buyers||[]).length ? workspace?.buyers.map(b=>
                  <Pressable key={b.id} onPress={()=>setBuyer(b)} accessibilityRole="button"
                    style={{padding:spacing.md,borderColor:colors.border,borderWidth:1,borderRadius:radius.sm}}>
                    <AppText>{b.company_name}</AppText>
                    <AppText variant="caption">{b.gstin||"Unregistered buyer"} · {b.state_code}</AppText>
                  </Pressable>) : <AppText variant="caption">No saved buyers for this plant.</AppText>}
              </View>:null}
              <View style={[styles.fields,{gap:spacing.sm}]}>
                {field("Buyer Company Name","buyer_name")}
                {field("Buyer GSTIN (optional if unregistered)","buyer_gstin",15)}
                {field("Buyer Billing Address","buyer_address",2000)}
                {field("Buyer State Code","buyer_state_code",2,"numeric")}
                {field("Place of Supply State Code","place_of_supply",2,"numeric")}
              </View>
              <Pressable accessibilityRole="checkbox" accessibilityState={{checked:saveBuyer}}
                onPress={()=>setSaveBuyer(v=>!v)} style={[styles.check,{borderColor:colors.border}]}>
                <Ionicons name={saveBuyer?"checkbox":"square-outline"} color={colors.brand} size={22}/>
                <AppText>Save / update buyer for future invoices at this plant</AppText>
              </Pressable>
            </Card>

            <Card style={{gap:spacing.md}}>
              <AppText variant="heading">Invoice & Challan References</AppText>
              <View style={[styles.fields,{gap:spacing.sm}]}>
                {field("Invoice Date YYYY-MM-DD","invoice_date",10)}
                {field("Invoice No. (owner override; blank = automatic)","manual_invoice_number",16)}
                {field("Printed Challan Reference","challan_display_reference",400)}
              </View>
              <AppText variant="caption">Source challans (cannot be reassigned):</AppText>
              {(workspace?.challans||[]).map(c=><AppText key={c.id} variant="caption">{c.challan_number} · {c.quantity_m3} m³ · {c.status}</AppText>)}
            </Card>

            <Card style={{gap:spacing.md}}>
              <AppText variant="heading">Concrete Grades & Itemized Charges</AppText>
              {draft.lines.map((item,i)=><View key={i} style={{gap:spacing.sm, paddingBottom:spacing.md,borderBottomWidth:1,borderBottomColor:colors.divider}}>
                <View style={styles.between}><AppText style={{fontFamily:fonts.semibold}}>Line {i+1}</AppText>
                  {draft.lines.length>1 ? <Pressable accessibilityRole="button" onPress={()=>setDraft(d=>d?{...d,lines:d.lines.filter((_,index)=>index!==i)}:d)}>
                    <Ionicons name="trash-outline" color={colors.error} size={20}/>
                  </Pressable>:null}</View>
                <View style={[styles.fields,{gap:spacing.sm}]}>
                  {lineField(i,"Grade","grade")}
                  {lineField(i,"HSN","hsn",true)}
                  {lineField(i,"Quantity m³","quantity_m3",true)}
                  {lineField(i,"Rate per m³","rate_per_m3",true)}
                  {lineField(i,"GST %","gst_rate",true)}
                </View>
                <AppText variant="caption">Price chart (tap to apply current plant rate)</AppText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{flexDirection:"row",gap:spacing.sm}}>
                    {(workspace?.prices||[]).map((p,index)=><Pressable key={p.grade+"-"+index}
                      onPress={()=>selectPrice(i,p)} style={{padding:spacing.sm,borderColor:colors.border,borderWidth:1,borderRadius:radius.sm}}>
                      <AppText style={{color:colors.brand}}>{p.grade} · {rupees(p.rate_per_m3)}</AppText>
                      <AppText variant="caption">GST {p.gst_rate}%</AppText>
                    </Pressable>)}
                  </View>
                </ScrollView>
              </View>)}
              <Button label="Add Line Item" variant="outline" onPress={()=>setDraft(d=>d?{...d,lines:[...d.lines,{grade:"M25",hsn:"38245010",quantity_m3:"1",rate_per_m3:"0",gst_rate:"18"}]}:d)} disabled={draft.lines.length>=50}/>
              <AppText variant="caption">Editing rate, grade or quantity does not modify the original order. The final invoice must reconcile with the accepted order amount before issue.</AppText>
            </Card>

            <Card style={{gap:spacing.md}}>
              <AppText variant="heading">Remarks & Audit</AppText>
              <View style={[styles.fields,{gap:spacing.sm}]}>
                {field("Invoice Remarks","note",2000)}
                <View style={{flexBasis:wide?"48%":"100%",flexGrow:1}}>
                  <Input label="Reason for Manual Corrections" value={changeReason} onChangeText={setChangeReason} maxLength={500} />
                </View>
              </View>
              <Button label="Save Invoice Draft" onPress={()=>{void save();}} loading={pending}/>
              <Button label="Preview Standard A4 Invoice" variant="outline" onPress={()=>{void preview();}} disabled={pending}/>
              <Pressable accessibilityRole="checkbox" accessibilityState={{checked:confirmed}}
                onPress={()=>setConfirmed(v=>!v)} style={[styles.check,{borderColor:colors.border}]}>
                <Ionicons name={confirmed?"checkbox":"square-outline"} size={23} color={colors.brand}/>
                <AppText style={{flex:1}}>I verified buyer, taxes, challans and the approved order total; issue the final tax invoice.</AppText>
              </Pressable>
              <Button label="Issue Final Tax Invoice" onPress={confirmIssue} disabled={!confirmed||pending} loading={pending}/>
            </Card>
          </> : !issuedId ? <Card><AppText>Prepare the order's challan before opening an invoice draft.</AppText></Card> : null}

          {workspace ? <Card style={{gap:spacing.md}}>
            <AppText variant="heading">Linked Business Data</AppText>
            <AppText variant="caption">Read-only historical records from this plant and this order's customer.</AppText>
            <AppText style={{fontFamily:fonts.semibold}}>Order History</AppText>
            {workspace.order_history.length ? workspace.order_history.map(o=>
              <View key={o.order_id} style={[styles.history,{borderBottomColor:colors.divider}]}>
                <AppText>{o.order_number} · {o.grade} · {o.quantity_m3} m³</AppText>
                <AppText variant="caption">{rupees(o.amount)} · {o.status}</AppText>
              </View>) : <AppText variant="caption">No previous orders.</AppText>}
            <AppText style={{fontFamily:fonts.semibold}}>Billing & Ledger</AppText>
            {workspace.ledger.length ? workspace.ledger.map(i=>
              <View key={i.invoice_id} style={[styles.history,{borderBottomColor:colors.divider}]}>
                <AppText>{i.invoice_number} · {i.status}</AppText>
                <AppText variant="caption">Total {rupees(i.total)} · Paid {rupees(i.paid)} · Balance {rupees(i.balance)}</AppText>
              </View>) : <AppText variant="caption">No previous invoices.</AppText>}
          </Card>:null}
        </View>
      </ScrollView>}

      <Modal visible={previewVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={()=>setPreviewVisible(false)}>
        <View style={{flex:1,backgroundColor:colors.surface,paddingTop:insets.top}}>
          <View style={[styles.header,{borderColor:colors.divider}]}>
            <Pressable accessibilityRole="button" onPress={()=>setPreviewVisible(false)}>
              <Ionicons name="close" size={24} color={colors.onSurface}/>
            </Pressable>
            <View style={{flex:1}}><AppText variant="title">Invoice Preview</AppText>
              <AppText variant="caption">Standard A4 layout · Fit-to-page print CSS</AppText></View>
            {Platform.OS==="web" ? <Button label="Print / PDF" size="sm" fullWidth={false} onPress={openWebPrint}/> : null}
          </View>
          {Platform.OS==="web" ? <View style={{flex:1,padding:spacing.lg}}>
            <iframe title="Invoice Preview" srcDoc={html} sandbox="allow-modals" style={{width:"100%",height:"100%",border:0}}/>
          </View> :
            <WebView originWhitelist={["about:blank"]} source={{html}} javaScriptEnabled={false}
              style={{flex:1}} />}
          {Platform.OS!=="web" ? <AppText variant="caption" style={{textAlign:"center",padding:spacing.md}}>
            Native printing requires a supported device print service; the preview does not transmit customer data to external sites.
          </AppText> : null}
        </View>
      </Modal>
    </View>
  );
}
const styles=StyleSheet.create({
  header:{flexDirection:"row",alignItems:"center",gap:spacing.md,paddingHorizontal:spacing.lg,paddingVertical:spacing.md,borderBottomWidth:StyleSheet.hairlineWidth},
  between:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:spacing.sm},
  fields:{flexDirection:"row",flexWrap:"wrap"},
  check:{flexDirection:"row",alignItems:"center",gap:spacing.sm,padding:spacing.md,borderWidth:1,borderRadius:radius.md},
  history:{gap:3,paddingVertical:spacing.sm,borderBottomWidth:StyleSheet.hairlineWidth},
});
