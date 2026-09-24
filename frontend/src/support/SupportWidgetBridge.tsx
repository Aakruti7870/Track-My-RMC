import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";

const CUSTOMER_WIDGET_PATHS = new Set(["/customer", "/customer/orders", "/customer/plants", "/customer/more"]);
type CustomerSupportFlow = "order" | "tracking" | null;
type PublicSupportFlow = "login" | "onboarding" | "delete" | null;
type DeliveryWindow = "today" | "tomorrow" | "week";

function compactPanelWidth(viewportWidth: number) {
  return Math.min(340, Math.max(240, viewportWidth * 0.72), Math.max(0, viewportWidth - 16));
}

function deliveryDateFor(window: DeliveryWindow) {
  const date = new Date();
  if (window === "tomorrow") date.setDate(date.getDate() + 1);
  if (window === "week") date.setDate(date.getDate() + 3);
  return date.toISOString().slice(0, 10);
}

/**
 * Global support entry point with a strict authentication boundary:
 * - before login: static login/account guidance only, no customer APIs;
 * - after login: authenticated customers get a compact Support Agent card on
 *   the four tab-shell screens that already reserve bottom-navigation space.
 *
 * Quick issue choices expand inside the compact corner card. Navigation only
 * occurs after a second explicit action such as Start Assisted Order or Open My Orders.
 * All overlay wrappers use box-none so only visible support controls receive touches.
 */
