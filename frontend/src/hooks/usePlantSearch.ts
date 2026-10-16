import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { apiPost, apiErrorDetail } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { PlantData } from "@/src/components/PlantCard";
import { LatLng } from "@/src/maps/geo";

type Result = { plants: PlantData[]; page: number; has_more: boolean };
export function usePlantSearch(location: LatLng | null, filters: { q: string; grade: string; radius_km: number; verified: boolean }, page: number) {
  const { token } = useAuth();
  const body = JSON.stringify({ ...filters, lat: location?.lat, lng: location?.lng, page, page_size: 30 });
  const key = `${token}\0${body}`;
  const [state, setState] = useState<{key: string; data: Result | null; loading: boolean; error: string | null}>({key:"",data:null,loading:true,error:null});
  const sequence = useRef(0);
  const invalidate = useCallback(() => { sequence.current++; },[]);
  const cache = useRef(new Map<string, { at: number; result: Result }>());
  const clearCache = useCallback(() => cache.current.clear(),[]);
  const load = useCallback(async (force = false) => {
    const id = ++sequence.current;
    if (!token) return;
    const saved = cache.current.get(key);
    if (!force && saved && Date.now()-saved.at < 60000) { setState({key,data:saved.result,loading:false,error:null}); return; }
    setState(previous => ({key,data:previous.key === key ? previous.data : null,loading:true,error:null}));
    try {
      const result = await apiPost<Result>("/customer/plants/search", token, JSON.parse(body));
      if (id !== sequence.current) return;
      if (cache.current.size > 20) cache.current.clear();
      cache.current.set(key, {at:Date.now(),result});
      setState({key,data:result,loading:false,error:null});
    } catch (e) {
      if (id === sequence.current) setState(previous => ({...previous,key,loading:false,error:apiErrorDetail(e,"Could not find plants. Please retry.")}));
    }
  }, [body, key, token]);
  useEffect(() => {
    const timeout = setTimeout(() => void load(), 400);
    return () => { clearTimeout(timeout); invalidate(); };
  }, [load,invalidate]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", status => { if (status === "active") void load(); });
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    if (Platform.OS === "web") document.addEventListener("visibilitychange", onVisible);
    return () => { subscription.remove(); if (Platform.OS === "web") document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);
  return { clearCache, data:state.key === key ? state.data : null, loading:state.key !== key || state.loading, error:state.key === key ? state.error : null,
    refetch:useCallback(() => load(true),[load]), reload:useCallback(() => load(true),[load]) };
}
