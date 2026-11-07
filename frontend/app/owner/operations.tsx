import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
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
};
type OwnerTask = { id: string; order_number: string; task_kind: string; status: string; source_label?: string };
type AutomationHistory = { id: string; template_key: string; status: string; attempts: number };
const REMINDER_MINUTES = [30, 60, 120, 240] as const;

export default function OwnerOperations() {
  const p = useOwnerPalette();
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
    useGet<{ rules: AutomationRule[] }>(base ? `${base}/rules` : null);
  const { data: tasks, refetch: refreshTasks } =
    useGet<{ tasks: OwnerTask[] }>(base ? `${base}/tasks` : null);
  const { data: history, refetch: refreshHistory } =
    useGet<{ jobs: AutomationHistory[] }>(base ? `${base}/history` : null);

  async function updateRule(rule: AutomationRule, enabled: boolean, reminderMinutes?: number) {
    if (!base || !token || busyRule || (enabled && (!rule.published || rule.globally_paused))) return;
    setBusyRule(rule.key);
    setRequestError("");
    setNotice("");
    try {
      await apiPut(`${base}/rules/${encodeURIComponent(rule.key)}`, token, {
        enabled,
        ...(reminderMinutes !== undefined ? { reminder_after_minutes: reminderMinutes } : {}),
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
        {(rules?.rules ?? []).map(rule => {
          const available = rule.published && !rule.globally_paused;
          const isReminder = rule.key === "ORDER_PENDING_REMINDER";
          return <OwnerGlass key={rule.key} style={{ padding: 13, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <AppText style={{ color: p.text, fontWeight: "700", fontSize: 13 }}>{rule.label}</AppText>
                <AppText style={{ color: p.muted, fontSize: 11 }}>
                  {!rule.published ? "Awaiting Central Admin publication" :
                    rule.globally_paused ? "Paused by Central Admin" :
                    rule.enabled ? "Enabled for this plant" : "Available — currently disabled"}
                </AppText>
              </View>
              <Pressable testID={`owner-automation-toggle-${rule.key}`} accessibilityRole="switch"
                accessibilityState={{ checked: rule.enabled && available, disabled: (!available && !rule.enabled) || Boolean(busyRule) }}
                disabled={(!available && !rule.enabled) || Boolean(busyRule)}
                onPress={() => void updateRule(rule, !rule.enabled)}
                style={{ minWidth: 72, padding: 10, borderRadius: 12,
                  backgroundColor: rule.enabled && available ? p.accent : p.canvas }}>
                <AppText center style={{ color: rule.enabled && available ? "#FFFFFF" : p.text, fontSize: 12 }}>
                  {busyRule === rule.key ? "Saving" : rule.enabled && available ? "On" : "Off"}
                </AppText>
              </Pressable>
            </View>
            {isReminder && rule.enabled && available ? <View style={{ gap: 6 }}>
              <AppText style={{ color: p.muted, fontSize: 11 }}>Remind after (minutes)</AppText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {REMINDER_MINUTES.map(minutes => <Pressable key={minutes} testID={`owner-reminder-${minutes}`}
                  accessibilityRole="button" accessibilityState={{ selected: rule.reminder_after_minutes === minutes }}
                  disabled={Boolean(busyRule)}
                  onPress={() => void updateRule(rule, true, minutes)}
                  style={{ borderRadius: 9, paddingVertical: 7, paddingHorizontal: 9,
                    backgroundColor: rule.reminder_after_minutes === minutes ? p.accent : p.canvas }}>
                  <AppText style={{ fontSize: 11, color: rule.reminder_after_minutes === minutes ? "#FFFFFF" : p.text }}>{minutes}</AppText>
                </Pressable>)}
              </View>
            </View> : null}
          </OwnerGlass>;
        })}
        {plantId ? <OwnerGlass style={{ padding: 12, gap: 6 }}>
          <AppText style={{ color: p.text, fontWeight: "700" }}>Review tasks</AppText>
          <AppText style={{ color: p.muted, fontSize: 12 }}>
            {(tasks?.tasks ?? []).filter(task => task.status === "OPEN").length} open review tasks
          </AppText>
          {(tasks?.tasks ?? []).filter(task => task.status === "OPEN").slice(0, 5).map(task =>
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
              {!task.order_number ? <Pressable testID={`owner-automation-ack-${task.id}`}
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
            Decisions must be made through the existing Plant Orders screen.
          </AppText>
        </OwnerGlass> : null}
        {plantId ? <AppText style={{ color: p.muted, fontSize: 11 }}>
          Recent automation: {(history?.jobs ?? []).slice(0, 5).map(job => `${job.template_key}: ${job.status}`).join(" · ") || "No executions yet"}
        </AppText> : null}
      </View>
      {ownerModules(OPERATIONS_KEYS).map(module => <OwnerModuleRow key={module.key} module={module} />)}
    </OwnerList>
  </OwnerFrame>;
}
