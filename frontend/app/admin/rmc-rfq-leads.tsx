import React from "react";
import { View } from "react-native";
import { AppText } from "@/src/components/ui/AppText";

// Retained as a safe landing for old deep links. Global customer leads require
// the separate Central Admin web identity; no mobile token is sent here.
export default function AdminRmcRfqLeads() {
  return <View style={{ padding: 24 }}>
    <AppText>Global RFQ lead management is available through the approved Central Admin web portal.</AppText>
  </View>;
}
