import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../api.js";

const SOURCE_LABEL = {
  cache: "risultato in cache: dati e regole invariati",
  riusata: "codice già validato riusato sui nuovi dati, senza chiamate all'AI",
  generata: "codice scritto dall'AI e verificato dai controlli automatici",
};

export const describeSource = (s) => SOURCE_LABEL[s] ?? s;

/** Stato della pulizia, con polling mentre un aggiornamento è in corso o in coda. */
export function useCleaningStatus() {
  const [status, setStatus] = useState(null);
  const timer = useRef(null);
  const load = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const s = await api.cleaning();
      setStatus(s);
      if (s.refreshing || s.queued || s.status === "cleaning") timer.current = setTimeout(load, 2500);
    } catch (err) {
      setStatus({ error: err.message });
    }
  }, []);
  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
  }, [load]);
  const busy = Boolean(status && (status.refreshing || status.queued || status.status === "cleaning"));
  return { status, busy, reload: load };
}
