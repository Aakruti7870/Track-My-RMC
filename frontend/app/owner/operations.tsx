import React, { useEffect, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { apiErrorDetail, apiPost, apiPut } from "@/src/api/client";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { OwnerFrame, OwnerGlass, OwnerList, OwnerModuleRow, useOwnerPalette } from "@/src/owner/OwnerUI";
import { OPERATIONS_KEYS, ownerModules } from "@/src/owner/modules";

type Plant = { id: string; name: string };
type AutomationRule = {
  key: string;
  label: string;
  published: boolean;
  globally_paused: boolean;
  enabled: boolean;
  reminder_after_minutes: number;
  sla_minutes: number;
};
type OwnerTask = { id: string; order_number: string; task_kind: string; status: string; source_label?: string; escalation_count?: number; resolution_reason?: string | null };
type AutomationHistory = { id: string; template_key: string; status: string; attempts: number };
const REMINDER_MINUTES = [30, 60, 120, 240] as const;
const SLA_MINUTES = [30, 60, 120, 240] as const;
const AUTOMATION_GRID_COLUMNS = 4;
const AUTOMATION_GRID_GAP = 6;
// Short display labels only; the full API label is used for accessibility and details.
const COMPACT_AUTOMATION_LABELS: Record<string, string> = {
  DISPATCH_UNASSIGNED_LOAD: "Unassigned loads",
  INVENTORY_BELOW_MIN: "Low stock",
  ORDER_ACCEPTED_NOTICE: "Order accepted",
  ORDER_PENDING_REMINDER: "Pending orders",
  ORDER_REJECTED_NOTICE: "Order rejected",
  ORDER_SUBMITTED_TASK: "Order review",
  QUALITY_INSPECTION_FAILED: "Failed quality",
  RFQ_PENDING_PLANT: "Pending RFQ",
  WORKFORCE_LEAVE_PENDING: "Staff leave",
};
const AUTOMATION_ICONS: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  DISPATCH_UNASSIGNED_LOAD: "car-outline",
  INVENTORY_BELOW_MIN: "cube-outline",
  ORDER_ACCEPTED_NOTICE: "checkmark-circle-outline",
  ORDER_PENDING_REMINDER: "time-outline",
  ORDER_REJECTED_NOTICE: "close-circle-outline",
  ORDER_SUBMITTED_TASK: "clipboard-outline",
  QUALITY_INSPECTION_FAILED: "shield-outline",
  RFQ_PENDING_PLANT: "document-text-outline",
  WORKFORCE_LEAVE_PENDING: "calendar-outline",
};

type AutomationWorkspace = "/owner/orders" | "/owner/quotation-requests" | "/business/inventory" | "/workforce";

function workspaceForTask(kind: string): AutomationWorkspace | null {
  switch (kind) {
    case "REVIEW_ORDER":
    case "DISPATCH_UNASSIGNED_LOAD": return "/owner/orders";
    case "RFQ_PENDING_PLANT": return "/owner/quotation-requests";
    case "INVENTORY_BELOW_MIN": return "/business/inventory";
    case "WORKFORCE_LEAVE_PENDING": return "/workforce";
    // A failed quality assessment cannot be closed from Owner Operations;
    // it requires an authorized Quality Engineer workflow.
    default: return null;
  }
}

