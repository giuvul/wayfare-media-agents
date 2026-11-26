// Modello che ha risposto davvero: per ogni chiamata al modello OpenRouter restituisce un id di generazione
// ("gen-..."), e l'endpoint /generation dice quale modello e quale provider l'hanno servita e quanto è costata.
// Serve perché, con i modelli di riserva attivi, OpenRouter può rispondere con un modello diverso da quello scelto.
// L'endpoint è gratuito ma richiede la chiave dell'account che ha fatto la chiamata, e i dati compaiono solo
// qualche secondo dopo la risposta (prima rispondono 404): chi chiede riprova finché l'id non è disponibile.

export const GENERATION_ID = /^gen-[\w-]{1,80}$/;

/** true se il modello servito è quello scelto (OpenRouter può aggiungere la versione: "...-20260910"). */
export const sameModel = (served, requested) => served === requested || served.startsWith(`${requested}-`);

export function createGenerationService({ config, settings, fetchImpl = fetch }) {
  const cache = new Map(); // id -> dettagli: una generazione conclusa non cambia più
  const misses = new Map(); // id -> momento dell'ultimo 404
  const MAX_CACHE = 2000;
  const MISS_TTL_MS = 3_000; // il frontend riprova ogni 4 s

  async function fetchOne(id, apiKey) {
    const url = new URL(`${config.OPENROUTER_BASE_URL}/generation`);
    url.searchParams.set("id", id);
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null; // non ancora disponibile (o generata con un'altra chiave)
    if (!res.ok) throw new Error(`OpenRouter /generation HTTP ${res.status}`);
    const { data } = await res.json();
    return { model: data.model, provider: data.provider_name ?? null, costUsd: data.total_cost ?? null };
  }

  return {
    /** Dettagli per id; `null` per gli id non ancora disponibili. Gli errori di rete contano come non disponibili. */
    async lookup(ids) {
      const { apiKey } = settings.get();
      const out = {};
      await Promise.all(
        ids.map(async (id) => {
          const miss = misses.get(id);
          if (!cache.has(id) && !(miss !== undefined && Date.now() - miss < MISS_TTL_MS)) {
            const info = await fetchOne(id, apiKey).catch(() => null);
            if (info) {
              if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
              cache.set(id, info);
              misses.delete(id);
            } else {
              if (misses.size >= MAX_CACHE) misses.delete(misses.keys().next().value);
              misses.set(id, Date.now()); // non ancora disponibile: non si richiede di nuovo per qualche secondo
            }
          }
          out[id] = cache.get(id) ?? null;
        }),
      );
      return out;
    },
  };
}
