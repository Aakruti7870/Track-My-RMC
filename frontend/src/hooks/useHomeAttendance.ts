import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import { apiErrorDetail, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { currentLocationFailureMessage, getCurrentDeviceLocation } from "@/src/location/currentLocation";

type Times = { check_in: string | null; check_out: string | null };
type AttendanceResponse = Partial<Times> & { attendance?: Times | null };
type Action = "in" | "out";

const endpoints = {
  staff: { read: "/workforce/me", in: "/workforce/attendance/punch-in", out: "/workforce/attendance/punch-out" },
  driver: { read: "/driver/attendance", in: "/driver/attendance/checkin", out: "/driver/attendance/checkout" },
};

export function useHomeAttendance(kind: keyof typeof endpoints, onRecorded?: () => void) {
  const { token } = useAuth();
  const toast = useToast();
  const endpoint = endpoints[kind];
  const { data, loading, error, refetch, reload } = useGet<AttendanceResponse>(endpoint.read);
  const [pending, setPending] = useState<Action | null>(null);
  const inFlight = useRef(false);
  const attendance = kind === "driver" ? data : data?.attendance;
  const ready = Boolean(data && !error && !loading);
  const complete = Boolean(attendance?.check_out);
  const checkedIn = Boolean(attendance?.check_in && !complete);
  const next = ready && !complete ? (checkedIn ? "out" : "in") : null;

  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  async function record(action: Action) {
    if (!token || inFlight.current || action !== next) return;
    inFlight.current = true;
    setPending(action);
    try {
      const result = await getCurrentDeviceLocation("attendance");
      if (!result.ok) {
        toast(currentLocationFailureMessage(result), "error");
        return;
      }
      const { lat, lng } = result.location;
      try {
        await apiPost(endpoint[action], token, { lat, lng });
      } finally {
        await refetch();
      }
      onRecorded?.();
      toast(action === "in" ? "Checked in for today" : "Checked out for today", "success");
    } catch (failure) {
      toast(apiErrorDetail(failure, "Attendance could not be updated. Please try again."), "error");
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  return { loading, error, next, checkedIn, complete, pending, record, refetch, reload };
}

export type HomeAttendance = ReturnType<typeof useHomeAttendance>;
