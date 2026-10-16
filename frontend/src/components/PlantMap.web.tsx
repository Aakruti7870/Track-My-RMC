import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { PlantData } from "./PlantCard";
import { AppText } from "./ui/AppText";
import { LatLng, validLatLng } from "@/src/maps/geo";

type Props = { plants: PlantData[]; userLocation?: LatLng | null; onSelectPlant?: (plant: PlantData) => void; onRegionChange?: (center: LatLng) => void };
const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || "";

export function PlantMap({ plants, userLocation, onSelectPlant, onRegionChange }: Props) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const callbacks = useRef({plants,onSelectPlant,onRegionChange});
  callbacks.current = {plants,onSelectPlant,onRegionChange};
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mapped = useMemo(() => plants.filter(validLatLng).map(p => ({id:p.id,name:p.name,lat:p.lat,lng:p.lng})),[plants]);
  const html = useMemo(() => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#map{height:100%;margin:0}</style></head><body><div id="map"></div><script>
    var map, markers=[],center=null;
    function send(data){parent.postMessage(data,'*')}
    window.gm_authFailure=function(){send({kind:'map-error',reason:'Google Maps authentication failed. Verify API key, allowed HTTP referrers, Maps JavaScript API and billing.'})};
    function init(){
      map=new google.maps.Map(document.getElementById('map'),{center:{lat:20,lng:78},zoom:5,gestureHandling:'cooperative'});
      var dragged=false;map.addListener('dragstart',function(){dragged=true});
      map.addListener('idle',function(){if(dragged){dragged=false;send({kind:'map-center',center:map.getCenter().toJSON()})}});
      send({kind:'map-ready'});
    }
    window.addEventListener('message',function(event){
      if(event.source!==parent||!map||event.data.kind!=='map-data')return;
      var d=event.data;markers.forEach(function(m){m.setMap(null)});markers=[];
      d.plants.forEach(function(p){var m=new google.maps.Marker({position:{lat:p.lat,lng:p.lng},title:p.name,map:map});m.addListener('click',function(){send({kind:'map-plant',id:p.id})});markers.push(m)});
      if(d.center){markers.push(new google.maps.Marker({position:d.center,title:'Selected site',map:map}));}
      var next=d.center||(d.plants.length?{lat:d.plants[0].lat,lng:d.plants[0].lng}:null);
      if(next&&(!center||center.lat!==next.lat||center.lng!==next.lng)){center=next;map.panTo(next);if(map.getZoom()<9)map.setZoom(11)}
    });
    </script><script async onerror="send({kind:'map-error',reason:'Google Maps JavaScript API failed to load. Verify network access and API restrictions.'})" src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&loading=async&callback=init"></script></body></html>`,[]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.kind === "map-ready") setReady(true);
      if (event.data?.kind === "map-error") { setReady(false); setError(event.data.reason || "The map could not load. Check your connection or use Directions from a plant card."); }
      if (event.data?.kind === "map-center" && validLatLng(event.data.center)) callbacks.current.onRegionChange?.(event.data.center);
      if (event.data?.kind === "map-plant") { const plant = callbacks.current.plants.find(p => p.id===event.data.id); if (plant) callbacks.current.onSelectPlant?.(plant); }
    };
    window.addEventListener("message",listener);
    return () => window.removeEventListener("message",listener);
  },[]);
  useEffect(() => { if (ready) frame.current?.contentWindow?.postMessage({kind:"map-data",plants:mapped,center:userLocation},"*"); },[ready,mapped,userLocation]);
  if (!KEY || error) return <View style={{padding:16}}><AppText>{error || "The map is currently unavailable. Browse the plant list or open Directions below."}</AppText></View>;
  return <View style={{minHeight:300,borderRadius:16,overflow:"hidden"}}>
    {React.createElement("iframe",{ref:frame,title:"Nearby concrete plants",srcDoc:html,sandbox:"allow-scripts allow-same-origin",style:{width:"100%",height:300,border:0}})}
  </View>;
}
