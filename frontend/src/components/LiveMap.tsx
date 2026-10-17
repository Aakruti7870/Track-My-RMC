import React, { useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, View, ViewStyle } from "react-native";
import { WebView } from "react-native-webview";

import { AppText } from "@/src/components/ui/AppText";
import { radius } from "@/src/theme/tokens";

const MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || "";

type LatLng = { lat: number; lng: number };

/**
 * Live Google map for delivery tracking. Renders a real map (mixer marker,
 * site marker, route polyline) via the Maps JS API inside a WebView when a
 * client key is configured. GPS updates move existing markers without reloading
 * the Maps SDK, preserving the viewport and avoiding repeated map-load charges.
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
  const native = useRef<WebView | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const payload = useMemo(() => ({kind:"tracking-update",destination,mixer,origin,polyline}),[destination,mixer,origin,polyline]);
  const latest = useRef(payload);
  latest.current=payload;
  const updateMap = () => {
    frame.current?.contentWindow?.postMessage(latest.current,"*");
    native.current?.injectJavaScript(`window.updateTracking && window.updateTracking(${JSON.stringify(latest.current).replace(/</g,"\\u003c")});true;`);
  };
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(payload,"*");
    native.current?.injectJavaScript(`window.updateTracking && window.updateTracking(${JSON.stringify(payload).replace(/</g,"\\u003c")});true;`);
  },[payload]);

  const html = useMemo(() => {
    if (!canRender) return "";
    const initial = JSON.stringify(latest.current).replace(/</g,"\\u003c");
    return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body,#map{height:100%;margin:0;padding:0;background:#eee}</style></head>
<body><div id="map"></div><script>
var map,siteMarker,mixerMarker,plantMarker,line,lastPoly,fit=false,lastRouteAt=0,routeBusy=false,latest=${initial};
window.updateTracking=function(data){
 latest=data;if(!map)return;
 if(data.destination){if(!siteMarker)siteMarker=new google.maps.Marker({map:map,title:'Delivery site'});siteMarker.setPosition(data.destination)}
 if(data.mixer){if(!mixerMarker)mixerMarker=new google.maps.Marker({map:map,title:'Transit mixer'});mixerMarker.setPosition(data.mixer);mixerMarker.setMap(map)}else if(mixerMarker)mixerMarker.setMap(null);
 if(data.origin){if(!plantMarker)plantMarker=new google.maps.Marker({map:map,title:'Origin plant'});plantMarker.setPosition(data.origin);plantMarker.setMap(map)}else if(plantMarker)plantMarker.setMap(null);
 if(data.polyline!==lastPoly){lastPoly=data.polyline;if(line)line.setMap(null);if(lastPoly&&google.maps.geometry)line=new google.maps.Polyline({path:google.maps.geometry.encoding.decodePath(lastPoly),map:map,strokeColor:'#F18A20',strokeWeight:5})}
 if(data.mixer&&data.destination&&!data.polyline&&!routeBusy&&Date.now()-lastRouteAt>60000){
  routeBusy=true;lastRouteAt=Date.now();
  new google.maps.DirectionsService().route({origin:data.mixer,destination:data.destination,travelMode:'DRIVING'},function(result,status){
    routeBusy=false;if(status==='OK'&&result.routes[0]){if(line)line.setMap(null);line=new google.maps.Polyline({path:result.routes[0].overview_path,map:map,strokeColor:'#F18A20',strokeWeight:5});}
  });
 }
 if(!fit&&data.destination){var bounds=new google.maps.LatLngBounds();bounds.extend(data.destination);if(data.origin)bounds.extend(data.origin);if(data.mixer)bounds.extend(data.mixer);map.fitBounds(bounds,50);fit=true;}
};
window.addEventListener('message',function(event){if(event.source===parent&&event.data.kind==='tracking-update')window.updateTracking(event.data)});
function init(){
 map=new google.maps.Map(document.getElementById('map'),{center:latest.destination,zoom:13,gestureHandling:'cooperative'});
 window.updateTracking(latest);
}
function mapFailed(){document.body.innerHTML='<div style="display:flex;height:100%;align-items:center;justify-content:center;font-family:sans-serif;color:#888;padding:16px;text-align:center">The map could not load. Your recorded trip details remain available below.</div>';};
window.gm_authFailure=mapFailed;
setTimeout(function(){if(!map)mapFailed()},15000);
</script>
<script async onerror="mapFailed()" src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&libraries=geometry&loading=async&callback=init"></script>
</body></html>`;
  }, [canRender]);
  const source = useMemo(() => ({html}),[html]);

  if (!canRender) {
    return (
      <View style={[styles.wrap,style,{padding:16,minHeight:80}]}><AppText>{!MAPS_KEY ? "The map is currently unavailable." : "The delivery site has no map coordinates."} {ended ? "Tracking ended." : "Recorded trip details are shown below."}</AppText></View>
    );
  }

  // react-native-web has no WebView — render a real iframe on web, WebView on native.
  if (Platform.OS === "web") {
    return (
      <View style={[styles.wrap, style]}>
        {React.createElement("iframe", {
          ref:frame,
          onLoad:updateMap,
          title:"Live delivery tracking",
          // @ts-ignore — raw DOM element under react-native-web
          "data-testid": "live-map",
          srcDoc: html,
          style: { border: 0, width: "100%", height: "100%", minHeight: 0, flex: 1 },
        })}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        ref={native}
        onLoadEnd={updateMap}
        testID="live-map"
        originWhitelist={["*"]}
        source={source}
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
