import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Href, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Section = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  symbol: VectorSymbolName;
  desc: string;
  route: Href;
};

const SECTIONS: Section[] = [
  { key: "production", label: "Production", icon: "cog-outline", symbol: "material-consumption", desc: "Batching, produced quantity and material consumption", route: "/owner/orders" },
  { key: "dispatch", label: "Dispatch", icon: "navigate-outline", symbol: "driver-assignment", desc: "Multi-load planning, TM/driver, challan and gate pass", route: "/owner/orders" },
  { key: "rates", label: "Rate Cards", icon: "pricetag-outline", symbol: "rate-cards", desc: "Grade pricing, GST, transport and pumping", route: "/business/rates" },
  { key: "mixes", label: "Mix Designs", icon: "flask-outline", symbol: "mix-designs", desc: "Concrete recipes used by production stock consumption", route: "/business/mixes" },
  { key: "inventory", label: "Inventory", icon: "cube-outline", symbol: "material-inventory", desc: "Cement, fly ash, sand, aggregates, admixture and water", route: "/business/inventory" },
  { key: "suppliers", label: "Suppliers", icon: "people-circle-outline", symbol: "suppliers", desc: "Material vendor master", route: "/business/suppliers" },
  { key: "purchases", label: "Purchases", icon: "cart-outline", symbol: "material-receipts", desc: "Purchase receipts with automatic stock posting", route: "/business/purchases" },
  { key: "fleet", label: "Fleet", icon: "bus-outline", symbol: "transit-mixer-fleet", desc: "Transit mixers, capacity and availability", route: "/business/fleet" },
  { key: "drivers", label: "Driver Onboarding", icon: "people-outline", symbol: "drivers", desc: "Driver employment, emergency contacts and mixer assignments", route: "/owner/drivers" },
  { key: "diesel", label: "Diesel", icon: "water-outline", symbol: "diesel-ledger", desc: "Diesel receipts, issues and running balance", route: "/business/diesel" },
  { key: "billing", label: "Billing & Ledger", icon: "wallet-outline", symbol: "billing-ledger", desc: "Invoices, payments and outstanding", route: "/owner/billing" },
  { key: "expenses", label: "Expenses", icon: "cash-outline", symbol: "expenses", desc: "Plant expense register", route: "/business/expenses" },
  { key: "quotations", label: "Quotations", icon: "document-text-outline", symbol: "quotations", desc: "Customer/site commercial quotations", route: "/business/quotations" },
  { key: "attendance", label: "Attendance", icon: "calendar-outline", symbol: "attendance", desc: "Daily staff attendance", route: "/business/attendance" },
  { key: "payroll", label: "Payroll", icon: "card-outline", symbol: "payroll", desc: "Salary, allowances, overtime and deductions", route: "/business/payroll" },
  { key: "incidents", label: "Incidents / SOS", icon: "warning-outline", symbol: "incident-register", desc: "Driver emergencies and alerts", route: "/owner/incidents" },
  { key: "reports", label: "Plant Report", icon: "bar-chart-outline", symbol: "production-report", desc: "Operational and commercial summary", route: "/business/reports" },
];

export default function OwnerOperations() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={styles.titleRow}>
        <AppText variant="title">Operations</AppText>
        <AppText variant="caption">Plant production, dispatch, commercial, fleet and stock</AppText>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.sm }} showsVerticalScrollIndicator={false}>
        {SECTIONS.map((s) => (
          <Pressable
            key={s.key}
            testID={`ops-${s.key}`}
            onPress={() => router.push(s.route)}
            style={[styles.row, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          >
            <View style={[styles.icon, { backgroundColor: colors.brandSoft }]}>
              <VectorSymbol name={s.symbol} size={37} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>{s.label}</AppText>
              <AppText variant="caption">{s.desc}</AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
