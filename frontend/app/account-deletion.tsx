import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost, apiPublicPost, requestOtp } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { spacing } from "@/src/theme/tokens";

type DeletionRequest = {
  id: string;
  status: string;
  reason?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
};

type PublicPhase = "identify" | "verify" | "submitted";

export default function AccountDeletion() {
  const { token } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { data, loading, refetch } = useGet<{ request: DeletionRequest | null }>(token ? "/account-deletion/status" : null);

  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [publicPhase, setPublicPhase] = useState<PublicPhase>("identify");
  const [deliveryText, setDeliveryText] = useState("");

  const requestSignedInDeletion = async () => {
    if (!token) return;
    if (confirm.trim().toUpperCase() !== "DELETE") return toast("Type DELETE to confirm", "error");
    setBusy(true);
    try {
      await apiPost("/account-deletion/request", token, { confirm: "DELETE", reason: reason.trim() || null });
      toast("Deletion request submitted", "success");
      setConfirm("");
      refetch();
    } catch (e: any) {
      toast(e.detail || "Request failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await apiPost("/account-deletion/cancel", token);
      toast("Deletion request cancelled", "success");
      refetch();
    } catch (e: any) {
      toast(e.detail || "Cancel failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const sendPublicCode = async () => {
    const value = identifier.trim();
    if (value.length < 3) return toast("Enter your registered mobile number or email", "error");
    setBusy(true);
    try {
      const response = await requestOtp(value);
      setDeliveryText(response.channel === "email" ? "Verification code sent by email." : "Verification code sent by SMS.");
      setCode("");
      setPublicPhase("verify");
      toast("Verification code sent", "success");
    } catch (e: any) {
      toast(e.detail || "Could not send verification code", "error");
    } finally {
      setBusy(false);
    }
  };

  const submitPublicDeletion = async () => {
    if (confirm.trim().toUpperCase() !== "DELETE") return toast("Type DELETE to confirm", "error");
    if (code.trim().length < 4) return toast("Enter the verification code", "error");
    setBusy(true);
    try {
      await apiPublicPost("/account-deletion/public-request", {
        identifier: identifier.trim(),
        code: code.trim(),
        confirm: "DELETE",
        reason: reason.trim() || null,
      });
      setPublicPhase("submitted");
      setCode("");
      setConfirm("");
      toast("Deletion request submitted", "success");
    } catch (e: any) {
      toast(e.detail || "Could not submit deletion request", "error");
    } finally {
      setBusy(false);
    }
  };

  const req = data?.request;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 112, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        <Card style={{ gap: spacing.sm }}>
          <AppText variant="caption" color={colors.brand}>TRACK MY RMC · ACCOUNT CONTROL</AppText>
          <AppText variant="title">Delete Account</AppText>
          <AppText variant="bodyMuted">
            Request deletion of your TrackMyRMC sign-in identity and personal account data. You can request deletion without signing in by verifying your registered mobile number or email.
          </AppText>
        </Card>

        <Card style={{ gap: spacing.sm }}>
          <AppText variant="heading">Before requesting deletion</AppText>
          <AppText variant="caption">Your sign-in identity, personal profile and active sessions are removed or anonymized when deletion is completed.</AppText>
          <AppText variant="caption">Orders, challans, invoices and other statutory transaction records may be retained only where required for legal, tax, fraud-prevention or accounting obligations.</AppText>
          <AppText variant="caption">Plant Owners must transfer or disable owned plants before deletion can be completed.</AppText>
        </Card>

        {token ? (
          <>
            {loading && !data ? <Skeleton height={120} /> : null}
            {req?.status === "PENDING" ? (
              <Card style={{ gap: spacing.md }}>
                <AppText variant="heading">Deletion request pending</AppText>
                <AppText variant="bodyMuted">Submitted {req.created_at ? new Date(req.created_at).toLocaleString() : "recently"}.</AppText>
                {req.reason ? <AppText variant="caption">Reason: {req.reason}</AppText> : null}
                <AppText variant="caption">You can cancel the request until it is completed.</AppText>
                <Button label="Cancel deletion request" variant="outline" onPress={cancel} loading={busy} />
              </Card>
            ) : (
              <Card style={{ gap: spacing.md }}>
                <AppText variant="heading">Signed-in request</AppText>
                <Input label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="Why are you deleting your account?" />
                <Input label='Type "DELETE" to confirm' value={confirm} onChangeText={setConfirm} autoCapitalize="characters" autoCorrect={false} />
                <Button label="Request Account Deletion" onPress={requestSignedInDeletion} loading={busy} />
              </Card>
            )}
          </>
        ) : publicPhase === "submitted" ? (
          <Card style={{ gap: spacing.sm }}>
            <AppText variant="heading">Deletion request submitted</AppText>
            <AppText variant="bodyMuted">Your verified request has been recorded. TrackMyRMC will complete deletion subject to required operational and legal retention checks.</AppText>
          </Card>
        ) : (
          <Card style={{ gap: spacing.md }}>
            <AppText variant="heading">Verify account ownership</AppText>
            <AppText variant="caption">No sign-in is required. We send a one-time verification code to your registered mobile number or email.</AppText>
            <Input
              label="Registered mobile number or email"
              value={identifier}
              onChangeText={(value) => { setIdentifier(value); setDeliveryText(""); }}
              placeholder="Mobile number or email"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={publicPhase === "identify"}
            />
            {publicPhase === "identify" ? (
              <Button label="Send Verification Code" onPress={sendPublicCode} loading={busy} />
            ) : (
              <>
                {deliveryText ? <AppText variant="caption" color={colors.brand}>{deliveryText}</AppText> : null}
                <Input label="Verification code" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 8))} placeholder="Enter OTP" keyboardType="number-pad" maxLength={8} />
                <Input label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="Why are you deleting your account?" />
                <Input label='Type "DELETE" to confirm' value={confirm} onChangeText={setConfirm} autoCapitalize="characters" autoCorrect={false} />
                <Button label="Submit Verified Deletion Request" onPress={submitPublicDeletion} loading={busy} />
                <Button label="Change Mobile / Email" variant="outline" onPress={() => { setPublicPhase("identify"); setCode(""); setDeliveryText(""); }} disabled={busy} />
              </>
            )}
          </Card>
        )}

        <AppText variant="caption" center>Privacy & support: support@goldetech.com</AppText>
      </ScrollView>
    </View>
  );
}
