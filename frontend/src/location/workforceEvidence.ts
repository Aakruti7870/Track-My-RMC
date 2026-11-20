import * as Location from "expo-location";
import { requestFieldVisitLocationConsent } from "@/src/location/BackgroundLocationConsent";

export async function fieldVisitLocationEvidence() {
  if (!(await requestFieldVisitLocationConsent())) {
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
