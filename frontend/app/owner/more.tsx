import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const ITEMS = [
  { key: "workforce", label: "Workforce Control", icon: "people-circle-outline", route: "/workforce" },
  { key: "shift_roster", label: "Shifts, Roster & Attendance", icon: "calendar-outline", route: "/shift-roster" },
  { key: "workforce_reports", label: "Workforce Reports & Payroll", icon: "stats-chart-outline", route: "/workforce-reports" },
  { key: "employee_master", label: "Employee Master & Salary", icon: "id-card-outline", route: "/employee-master" },
  { key: "payroll_closure", label: "Payroll Closure & Payslips", icon: "document-attach-outline", route: "/payroll-closure" },
  { key: "plans", label: "Premium & Promotions", icon: "diamond-outline", route: "/plans-promotions" },
  { key: "billing", label: "Billing & Payment History", icon: "receipt-outline", route: "/owner/billing-history" },
  { key: "quote_requests", label: "Quotation Requests", icon: "document-text-outline", route: "/owner/quotation-requests" },
  { key: "plant", label: "Plant Profile", icon: "business-outline", route: "/business/profile" },
  { key: "kyc", label: "Plant KYC", icon: "shield-checkmark-outline", route: "/kyc" },
  { key: "staff", label: "Staff", icon: "people-outline", route: "/business/staff" },
  { key: "customers", label: "Customers", icon: "person-outline", route: "/business/customers" },
  { key: "reports", label: "Reports", icon: "bar-chart-outline", route: "/business/reports" },
] as const satisfies readonly {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: Href;
}[];

const MODES: { key: "system" | "light" | "dark"; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "light", label: "Light", icon: "sunny-outline" },
  { key: "dark", label: "Dark", icon: "moon-outline" },
  { key: "system", label: "System", icon: "phone-portrait-outline" },
];

export default function OwnerMore() {
  const { colors, mode, setMode } = useTheme();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const doLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        <AppText variant="title">More</AppText>

        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={[styles.avatar, { backgroundColor: colors.brand }]}>
            <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: colors.onBrand }}>
              {(user?.name || "O").charAt(0).toUpperCase()}
            </AppText>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="heading" numberOfLines={1}>{user?.name}</AppText>
            <AppText variant="caption">{user?.email || user?.phone}</AppText>
            <Badge label="Plant Owner" color={colors.brand} />
          </View>
        </Card>

        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">Appearance</AppText>
          <View style={styles.modeRow}>
            {MODES.map((m) => {
              const selected = mode === m.key;
              return (
                <Pressable key={m.key} testID={`owner-theme-${m.key}`} onPress={() => setMode(m.key)} style={[styles.mode, { backgroundColor: selected ? colors.brand : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border }]}>
                  <Ionicons name={m.icon} size={18} color={selected ? colors.onBrand : colors.onSurfaceSecondary} />
                  <AppText style={{ fontFamily: fonts.medium, fontSize: fontSize.sm, color: selected ? colors.onBrand : colors.onSurfaceSecondary }}>{m.label}</AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Card padded={false}>
          {ITEMS.map((item, i) => (
            <Pressable key={item.key} testID={`owner-more-${item.key}`} onPress={() => router.push(item.route)} style={[styles.item, i < ITEMS.length - 1 && { borderBottomColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth }]}>
              <Ionicons name={item.icon} size={20} color={colors.onSurfaceSecondary} />
              <AppText style={{ flex: 1, fontFamily: fonts.medium, fontSize: fontSize.base, color: colors.onSurface }}>{item.label}</AppText>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}
        </Card>

        <Card style={{ gap: 4 }}>
          <AppText variant="label">Application</AppText>
          <AppText variant="caption">TrackMyRMC 2.0.18 · Android version code 76</AppText>
          <AppText variant="caption">Business data is plant-scoped and server-authorized.</AppText>
        </Card>

        <Pressable testID="owner-logout" onPress={doLogout} style={[styles.logout, { borderColor: colors.error }]}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.error }}>Logout</AppText>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  modeRow: { flexDirection: "row", gap: spacing.sm },
  mode: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, height: 44, borderRadius: radius.md, borderWidth: 1 },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 52, borderRadius: radius.md, borderWidth: 1 },
});