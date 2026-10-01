import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
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

export default function AccountDeletion() {
  const { token } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { data, loading, refetch } = useGet<{ request: DeletionRequest | null }>(
    token ? "/account-deletion/status" : null,
  );

  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const requestDeletion = async () => {
    if (!token) return;
    if (confirm.trim().toUpperCase() !== "DELETE") {
      return toast("Type DELETE to confirm", "error");
    }
    setBusy(true);
    try {
      await apiPost("/account-deletion/request", token, {
        confirm: "DELETE",
        reason: reason.trim() || null,
      });
      toast("Deletion request submitted for review", "success");
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

  const req = data?.request;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 112, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        <Card style={{ gap: spacing.sm }}>
          <AppText variant="caption" color={colors.brand}>TRACK MY RMC · ACCOUNT CONTROL</AppText>
          <AppText variant="title">Delete Account</AppText>
          <AppText variant="bodyMuted">
            Signed-in users can submit an account deletion request. Requests are reviewed before completion; submitting a request does not immediately delete your data.
          </AppText>
        </Card>

        <Card style={{ gap: spacing.sm }}>
          <AppText variant="heading">What happens next</AppText>
          <AppText variant="caption">Your sign-in identity, personal profile and active sessions will be removed or anonymized when deletion is completed.</AppText>
          <AppText variant="caption">Orders, challans, invoices and other statutory transaction records may be retained where required by legal, tax, fraud-prevention or accounting obligations.</AppText>
          <AppText variant="caption">Plant Owners must transfer or deactivate active plants before a deletion request can be submitted.</AppText>
        </Card>

        {!token ? (
          <Card style={{ gap: spacing.md }}>
            <AppText variant="heading">Need account deletion without signing in?</AppText>
            <AppText variant="bodyMuted">
              For account ownership verification and a deletion request, contact support@goldetech.com from your registered email address. Do not send passwords or OTP codes by email.
            </AppText>
          </Card>
        ) : (
          <>
            {loading && !data ? <Skeleton height={120} /> : null}
            {req?.status === "PENDING" ? (
              <Card style={{ gap: spacing.md }}>
                <AppText variant="heading">Deletion request pending</AppText>
                <AppText variant="bodyMuted">Submitted {req.created_at ? new Date(req.created_at).toLocaleString() : "recently"}.</AppText>
                {req.reason ? <AppText variant="caption">Reason: {req.reason}</AppText> : null}
                <AppText variant="caption">You can cancel the request until it is reviewed and completed.</AppText>
                <Button label="Cancel deletion request" variant="outline" onPress={cancel} loading={busy} />
              </Card>
            ) : req?.status === "COMPLETED" ? (
              <Card style={{ gap: spacing.md }}>
                <AppText variant="heading">Deletion completed</AppText>
                <AppText variant="bodyMuted">This account's deletion request has been marked completed.</AppText>
              </Card>
            ) : (
              <Card style={{ gap: spacing.md }}>
                <AppText variant="heading">Submit deletion request</AppText>
                <Input label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="Why are you deleting your account?" />
                <Input label='Type "DELETE" to confirm' value={confirm} onChangeText={setConfirm} autoCapitalize="characters" autoCorrect={false} />
                <Button label="Request Account Deletion" onPress={requestDeletion} loading={busy} />
              </Card>
            )}
          </>
        )}

        <AppText variant="caption" center>Privacy & support: support@goldetech.com</AppText>
      </ScrollView>
    </View>
  );
}
