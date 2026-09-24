import { useCallback, useEffect, useRef, useState } from "react";

import { apiErrorDetail, apiGet } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";

type RequestState<T> = {
  key: string | null;
  data: T | null;
  loading: boolean;
  error: string | null;
};

export function useGet<T>(path: string | null) {
  const { token } = useAuth();
  // Bind visible state to the exact authenticated request. This prevents data
  // from a prior user/path remaining visible while a new request is in flight.
  const requestKey = token && path ? `${path}\u0000${token}` : null;
  const [state, setState] = useState<RequestState<T>>({
    key: null,
    data: null,
    loading: Boolean(requestKey),
    error: null,
  });
  const requestId = useRef(0);
  const activeAbort = useRef<AbortController | null>(null);

  const load = useCallback(
    async (showSpinner = true) => {
      const currentRequest = ++requestId.current;
      const currentKey = requestKey;

      // Stop the previous network request, not just its eventual state update.
      // This avoids wasting mobile bandwidth/server work when path, token or
      // an explicit refresh supersedes an in-flight GET.
      activeAbort.current?.abort();
      activeAbort.current = null;

      if (!token || !path || !currentKey) {
        setState({ key: null, data: null, loading: false, error: null });
        return;
      }

      const controller = new AbortController();
      activeAbort.current = controller;

      setState((previous) => ({
        key: currentKey,
        data: previous.key === currentKey ? previous.data : null,
        loading: showSpinner ? true : previous.key === currentKey ? previous.loading : true,
        error: null,
      }));

      try {
        const res = await apiGet<T>(path, token, controller.signal);
        if (currentRequest === requestId.current) {
          setState({ key: currentKey, data: res, loading: false, error: null });
        }
      } catch (error: unknown) {
        if (currentRequest === requestId.current) {
          setState((previous) => ({
            key: currentKey,
            data: previous.key === currentKey ? previous.data : null,
            loading: false,
            error: apiErrorDetail(error, "Something went wrong"),
          }));
        }
      } finally {
        if (currentRequest === requestId.current && activeAbort.current === controller) {
          activeAbort.current = null;
        }
      }
    },
    [path, requestKey, token],
  );

  useEffect(() => {
    void load(true);
    return () => {
      requestId.current += 1;
      activeAbort.current?.abort();
      activeAbort.current = null;
    };
  }, [load]);

  const current = state.key === requestKey;

  return {
    data: current ? state.data : null,
    loading: requestKey ? (current ? state.loading : true) : false,
    error: current ? state.error : null,
    refetch: () => load(false),
    reload: () => load(true),
  };
}
