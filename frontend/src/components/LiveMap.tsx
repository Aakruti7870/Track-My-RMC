import React, { useMemo } from "react";
import { Platform, StyleSheet, View, ViewStyle } from "react-native";
import { WebView } from "react-native-webview";

import { AppText } from "@/src/components/ui/AppText";
import { radius } from "@/src/theme/tokens";

const MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || "";

type LatLng = { lat: number; lng: number };

/**
 * Live Google map for delivery tracking. Renders a real map (mixer marker,
 * site marker, route polyline) via the Maps JS API inside a WebView when a
 * client key is configured; otherwise falls back to the on-brand placeholder.
 */
export function LiveMap({
  origin,
  destination,
  mixer,
  polyline,
  ended,
  style,
}: {
  origin?: LatLng | null;
  destination?: LatLng | null;
  mixer?: LatLng | null;
  polyline?: string | null;
  ended?: boolean;
  style?: ViewStyle;
}) {
  const canRender = !!MAPS_KEY && !!destination && destination.lat != null && destination.lng != null;

  const html = useMemo(() => {
    if (!canRender) return "";
    const site = `{lat:${destination!.lat},lng:${destination!.lng}}`;
    const mk = mixer && mixer.lat != null ? `{lat:${mixer.lat},lng:${mixer.lng}}` : "null";
    const poly = polyline ? JSON.stringify(polyline) : "null";
    const plant = origin ? JSON.stringify(origin) : "null";
    return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body,#map{height:100%;margin:0;padding:0;background:#eee}</style></head>
<body><div id="map"></div><script>
function init(){
 var site=${site};var mixer=${mk};var poly=${poly};var plant=${plant};
 var map=new google.maps.Map(document.getElementById('map'),{center:site,zoom:13,disableDefaultUI:true,gestureHandling:'greedy'});
 new google.maps.Marker({position:site,map:map,title:'Delivery site'});
 var b=new google.maps.LatLngBounds();b.extend(site);
 if(plant){new google.maps.Marker({position:plant,map:map,title:'Origin plant'});b.extend(plant);}
 if(mixer){new google.maps.Marker({position:mixer,map:map,title:'Transit mixer',icon:{path:google.maps.SymbolPath.CIRCLE,scale:8,fillColor:'#CCFF00',fillOpacity:1,strokeColor:'#121212',strokeWeight:2}});b.extend(mixer);}
 if(poly&&google.maps.geometry){var path=google.maps.geometry.encoding.decodePath(poly);new google.maps.Polyline({path:path,map:map,strokeColor:'#121212',strokeWeight:5,strokeOpacity:0.85});path.forEach(function(p){b.extend(p)});}
 if(mixer||poly||plant){map.fitBounds(b,50);}
}
window.gm_authFailure=function(){document.body.innerHTML='<div style="display:flex;height:100%;align-items:center;justify-content:center;font-family:sans-serif;color:#888;padding:16px;text-align:center">Map key not authorized for this domain</div>';};
</script>
<script async src="https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=geometry&loading=async&callback=init"></script>
</body></html>`;
  }, [canRender, destination?.lat, destination?.lng, mixer?.lat, mixer?.lng, origin?.lat, origin?.lng, polyline]);

  if (!canRender) {
    return (
      <View style={[styles.wrap,style,{padding:16}]}><AppText>{!MAPS_KEY ? "Map unavailable: Google Maps is not configured for this build." : "The delivery site has no map coordinates."} {ended ? "Tracking ended." : "Recorded trip details are shown below."}</AppText></View>
    );
  }

  // react-native-web has no WebView — render a real iframe on web, WebView on native.
  if (Platform.OS === "web") {
    return (
      <View style={[styles.wrap, style]}>
        {React.createElement("iframe", {
          // @ts-ignore — raw DOM element under react-native-web
          "data-testid": "live-map",
          srcDoc: html,
          style: { border: 0, width: "100%", height: 260 },
        })}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        testID="live-map"
        originWhitelist={["*"]}
        source={{ html }}
        style={{ flex: 1, backgroundColor: "transparent" }}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: "hidden", minHeight: 240 },
});
