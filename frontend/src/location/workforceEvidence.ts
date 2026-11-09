import * as Location from "expo-location";
import {
  requestAttendanceLocationConsent,
  requestFieldVisitLocationConsent,
} from "@/src/location/BackgroundLocationConsent";

/**
 * One approved GPS evidence flow for staff Home check-in, the Workforce screen,
 * and field visits. Permission/consent approval never creates an attendance
 * record: POST is initiated only when the employee explicitly taps Check In.
 */
export async function workforceLocationEvidence(purpose: "attendance" | "field-visit") {
  const consented = purpose === "attendance"
    ? await requestAttendanceLocationConsent()
    : await requestFieldVisitLocationConsent();
  if (!consented) {
    throw { detail: "Location sharing was not approved. You can continue without attaching coordinates." };
  }
  let permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== "granted") permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") {
    throw { detail: "Location permission is required for this action" };
  }
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy_m: pos.coords.accuracy ?? undefined,
  };
}