export function SupportWidgetBridge() {
  const { hydrating, token, user } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight, width: viewportWidth } = useWindowDimensions();
  const [publicHelpOpen, setPublicHelpOpen] = useState(false);
  const [customerHelpOpen, setCustomerHelpOpen] = useState(false);
  const [customerFlow, setCustomerFlow] = useState<CustomerSupportFlow>(null);
  const [publicFlow, setPublicFlow] = useState<PublicSupportFlow>(null);
  const [orderGrade, setOrderGrade] = useState("");
  const [orderLocation, setOrderLocation] = useState("");
  const [deliveryWindow, setDeliveryWindow] = useState<DeliveryWindow>("today");

  useEffect(() => {
    setPublicHelpOpen(false);
    setCustomerHelpOpen(false);
    setCustomerFlow(null);
    setPublicFlow(null);
  }, [pathname, token, user?.role]);

  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const showPublicLoginHelp = !hydrating && !token && !user && normalizedPath === "/login";
  const showCustomerSupport =
    !hydrating && Boolean(token) && user?.role === "customer" && CUSTOMER_WIDGET_PATHS.has(normalizedPath);

  if (!showPublicLoginHelp && !showCustomerSupport) return null;

  if (showCustomerSupport) {
    const anchorBottom = Math.max(insets.bottom + 104, 120);
    const panelWidth = compactPanelWidth(viewportWidth);
    const availableHeight = Math.max(190, viewportHeight - anchorBottom - 16);
    const panelMaxHeight = Math.min(400, Math.max(260, viewportHeight * 0.42), availableHeight);

    const openAssistedOrder = () => {
      const params: Record<string, string> = {
        assistant: "1",
        deliveryDate: deliveryDateFor(deliveryWindow),
      };
      if (orderGrade.trim()) params.grade = orderGrade.trim().toUpperCase();
      if (orderLocation.trim()) params.siteAddress = orderLocation.trim();
      router.push({ pathname: "/new-order", params } as never);
    };

    return (
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View pointerEvents="box-none" style={[styles.customerAnchor, { bottom: anchorBottom }]}>
          {customerHelpOpen ? (
            <ScrollView
              testID="customer-support-panel"
              accessibilityLiveRegion="polite"
              style={[
                styles.supportPanel,
                {
                  width: panelWidth,
                  maxHeight: panelMaxHeight,
                  backgroundColor: colors.surfaceSecondary,
                  borderColor: colors.border,
                },
              ]}
              contentContainerStyle={styles.panelContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              <View style={styles.panelHeader}>
                <View style={[styles.panelIcon, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "44" }]}>
                  <Ionicons name="chatbubbles-outline" size={22} color={colors.brand} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="heading">TrackMyRMC Support</AppText>
                  <AppText variant="caption">Quick help without leaving this screen.</AppText>
                </View>
                <Pressable
                  testID="customer-support-close"
                  accessibilityRole="button"
                  accessibilityLabel="Close TrackMyRMC Support"
                  hitSlop={10}
                  onPress={() => {
                    setCustomerHelpOpen(false);
                    setCustomerFlow(null);
                  }}
                  style={[styles.closeButton, { borderColor: colors.border }]}
                >
                  <Ionicons name="close" size={18} color={colors.onSurface} />
                </Pressable>
              </View>

              <View style={[styles.actionSection, customerFlow === "order" && { borderColor: colors.brand + "88", backgroundColor: colors.brandSoft }]}>
                <Pressable
                  testID="customer-support-place-order"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: customerFlow === "order" }}
                  onPress={() => setCustomerFlow((current) => (current === "order" ? null : "order"))}
                  style={({ pressed }) => [styles.actionRow, { opacity: pressed ? 0.78 : 1 }]}
                >
                  <Ionicons name="cart-outline" size={19} color={colors.brand} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="label">Place Order with Agent</AppText>
                    <AppText variant="caption">Prepare an assisted order, then confirm it yourself.</AppText>
                  </View>
                  <Ionicons name={customerFlow === "order" ? "chevron-up" : "chevron-down"} size={17} color={colors.onSurfaceTertiary} />
                </Pressable>

                {customerFlow === "order" ? (
                  <View testID="customer-support-place-order-card" style={styles.compactFlow}>
                    <View style={[styles.compactInput, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
                      <Ionicons name="cube-outline" size={17} color={colors.brand} />
                      <TextInput
                        testID="customer-support-order-grade"
                        value={orderGrade}
                        onChangeText={setOrderGrade}
                        placeholder="RMC type (e.g. M25, M30)"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        autoCapitalize="characters"
                        style={[styles.compactInputText, { color: colors.onSurface }]}
                      />
                    </View>
                    <View style={[styles.compactInput, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
                      <Ionicons name="location-outline" size={17} color={colors.brand} />
                      <TextInput
                        testID="customer-support-order-location"
                        value={orderLocation}
                        onChangeText={setOrderLocation}
                        placeholder="Delivery location / PIN code"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        style={[styles.compactInputText, { color: colors.onSurface }]}
                      />
                    </View>
                    <View style={styles.quickChoiceRow}>
                      {([
                        ["today", "Today"],
                        ["tomorrow", "Tomorrow"],
                        ["week", "This week"],
                      ] as const).map(([value, label]) => {
                        const selected = deliveryWindow === value;
                        return (
                          <Pressable
                            key={value}
                            testID={`customer-support-window-${value}`}
                            onPress={() => setDeliveryWindow(value)}
                            style={[
                              styles.quickChoice,
                              {
                                borderColor: selected ? colors.brand : colors.border,
                                backgroundColor: selected ? colors.brandSoft : colors.surfaceSecondary,
                              },
                            ]}
                          >
                            <AppText style={{ fontFamily: fonts.semibold, fontSize: 11, color: selected ? colors.brand : colors.onSurface }}>
                              {label}
                            </AppText>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Pressable
                      testID="customer-support-start-assisted-order"
                      accessibilityRole="button"
                      onPress={openAssistedOrder}
                      style={({ pressed }) => [styles.primaryCompactAction, { backgroundColor: colors.brand, opacity: pressed ? 0.82 : 1 }]}
                    >
                      <AppText style={[styles.primaryCompactActionText, { color: colors.onBrand }]}>Start Assisted Order</AppText>
                      <Ionicons name="arrow-forward" size={16} color={colors.onBrand} />
                    </Pressable>
                    <AppText variant="caption">Nothing is placed automatically. You still review and confirm the order.</AppText>
                  </View>
                ) : null}
              </View>

              <View style={[styles.actionSection, customerFlow === "tracking" && { borderColor: colors.brand + "88", backgroundColor: colors.brandSoft }]}>
                <Pressable
                  testID="customer-support-track-delivery"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: customerFlow === "tracking" }}
                  onPress={() => setCustomerFlow((current) => (current === "tracking" ? null : "tracking"))}
                  style={({ pressed }) => [styles.actionRow, { opacity: pressed ? 0.78 : 1 }]}
                >
                  <Ionicons name="navigate-outline" size={19} color={colors.brand} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="label">Track Delivery</AppText>
                    <AppText variant="caption">Check dispatch and live-tracking options here first.</AppText>
                  </View>
                  <Ionicons name={customerFlow === "tracking" ? "chevron-up" : "chevron-down"} size={17} color={colors.onSurfaceTertiary} />
                </Pressable>

                {customerFlow === "tracking" ? (
                  <View testID="customer-support-track-delivery-card" style={styles.compactFlow}>
                    <View style={styles.guidanceRow}>
                      <Ionicons name="time-outline" size={17} color={colors.brand} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="label">Pending / Accepted</AppText>
                        <AppText variant="caption">Live vehicle tracking appears after the order is dispatched.</AppText>
                      </View>
                    </View>
                    <View style={styles.guidanceRow}>
                      <Ionicons name="navigate-circle-outline" size={17} color={colors.brand} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="label">Dispatched</AppText>
                        <AppText variant="caption">Open My Orders and select the delivery to view tracking.</AppText>
                      </View>
                    </View>
                    <Pressable
                      testID="customer-support-open-orders"
                      accessibilityRole="button"
                      onPress={() => router.push("/customer/orders" as never)}
                      style={({ pressed }) => [styles.primaryCompactAction, { backgroundColor: colors.brand, opacity: pressed ? 0.82 : 1 }]}
                    >
                      <AppText style={[styles.primaryCompactActionText, { color: colors.onBrand }]}>Open My Orders</AppText>
                      <Ionicons name="arrow-forward" size={16} color={colors.onBrand} />
                    </Pressable>
                  </View>
                ) : null}
              </View>

              <Pressable
                testID="customer-support-open-center"
                accessibilityRole="button"
                accessibilityHint="Opens the full support center and support case history"
                onPress={() => router.push("/support" as never)}
                style={({ pressed }) => [styles.actionSection, styles.actionRow, { borderColor: colors.border, opacity: pressed ? 0.78 : 1 }]}
              >
                <Ionicons name="help-circle-outline" size={19} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <AppText variant="label">All Issues & My Support Cases</AppText>
                  <AppText variant="caption">Open the full center only for detailed issue steps or case history.</AppText>
                </View>
                <Ionicons name="open-outline" size={17} color={colors.onSurfaceTertiary} />
              </Pressable>
            </ScrollView>
          ) : null}

          <View pointerEvents="box-none" style={styles.customerLauncher}>
            <Pressable
              testID="customer-support-widget"
              accessibilityRole="button"
              accessibilityLabel="Open TrackMyRMC Support"
              accessibilityHint="Expands a compact support card without leaving this screen"
              accessibilityState={{ expanded: customerHelpOpen }}
              onPress={() => setCustomerHelpOpen((value) => !value)}
              style={({ pressed }) => [
                styles.supportButton,
                {
                  backgroundColor: colors.surfaceSecondary,
                  borderColor: colors.brand,
                  opacity: pressed ? 0.84 : 1,
                },
              ]}
            >
              <Ionicons name="chatbubbles-outline" size={30} color={colors.brand} />
            </Pressable>
            <View pointerEvents="none" style={[styles.customerBadge, { backgroundColor: colors.brand }]}> 
              <AppText style={[styles.badgeText, { color: colors.onBrand }]}>Support</AppText>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const anchorTop = Math.max(insets.top + spacing.sm, 16);
  const panelWidth = compactPanelWidth(viewportWidth);
  const availableHeight = Math.max(190, viewportHeight - anchorTop - 20);
  const panelMaxHeight = Math.min(380, Math.max(250, viewportHeight * 0.4), availableHeight);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={[styles.publicAnchor, { top: anchorTop }]}>
        {publicHelpOpen ? (
          <ScrollView
            testID="login-help-panel"
            accessibilityLiveRegion="polite"
            style={[
              styles.supportPanel,
              {
                width: panelWidth,
                maxHeight: panelMaxHeight,
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.border,
              },
            ]}
            contentContainerStyle={styles.panelContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            <View style={styles.panelHeader}>
              <View style={[styles.panelIcon, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "44" }]}>
                <Ionicons name="chatbubbles-outline" size={22} color={colors.brand} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="heading">TrackMyRMC Support</AppText>
                <AppText variant="caption">Safe quick help before sign-in. No customer, order, tracking or payment data is available here.</AppText>
              </View>
              <Pressable
                testID="login-help-close"
                accessibilityRole="button"
                accessibilityLabel="Close login help"
                hitSlop={10}
                onPress={() => {
                  setPublicHelpOpen(false);
                  setPublicFlow(null);
                }}
                style={[styles.closeButton, { borderColor: colors.border }]}
              >
                <Ionicons name="close" size={18} color={colors.onSurface} />
              </Pressable>
            </View>

            <View style={[styles.actionSection, publicFlow === "login" && { borderColor: colors.brand + "88", backgroundColor: colors.brandSoft }]}>
              <Pressable
                testID="login-help-login-issue"
                accessibilityRole="button"
                accessibilityState={{ expanded: publicFlow === "login" }}
                onPress={() => setPublicFlow((current) => (current === "login" ? null : "login"))}
                style={styles.actionRow}
              >
                <Ionicons name="log-in-outline" size={18} color={colors.brand} />
                <View style={{ flex: 1 }}><AppText variant="label">Login Issue</AppText><AppText variant="caption">OTP and approved staff login guidance.</AppText></View>
                <Ionicons name={publicFlow === "login" ? "chevron-up" : "chevron-down"} size={17} color={colors.onSurfaceTertiary} />
              </Pressable>
              {publicFlow === "login" ? (
                <View testID="login-help-login-card" style={styles.compactFlow}>
                  <View style={styles.guidanceRow}>
                    <Ionicons name="phone-portrait-outline" size={17} color={colors.brand} />
                    <View style={{ flex: 1, gap: 2 }}><AppText variant="label">Customer</AppText><AppText variant="caption">Use your registered 10-digit mobile number and 6-digit SMS OTP.</AppText></View>
                  </View>
                  <View style={styles.guidanceRow}>
                    <Ionicons name="business-outline" size={17} color={colors.brand} />
                    <View style={{ flex: 1, gap: 2 }}><AppText variant="label">Plant Staff</AppText><AppText variant="caption">Use your approved work email and the secure verification method requested.</AppText></View>
                  </View>
                  <AppText variant="caption">Never share OTPs, passwords, passkeys, recovery codes or payment credentials.</AppText>
                </View>
              ) : null}
            </View>

            <View style={[styles.actionSection, publicFlow === "onboarding" && { borderColor: colors.brand + "88", backgroundColor: colors.brandSoft }]}>
              <Pressable
                testID="login-help-onboarding"
                accessibilityRole="button"
                accessibilityState={{ expanded: publicFlow === "onboarding" }}
                onPress={() => setPublicFlow((current) => (current === "onboarding" ? null : "onboarding"))}
                style={styles.actionRow}
              >
                <Ionicons name="business-outline" size={18} color={colors.brand} />
                <View style={{ flex: 1 }}><AppText variant="label">Plant email not approved?</AppText><AppText variant="caption">See onboarding guidance without leaving login.</AppText></View>
                <Ionicons name={publicFlow === "onboarding" ? "chevron-up" : "chevron-down"} size={17} color={colors.onSurfaceTertiary} />
              </Pressable>
              {publicFlow === "onboarding" ? (
                <View testID="login-help-onboarding-card" style={styles.compactFlow}>
                  <AppText variant="caption">Submit owner, contact and plant details for Authority review. Submission creates a pending request only.</AppText>
                  <Pressable
                    testID="login-help-open-onboarding"
                    onPress={() => router.push("/plant-onboarding" as never)}
                    style={({ pressed }) => [styles.primaryCompactAction, { backgroundColor: colors.brand, opacity: pressed ? 0.82 : 1 }]}
                  >
                    <AppText style={[styles.primaryCompactActionText, { color: colors.onBrand }]}>Open Onboarding Form</AppText>
                    <Ionicons name="arrow-forward" size={16} color={colors.onBrand} />
                  </Pressable>
                </View>
              ) : null}
            </View>

            <View style={[styles.actionSection, publicFlow === "delete" && { borderColor: colors.brand + "88", backgroundColor: colors.brandSoft }]}>
              <Pressable
                testID="login-help-delete-account"
                accessibilityRole="button"
                accessibilityState={{ expanded: publicFlow === "delete" }}
                onPress={() => setPublicFlow((current) => (current === "delete" ? null : "delete"))}
                style={styles.actionRow}
              >
                <Ionicons name="person-remove-outline" size={18} color={colors.brand} />
                <View style={{ flex: 1 }}><AppText variant="label">Delete Account</AppText><AppText variant="caption">Review the safe ownership-verification step first.</AppText></View>
                <Ionicons name={publicFlow === "delete" ? "chevron-up" : "chevron-down"} size={17} color={colors.onSurfaceTertiary} />
              </Pressable>
              {publicFlow === "delete" ? (
                <View testID="login-help-delete-card" style={styles.compactFlow}>
                  <AppText variant="caption">Account deletion requires ownership verification. The support widget never asks for your OTP or password.</AppText>
                  <Pressable
                    testID="login-help-open-delete-account"
                    onPress={() => router.push("/account-deletion-public" as never)}
                    style={({ pressed }) => [styles.primaryCompactAction, { backgroundColor: colors.brand, opacity: pressed ? 0.82 : 1 }]}
                  >
                    <AppText style={[styles.primaryCompactActionText, { color: colors.onBrand }]}>Start Verified Deletion</AppText>
                    <Ionicons name="arrow-forward" size={16} color={colors.onBrand} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          </ScrollView>
        ) : null}

        <Pressable
          testID="login-help-widget"
          accessibilityRole="button"
          accessibilityLabel="Need help logging in?"
          accessibilityHint="Opens safe compact help without accessing customer, order, tracking or payment data"
          accessibilityState={{ expanded: publicHelpOpen }}
          onPress={() => setPublicHelpOpen((value) => !value)}
          style={({ pressed }) => [
            styles.supportButton,
            {
              backgroundColor: colors.surfaceSecondary,
              borderColor: colors.brand,
              opacity: pressed ? 0.84 : 1,
            },
          ]}
        >
          <Ionicons name="chatbubbles-outline" size={30} color={colors.brand} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  customerAnchor: {
    position: "absolute",
    right: spacing.md,
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  customerLauncher: { alignItems: "center" },
  publicAnchor: {
    position: "absolute",
    right: spacing.sm,
    alignItems: "flex-end",
    gap: spacing.sm,
    flexDirection: "column-reverse",
  },
  supportButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 7,
  },
  customerBadge: {
    minHeight: 24,
    minWidth: 54,
    marginTop: -5,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: fonts.semibold, fontSize: 10 },
  supportPanel: {
    borderWidth: 1,
    borderRadius: radius.xl,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 10,
  },
  panelContent: {
    padding: spacing.sm,
    gap: spacing.sm,
  },
  panelHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  panelIcon: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  closeButton: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  actionSection: {
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  actionRow: {
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  compactFlow: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  compactInput: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  compactInputText: {
    minHeight: 40,
    flex: 1,
    paddingVertical: 0,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  quickChoiceRow: { flexDirection: "row", gap: 6 },
  quickChoice: {
    minHeight: 34,
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  primaryCompactAction: {
    minHeight: 40,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryCompactActionText: { fontFamily: fonts.semibold, fontSize: 12 },
  guidanceRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
});
