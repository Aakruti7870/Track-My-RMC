import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";

import {
  staffPasskeyAuthenticationOptions,
  staffPasskeyRegistrationOptions,
  verifyStaffPasskeyAuthentication,
  verifyStaffPasskeyRegistration,
} from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { roleRouteFor } from "@/src/auth/roleRoutes";
import { canUseBrowserPasskeys, createBrowserPasskey, getBrowserPasskey } from "@/src/auth/webauthn";
import { AppText } from "@/src/components/ui/AppText";
import { useTheme } from "@/src/theme/ThemeProvider";
import { radius, spacing } from "@/src/theme/tokens";

type CeremonyFlow = "authenticate" | "register";

function readFragment(): { flow: CeremonyFlow; requestId: string } | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const flow = params.get("flow");
  const requestId = params.get("request_id") || "";
  if ((flow !== "authenticate" && flow !== "register") || requestId.length < 24) return null;
  // Erase the capability from browser history immediately after reading it.
  window.history.replaceState(null, document.title, window.location.pathname);
  return { flow, requestId };
}

export default function PasskeyCeremony() {
  const { colors } = useTheme();
  const router = useRouter();
  const { completeStaffPasskey } = useAuth();
  const [status, setStatus] = useState("Preparing secure passkey verification…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (Platform.OS !== "web") {
        if (active) setError("Passkey ceremony must open in the secure system browser.");
        return;
      }
      const context = readFragment();
      if (!context) {
        if (active) setError("This passkey request is invalid or incomplete.");
        return;
      }
      if (!canUseBrowserPasskeys()) {
        if (active) setError("Passkeys are not supported by this browser or device.");
        return;
      }

      try {
        if (context.flow === "authenticate") {
          if (active) setStatus("Confirm with your passkey, fingerprint, face, or device PIN.");
          const options = await staffPasskeyAuthenticationOptions(context.requestId);
          const credential = await getBrowserPasskey(options);
          const result = await verifyStaffPasskeyAuthentication(
            context.requestId,
            options.ceremony_id,
            credential,
          );
          if (result.return_mode === "app") {
            window.location.replace(
              `trackmyrmc://auth/passkey?code=${encodeURIComponent(result.handoff_code)}`,
            );
            return;
          }
          const me = await completeStaffPasskey(result.handoff_code);
          if (active) router.replace(roleRouteFor(me.role) as any);
          return;
        }

        if (active) setStatus("Create the passkey using your device security.");
        const options = await staffPasskeyRegistrationOptions(context.requestId);
        const credential = await createBrowserPasskey(options);
        const result = await verifyStaffPasskeyRegistration(
          context.requestId,
          options.ceremony_id,
          credential,
        );
        if (result.return_mode === "app") {
          window.location.replace("trackmyrmc://auth/passkey-setup?status=success");
          return;
        }
        if (active) router.replace("/passkey-setup?registered=1" as any);
      } catch (e: any) {
        if (!active) return;
        setError(e?.detail || e?.message || "Passkey verification could not be completed.");
      }
    })();
    return () => {
      active = false;
    };
  }, [completeStaffPasskey, router]);

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}> 
      <StatusBar style="dark" />
      <View style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}> 
        <View style={[styles.icon, { backgroundColor: colors.brand + "16" }]}> 
          <Ionicons
            name={error ? "alert-circle-outline" : "finger-print-outline"}
            size={34}
            color={error ? colors.error : colors.brand}
          />
        </View>
        <AppText variant="heading" center>{error ? "Passkey could not continue" : "TrackMyRMC Passkey"}</AppText>
        <AppText variant="bodyMuted" center>{error || status}</AppText>
        <AppText variant="caption" center>
          TrackMyRMC never receives your fingerprint, face data, device PIN, or private passkey key.
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  card: { width: "100%", maxWidth: 520, borderWidth: 1, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.lg },
  icon: { width: 72, height: 72, borderRadius: 36, alignSelf: "center", alignItems: "center", justifyContent: "center" },
});
