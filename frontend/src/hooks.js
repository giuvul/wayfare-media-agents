// Hook condivisi: ricerche con debounce e polling di un job sul server.
import { useCallback, useEffect, useRef, useState } from "react";

/** Il valore si aggiorna solo dopo `ms` senza modifiche (ricerche mentre si scrive). */
export function useDebouncedValue(value, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Ricerca in un catalogo remoto mentre si scrive: debounce, la richiesta precedente viene annullata e un
 * errore sparisce alla prima ricerca riuscita. `search(q, signal)` deve essere stabile (es. un metodo di `api`).
 */
export function useCatalogSearch(search, query, ms = 250) {
  const q = useDebouncedValue(query.trim(), ms);
  const [state, setState] = useState({ result: null, error: null });
  useEffect(() => {
    const ctrl = new AbortController();
    search(q, ctrl.signal).then(
      (result) => setState({ result, error: null }),
      (err) => err.name !== "AbortError" && setState((s) => ({ ...s, error: err.message })),
    );
    return () => ctrl.abort();
  }, [search, q]);
  return state;
}

/**
 * Carica `fetcher()` e lo ripete ogni `intervalMs` finché `shouldContinue(data)` è vero (un job in corso).
 * `reload(delay)` forza un nuovo caricamento; timer e risposte in arrivo dopo lo smontaggio vengono ignorati.
 */
export function usePolling(fetcher, shouldContinue, intervalMs) {
  const [state, setState] = useState({ data: null, error: null });
  const [tick, setTick] = useState(0);
  const timer = useRef(null);
  const latest = useRef({ fetcher, shouldContinue });
  useEffect(() => {
    latest.current = { fetcher, shouldContinue };
  });
  const reload = useCallback((delay = 0) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setTick((n) => n + 1), delay);
  }, []);
  useEffect(() => {
    let alive = true;
    latest.current.fetcher().then(
      (data) => {
        if (!alive) return;
        setState({ data, error: null });
        if (latest.current.shouldContinue(data)) reload(intervalMs);
      },
      (err) => alive && setState((s) => ({ ...s, error: err.message })),
    );
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [tick, intervalMs, reload]);
  return { ...state, reload };
}
