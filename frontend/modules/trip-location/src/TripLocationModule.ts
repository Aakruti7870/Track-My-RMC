import { NativeModule, requireOptionalNativeModule } from "expo";

export type NativeCurrentLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

export declare class TripLocationNativeModule extends NativeModule {
  isAvailable(): boolean;
  getCurrentLocation(): Promise<NativeCurrentLocation>;
  startTracking(tripId: string, backendUrl: string, token: string): Promise<boolean>;
  stopTracking(): Promise<boolean>;
}

export default requireOptionalNativeModule<TripLocationNativeModule>("TripLocation");
