import { api } from "../../api.js";
import { usePolling } from "../../hooks.js";

const SOURCE_LABEL = {
  cache: "risultato in cache: dati e regole invariati",
  riusata: "codice già validato riusato sui nuovi dati, senza chiamate all'AI",
  generata: "codice scritto dall'AI e verificato dai controlli automatici",
};

export const describeSource = (s) => SOURCE_LABEL[s] ?? s;

const inProgress = (s) => Boolean(s && (s.refreshing || s.queued || s.status === "cleaning"));

/** Stato della pulizia, con polling mentre un aggiornamento è in corso o in coda. `reload(ms)` lo ricarica. */
export function useCleaningStatus() {
  const { data, error, reload } = usePolling(api.cleaning, inProgress, 2500);
  const status = error ? { ...data, error } : data;
  return { status, busy: inProgress(data), reload };
}