export default function OwnerOperations() {
  const p = useOwnerPalette();
  const { width: viewportWidth } = useWindowDimensions();
  // OwnerFrame caps content at 820dp and OwnerList has 16dp padding per side.
  const gridWidth = Math.min(viewportWidth, 820) - 32;
  const tileWidth = (gridWidth - AUTOMATION_GRID_GAP * (AUTOMATION_GRID_COLUMNS - 1)) / AUTOMATION_GRID_COLUMNS;
  const [selectedRuleKey, setSelectedRuleKey] = useState<string | null>(null);
  const router = useRouter();
  const { token } = useAuth();
  const [plantId, setPlantId] = useState("");
  const [busyRule, setBusyRule] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [requestError, setRequestError] = useState("");
  const { data: plants, error: plantsError } = useGet<{ plants: Plant[] }>("/master/my-plants");
  useEffect(() => {
    const options = plants?.plants ?? [];
    setPlantId(previous => options.some(plant => plant.id === previous) ? previous : options[0]?.id ?? "");
  }, [plants]);
  const base = plantId ? `/owner/plants/${encodeURIComponent(plantId)}/automation` : null;
  const { data: rules, error: ruleError, loading: rulesLoading, refetch: refreshRules } =
    useGet<{ rules: AutomationRule[]; worker_enabled: boolean }>(base ? `${base}/rules` : null);
  const { data: tasks, error: tasksError, refetch: refreshTasks } =
    useGet<{ tasks: OwnerTask[] }>(base ? `${base}/tasks` : null);
  const { data: history, refetch: refreshHistory } =
    useGet<{ jobs: AutomationHistory[] }>(base ? `${base}/history` : null);
  const selectedRule = (rules?.rules ?? []).find(rule => rule.key === selectedRuleKey);
  const dispatchUrl = plantId ? `/owner/plants/${encodeURIComponent(plantId)}/dispatch-whatsapp` : null;
  const { data: whatsappSettings, refetch: refreshWhatsappSettings } =
    useGet<{ enabled: boolean; worker_enabled: boolean; template_configured: boolean;
      summary: { pending: number; needs_consent: number; needs_review: number; delivered: number } }>(dispatchUrl);
  const [updatingWhatsapp, setUpdatingWhatsapp] = useState(false);

  async function updateWhatsapp(enabled: boolean) {
    if (!dispatchUrl || !token || updatingWhatsapp) return;
    setUpdatingWhatsapp(true);
    setRequestError("");
    try {
      await apiPut(dispatchUrl, token, { enabled });
      setNotice("Dispatch WhatsApp plant preference saved.");
      await refreshWhatsappSettings();
    } catch (error) {
      setRequestError(apiErrorDetail(error, "Could not update dispatch WhatsApp preference."));
    } finally {
      setUpdatingWhatsapp(false);
    }
  }

  async function updateRule(rule: AutomationRule, enabled: boolean, reminderMinutes?: number, slaMinutes?: number) {
    if (!base || !token || busyRule || (enabled && (!rule.published || rule.globally_paused))) return;
    setBusyRule(rule.key);
    setRequestError("");
    setNotice("");
    try {
      await apiPut(`${base}/rules/${encodeURIComponent(rule.key)}`, token, {
        enabled,
        ...(reminderMinutes !== undefined ? { reminder_after_minutes: reminderMinutes } : {}),
        ...(slaMinutes !== undefined ? { sla_minutes: slaMinutes } : {}),
      });
      setNotice("Plant automation preference saved.");
      await Promise.all([refreshRules(), refreshTasks(), refreshHistory()]);
    } catch (error) {
      setRequestError(apiErrorDetail(error, "Automation setting could not be updated."));
    } finally {
      setBusyRule(null);
    }
  }

  async function acknowledgeTask(task: OwnerTask) {
    if (!base || !token || busyTask || task.task_kind === "REVIEW_ORDER") return;
    setBusyTask(task.id);
    setRequestError("");
    setNotice("");
    try {
      await apiPost(`${base}/domain-tasks/${encodeURIComponent(task.id)}/acknowledge`, token, {});
      setNotice("Review alert acknowledged. The underlying plant issue is not approved or closed.");
      await Promise.all([refreshTasks(), refreshHistory()]);
    } catch (error) {
      setRequestError(apiErrorDetail(error, "Could not acknowledge the alert."));
    } finally {
      setBusyTask(null);
    }
  }

  return <OwnerFrame title="Operations" subtitle="Manage day-to-day plant operations">
    <OwnerList>
      <View testID="owner-native-automation-center" style={{ gap: 10, marginBottom: 14 }}>
        <AppText style={{ color: p.text, fontWeight: "700", fontSize: 16 }}>Native Automation Center</AppText>
        <AppText style={{ color: p.muted, fontSize: 12, lineHeight: 18 }}>
          Your plant can enable approved internal reminders and human review tasks. All order approvals remain manual.
        </AppText>
        {plantsError ? <AppText style={{ color: "#FCA5A5" }}>{plantsError}</AppText> : null}
        {(plants?.plants ?? []).length > 1 ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {(plants?.plants ?? []).map(plant => <Pressable key={plant.id} accessibilityRole="button"
            accessibilityState={{ selected: plant.id === plantId }} onPress={() => setPlantId(plant.id)}
            style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12,
              backgroundColor: plant.id === plantId ? p.accent : p.glass }}>
            <AppText style={{ color: plant.id === plantId ? "#FFFFFF" : p.text, fontSize: 12 }}>{plant.name}</AppText>
          </Pressable>)}
        </View> : null}
        {!plantId && !plantsError ? <AppText style={{ color: p.muted }}>No approved plants are available for automation.</AppText> : null}
        {ruleError ? <AppText style={{ color: "#FCA5A5" }}>{ruleError}</AppText> : null}
        {requestError ? <AppText accessibilityRole="alert" style={{ color: "#FCA5A5" }}>{requestError}</AppText> : null}
        {notice ? <AppText style={{ color: p.text }}>{notice}</AppText> : null}
        {rulesLoading && !rules ? <AppText style={{ color: p.muted }}>Loading automation settings…</AppText> : null}
        {rules && !rules.worker_enabled ? <AppText accessibilityRole="alert" style={{ color: "#F59E0B", fontSize: 12 }}>
          Automation engine not activated. Preferences are saved, but the background worker is currently off.
        </AppText> : null}
        <OwnerGlass style={{ padding: 12, gap: 8, borderColor: p.border }} testID="owner-whatsapp-dispatch-automation">
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <AppText style={{ color: p.text, fontWeight: "700", fontSize: 14 }}>Automatic WhatsApp Dispatch</AppText>
              <AppText style={{ color: p.muted, fontSize: 12 }}>
                One transactional alert per mixer load, after dispatch and customer consent.
              </AppText>
            </View>
            <Pressable accessibilityRole="switch"
              accessibilityState={{ checked: whatsappSettings?.enabled || false, disabled: updatingWhatsapp || !plantId }}
              disabled={updatingWhatsapp || !plantId}
              onPress={() => void updateWhatsapp(!whatsappSettings?.enabled)}
              style={{ backgroundColor: whatsappSettings?.enabled ? p.accent : p.glass,
                borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 }}>
              <AppText style={{ color: whatsappSettings?.enabled ? "#FFFFFF" : p.text, fontWeight: "700" }}>
                {whatsappSettings?.enabled ? "ON" : "OFF"}
              </AppText>
            </Pressable>
          </View>
          <AppText style={{ color: p.muted, fontSize: 12 }}>
            Worker: {whatsappSettings?.worker_enabled ? "Enabled" : "Not activated"} ·
            Template: {whatsappSettings?.template_configured ? "Configured" : "Pending"}
          </AppText>
          {whatsappSettings?.summary ? (
            <AppText style={{ color: p.muted, fontSize: 12 }}>
              Pending {whatsappSettings.summary.pending} · Consent required {whatsappSettings.summary.needs_consent} ·
              Delivered {whatsappSettings.summary.delivered} · Review {whatsappSettings.summary.needs_review}
            </AppText>
          ) : null}
        </OwnerGlass>
        <View testID="owner-automation-grid" style={{ flexDirection: "row", flexWrap: "wrap", gap: AUTOMATION_GRID_GAP }}>
          {(rules?.rules ?? []).map(rule => {
            const available = rule.published && !rule.globally_paused;
            const on = rule.enabled && available;
            const disabled = (!available && !rule.enabled) || Boolean(busyRule);
            const status = !rule.published ? "Pending" : rule.globally_paused ? "Paused" : on ? "Active" : "Ready";
            return <OwnerGlass key={rule.key} style={{
              width: tileWidth, height: 116, paddingHorizontal: 4, paddingVertical: 6,
              borderRadius: 12, borderColor: selectedRuleKey === rule.key ? p.accent : p.border,
              justifyContent: "space-between", alignItems: "center", gap: 2,
            }}>
              <Pressable testID={"owner-automation-detail-" + rule.key} accessibilityRole="button"
                accessibilityLabel={"Show details and settings for " + rule.label}
                accessibilityState={{ selected: selectedRuleKey === rule.key }}
                onPress={() => setSelectedRuleKey(current => current === rule.key ? null : rule.key)}
                style={{ flex: 1, alignItems: "center", alignSelf: "stretch", justifyContent: "center", gap: 2 }}>
                <Ionicons name={AUTOMATION_ICONS[rule.key] ?? "flash-outline"} size={17} color={p.accent} />
                <AppText numberOfLines={2} center style={{ fontSize: 10, lineHeight: 12, fontWeight: "700", color: p.text }}>
                  {COMPACT_AUTOMATION_LABELS[rule.key] ?? rule.label}
                </AppText>
                <AppText numberOfLines={1} center style={{ fontSize: 9, lineHeight: 11, color: p.muted }}>{status}</AppText>
              </Pressable>
              <Pressable testID={"owner-automation-toggle-" + rule.key} accessibilityRole="switch"
                accessibilityLabel={rule.label + ": " + (on ? "On" : "Off") + ". " + (
                  !rule.published ? "Awaiting Central Admin publication" :
                  rule.globally_paused ? "Paused by Central Admin" : "Plant automation preference")}
                accessibilityState={{ checked: on, disabled }}
                disabled={disabled} onPress={() => void updateRule(rule, !rule.enabled)}
                style={{ minWidth: 44, alignSelf: "stretch", minHeight: 44, justifyContent: "center",
                  borderRadius: 9, backgroundColor: on ? p.accent : p.canvas,
                  opacity: disabled ? 0.65 : 1 }}>
                <AppText center style={{ color: on ? "#FFFFFF" : p.text, fontSize: 11, fontWeight: "700" }}>
                  {busyRule === rule.key ? "..." : on ? "ON" : "OFF"}
                </AppText>
              </Pressable>
            </OwnerGlass>;
          })}
          {/* The backend currently supplies nine rules. This is a non-functional reserved slot, not a fake automation. */}
          {rules?.rules.length === 9 ? <OwnerGlass style={{
            width: tileWidth, height: 116, padding: 5, borderRadius: 12,
            justifyContent: "center", alignItems: "center", gap: 6, opacity: 0.7,
          }}>
            <Ionicons name="add-circle-outline" size={20} color={p.muted} />
            <AppText center style={{ color: p.text, fontSize: 10, lineHeight: 12, fontWeight: "700" }}>Reserved slot</AppText>
            <AppText center style={{ color: p.muted, fontSize: 9 }}>Coming soon</AppText>
          </OwnerGlass> : null}
        </View>
        {selectedRule ? <OwnerGlass style={{ padding: 12, gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <AppText style={{ flex: 1, color: p.text, fontWeight: "700", fontSize: 13 }}>{selectedRule.label}</AppText>
            <Pressable testID="owner-automation-close-details" accessibilityRole="button"
              accessibilityLabel="Close automation details" onPress={() => setSelectedRuleKey(null)}
              style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: p.canvas }}>
              <AppText style={{ color: p.text, fontSize: 11 }}>Close</AppText>
            </Pressable>
          </View>
          <AppText style={{ color: p.muted, fontSize: 11 }}>
            {!selectedRule.published ? "Awaiting Central Admin publication" :
              selectedRule.globally_paused ? "Paused by Central Admin" :
              selectedRule.enabled ? "Enabled for this plant" : "Available — currently disabled"}
          </AppText>
          {selectedRule.key === "ORDER_PENDING_REMINDER" && selectedRule.enabled && selectedRule.published && !selectedRule.globally_paused ?
            <View style={{ gap: 6 }}>
              <AppText style={{ color: p.muted, fontSize: 11 }}>Remind after (minutes)</AppText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {REMINDER_MINUTES.map(minutes => <Pressable key={minutes} testID={"owner-reminder-" + minutes}
                  accessibilityRole="button" accessibilityState={{ selected: selectedRule.reminder_after_minutes === minutes }}
                  disabled={Boolean(busyRule)} onPress={() => void updateRule(selectedRule, true, minutes)}
                  style={{ borderRadius: 9, paddingVertical: 7, paddingHorizontal: 9,
                    backgroundColor: selectedRule.reminder_after_minutes === minutes ? p.accent : p.canvas }}>
                  <AppText style={{ fontSize: 11, color: selectedRule.reminder_after_minutes === minutes ? "#FFFFFF" : p.text }}>{minutes}</AppText>
                </Pressable>)}
              </View>
            </View> : null}
          {!selectedRule.key.startsWith("ORDER_") && selectedRule.enabled && selectedRule.published && !selectedRule.globally_paused ?
            <View style={{ gap: 6 }}>
              <AppText style={{ color: p.muted, fontSize: 11 }}>Escalate unresolved issues after (minutes)</AppText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {SLA_MINUTES.map(minutes => <Pressable key={minutes} testID={"owner-sla-" + selectedRule.key + "-" + minutes}
                  accessibilityRole="button" accessibilityState={{ selected: selectedRule.sla_minutes === minutes }}
                  disabled={Boolean(busyRule)} onPress={() => void updateRule(selectedRule, true, undefined, minutes)}
                  style={{ borderRadius: 9, paddingVertical: 7, paddingHorizontal: 9,
                    backgroundColor: selectedRule.sla_minutes === minutes ? p.accent : p.canvas }}>
                  <AppText style={{ fontSize: 11, color: selectedRule.sla_minutes === minutes ? "#FFFFFF" : p.text }}>{minutes}</AppText>
                </Pressable>)}
              </View>
            </View> : null}
        </OwnerGlass> : null}
        {plantId ? <OwnerGlass style={{ padding: 12, gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <AppText style={{ color: p.text, fontWeight: "700" }}>Review tasks</AppText>
            <Pressable testID="owner-automation-refresh-cases" accessibilityRole="button"
              onPress={() => void Promise.all([refreshTasks(), refreshHistory()])}
              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: p.canvas }}>
              <AppText style={{ color: p.text, fontSize: 11 }}>Refresh cases</AppText>
            </Pressable>
          </View>
          {tasksError ? <AppText accessibilityRole="alert" style={{ color: "#FCA5A5", fontSize: 12 }}>{tasksError}</AppText> : null}
          <AppText style={{ color: p.muted, fontSize: 12 }}>
            {(tasks?.tasks ?? []).filter(task => ["OPEN", "ACKNOWLEDGED"].includes(task.status)).length} unresolved review tasks
          </AppText>
          {(tasks?.tasks ?? []).filter(task => ["OPEN", "ACKNOWLEDGED"].includes(task.status)).slice(0, 10).map(task =>
            <View key={task.id} style={{ gap: 6 }}>
              <AppText style={{ color: p.text, fontSize: 12 }}>
                {task.order_number ? `Order ${task.order_number} — owner review` :
                  task.task_kind === "DISPATCH_UNASSIGNED_LOAD" ? "Dispatch — assign a planned load" :
                  task.task_kind === "RFQ_PENDING_PLANT" ? "RFQ — respond to quotation request" :
                  task.task_kind === "QUALITY_INSPECTION_FAILED" ? "Quality — review failed engineer inspection" :
                  task.task_kind === "INVENTORY_BELOW_MIN" ? "Inventory — review material stock" :
                  task.task_kind === "WORKFORCE_LEAVE_PENDING" ? "Workforce — review leave application" :
                  "Plant operation — review required"}
              </AppText>
              {!task.order_number && task.source_label ? <AppText style={{ color: p.muted, fontSize: 11 }}>
                {task.source_label}
              </AppText> : null}
              {task.status === "ACKNOWLEDGED" ? <AppText style={{ color: p.muted, fontSize: 11 }}>
                Acknowledged · awaiting verified operational resolution
              </AppText> : null}
              {(task.escalation_count ?? 0) > 0 ? <AppText style={{ color: "#F59E0B", fontSize: 11 }}>
                SLA escalated {task.escalation_count} time(s)
              </AppText> : null}
              {workspaceForTask(task.task_kind) ? <Pressable testID={`owner-automation-workspace-${task.id}`}
                accessibilityRole="button" onPress={() => {
                  const destination = workspaceForTask(task.task_kind);
                  if (destination) router.push(destination);
                }}
                style={{ alignSelf: "flex-start", borderRadius: 8, paddingVertical: 8,
                  paddingHorizontal: 12, backgroundColor: p.canvas }}>
                <AppText style={{ color: p.text, fontSize: 11 }}>Open operational module</AppText>
              </Pressable> : null}
              {task.task_kind === "QUALITY_INSPECTION_FAILED" ? <AppText style={{ color: p.muted, fontSize: 11 }}>
                Requires Quality Engineer verification. Acknowledgement does not close the failed inspection.
              </AppText> : null}
              {!task.order_number && task.status === "OPEN" ? <Pressable testID={`owner-automation-ack-${task.id}`}
                accessibilityRole="button" disabled={Boolean(busyTask)}
                onPress={() => void acknowledgeTask(task)}
                style={{ alignSelf: "flex-start", borderRadius: 8, paddingVertical: 8,
                  paddingHorizontal: 12, backgroundColor: p.canvas }}>
                <AppText style={{ color: p.text, fontSize: 11 }}>
                  {busyTask === task.id ? "Saving acknowledgement" : "Acknowledge alert (not approval)"}
                </AppText>
              </Pressable> : null}
            </View>)}
          <AppText style={{ color: p.muted, fontSize: 11 }}>
            Use existing authorized operational modules to resolve cases. Acknowledging an alert does not resolve it.
          </AppText>
        </OwnerGlass> : null}
        {plantId ? <AppText style={{ color: p.muted, fontSize: 11 }}>
          Recent automation: {(history?.jobs ?? []).slice(0, 5).map(job => `${job.template_key}: ${job.status}`).join(" · ") || "No executions yet"}
        </AppText> : null}
      </View>
      <View testID="owner-operations-module-directory" style={{ gap: 8 }}>
        {ownerModules(OPERATIONS_KEYS).map(module => <OwnerModuleRow key={module.key} module={module} />)}
      </View>
    </OwnerList>
  </OwnerFrame>;
}
