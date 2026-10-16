import { useEffect, useRef } from "react";
import { Alert, BackHandler, Platform } from "react-native";
import { usePathname } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { ROLE_ROUTES } from "@/src/auth/roleRoutes";

export function RootBackHandler() {
  const path = usePathname();
  const { token } = useAuth();
  const showing = useRef(false);
  useEffect(() => {
    if (Platform.OS !== "android" || !token) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress",() => {
      const root = Object.values(ROLE_ROUTES).some(route => path.replace(/\/$/,"") === route);
      if (!root) return false;
      if (showing.current) return true;
      showing.current = true;
      const dismiss = () => {showing.current=false;};
      Alert.alert("Exit TrackMyRMC?","You can return to your signed-in account anytime.",[
        {text:"Stay in App",style:"cancel",onPress:dismiss},
        {text:"Exit App",onPress:() => {dismiss();BackHandler.exitApp();}},
      ],{cancelable:true,onDismiss:dismiss});
      return true;
    });
    return () => subscription.remove();
  },[path,token]);
  return null;
}
