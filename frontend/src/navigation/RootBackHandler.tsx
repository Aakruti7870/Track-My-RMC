import React, { useEffect, useRef, useState } from "react";
import { BackHandler, Modal, Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth/AuthContext";
import { ROLE_ROUTES } from "@/src/auth/roleRoutes";
import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";

/** Native app-exit confirmation at every authenticated role's Home tab. */
export function isRoleHome(path: string): boolean {
  const canonical = path.replace(/\/+$/, "").replace(/\/index$/, "") || "/";
  return Object.values(ROLE_ROUTES).some(route => canonical === route);
}

export function RootBackHandler() {
  const path = usePathname();
  const { token, user } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const showing = useRef(false);
  const onHome = !!token && !!user && isRoleHome(path);

  const dismiss = () => {
    showing.current = false;
    setVisible(false);
  };
  useEffect(() => {
    if (!onHome) dismiss();
  }, [onHome]);

  useEffect(() => {
    if (Platform.OS !== "android" || !onHome) return;
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!showing.current) {
        showing.current = true;
        setVisible(true);
      }
      return true; // never exit or accidentally navigate to login without confirmation
    });
    return () => handler.remove();
  }, [onHome]);

  useEffect(() => {
    if (Platform.OS !== "web" || !onHome) return;
    // Browsers control the final wording and whether a beforeunload prompt appears;
    // a website cannot reliably exit a browser tab programmatically.
    const confirmUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", confirmUnload);
    return () => window.removeEventListener("beforeunload", confirmUnload);
  }, [onHome]);

  return <>
    <Modal visible={Platform.OS === "android" && visible}
      animationType="fade" transparent statusBarTranslucent
      onRequestClose={dismiss}>
      <View style={{flex:1,backgroundColor:"rgba(0,0,0,0.62)",justifyContent:"flex-end"}}>
        <Pressable accessibilityLabel="Stay in TrackMyRMC" onPress={dismiss}
          style={{flex:1}}/>
        <View style={{backgroundColor:colors.surface,borderTopLeftRadius:28,borderTopRightRadius:28,
          borderWidth:1,borderColor:colors.border,padding:22,paddingBottom:insets.bottom+24,gap:13}}>
          <View style={{alignItems:"center",gap:9,paddingTop:3}}>
            <View style={{width:64,height:64,borderRadius:22,alignItems:"center",justifyContent:"center",
              backgroundColor:colors.brandSoft}}>
              <Ionicons name="log-out-outline" size={30} color={colors.brand}/>
            </View>
            <AppText variant="heading" center>Exit TrackMyRMC?</AppText>
            <AppText variant="bodyMuted" center>
              Your account will stay signed in. You can return anytime to check orders, deliveries and updates.
            </AppText>
          </View>
          <Button testID="exit-confirm-stay" label="Stay in App" onPress={dismiss}/>
          <Button testID="exit-confirm-exit" label="Exit App" variant="outline"
            onPress={() => { dismiss(); BackHandler.exitApp(); }}/>
        </View>
      </View>
    </Modal>
  </>;
}
