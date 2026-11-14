import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { OwnerFrame, OwnerGlass, useOwnerBottomSpace, useOwnerPalette } from "@/src/owner/OwnerUI";

type Request = { id: string; plant_name: string; site_name: string; address: string; contact: string; mobile: string;
  grade: string; quantity: string; date: string; time: string; pump_required: boolean; notes: string;
  plant_response: string | null; expires_at: string };

export default function ProvisionalRequests() {
  const { token } = useAuth();
  const p = useOwnerPalette();
  const bottom = useOwnerBottomSpace();
  const { data, loading, error, refetch } = useGet<{ requests: Request[] }>("/owner/provisional-requests");
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const respond = async () => {
    if (!token || !selected || busy) return;
    setBusy(true); setFailure("");
    try {
      await apiPost(`/owner/provisional-requests/${selected}/respond`, token, { message });
      setSelected(null); setMessage(""); await refetch();
    } catch (e: any) { setFailure(e.detail || "Could not send the response"); }
    finally { setBusy(false); }
  };
  return <OwnerFrame title="Provisional requests" subtitle="These are enquiries, not confirmed orders or reservations">
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottom, gap: 12 }}>
      {loading && !data ? <AppText>Loading requests…</AppText> : null}
      {error ? <View style={{ gap: 8 }}><AppText>{error}</AppText><Button label="Retry" onPress={refetch} /></View> : null}
      {!loading && !error && !data?.requests.length ? <AppText>No open provisional requests.</AppText> : null}
      {data?.requests.map((request) => <OwnerGlass key={request.id} style={{ padding: 16, gap: 8 }}>
        <AppText variant="heading">{request.plant_name} · {request.grade} · {request.quantity} m³</AppText>
        <AppText variant="caption">NONBINDING · {request.date} {request.time} · Pump {request.pump_required ? "required" : "not required"}</AppText>
        <AppText>{request.site_name} · {request.address}</AppText>
        <AppText variant="caption">Site contact: {request.contact} · {request.mobile}</AppText>
        {request.notes ? <AppText variant="caption">Notes: {request.notes}</AppText> : null}
        {request.plant_response ? <AppText variant="caption">Your response: {request.plant_response}</AppText> : null}
        {selected === request.id ? <View style={{ gap: 8 }}>
          <Input label="Nonbinding response" value={message} onChangeText={setMessage} placeholder="For example, contact us for a current quotation" />
          {failure ? <AppText color={p.text}>{failure}</AppText> : null}
          <Button label="Send response" onPress={respond} loading={busy} disabled={busy || !message.trim()} />
          <Button label="Cancel" variant="outline" onPress={() => { setSelected(null); setFailure(""); }} />
        </View> : <Pressable accessibilityRole="button" onPress={() => { setSelected(request.id); setMessage(request.plant_response || ""); setFailure(""); }}>
          <AppText color={p.accent}>Respond to request</AppText>
        </Pressable>}
      </OwnerGlass>)}
    </ScrollView>
  </OwnerFrame>;
}
