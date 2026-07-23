import { useCallback, useEffect, useState } from "react";
import { diagramApi } from "../../../../../api/diagrams";
import { useTranslation } from "react-i18next";

function readError(error, t) {
  return error?.message || t("failed_to_load_diagrams");
}

export function useDiagramList() {
  const { t } = useTranslation();
  const [state, setState] = useState({
    loading: true,
    error: null,
    unauthorized: false,
    items: [],
  });

  const refresh = useCallback(() => {
    let cancelled = false;
    setState((current) => ({
      ...current,
      loading: true,
      error: null,
      unauthorized: false,
    }));
    diagramApi
      .list()
      .then((items) => {
        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            unauthorized: false,
            items: items.map((item) => ({
              ...item,
              diagramId: item.id,
              lastModified: item.updated_at,
            })),
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          // A 401 means the caller has no valid token yet: surface it distinctly
          // so the Open dialog can prompt for one and retry, rather than showing
          // a dead error banner.
          setState({
            loading: false,
            error: readError(error, t),
            unauthorized: error?.status === 401,
            items: [],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(refresh, [refresh]);

  return {
    loading: state.loading,
    error: state.error,
    unauthorized: state.unauthorized,
    cloud: [],
    local: state.items,
    cloudEnabled: false,
    currentUserId: null,
    refresh,
  };
}
