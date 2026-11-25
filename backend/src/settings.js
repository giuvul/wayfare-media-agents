// Impostazioni modificabili dall'interfaccia: chiave API OpenRouter e modello.
// Valori di default dal .env; quelli scelti dall'utente sono salvati in SQLite e hanno la precedenza.
// La chiave non viene mai restituita al browser né scritta nei log: solo una versione mascherata.

const MODELS_TTL_MS = 60 * 60 * 1000;
const KEY_INFO_TTL_MS = 60 * 1000;

export class SettingsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function maskKey(key) {
  if (!key) return null;
  return key.length <= 12 ? "••••" : `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export function toModel(m) {
  const perMillion = (v) => (v == null ? null : Math.round(Number(v) * 1e6 * 1000) / 1000);
  return {
    id: m.id,
    name: m.name ?? m.id,
    contextLength: m.context_length ?? null,
    promptPrice: perMillion(m.pricing?.prompt),
    completionPrice: perMillion(m.pricing?.completion),
    created: m.created ?? null,
  };
}

export function searchModels(models, query, limit = 50) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = terms.length
    ? models.filter((m) => terms.every((t) => `${m.id} ${m.name}`.toLowerCase().includes(t)))
    : models;
  return hits.slice(0, limit);
}

export function createSettingsService({ config, store, fetchImpl = fetch }) {
  let version = 0;
  let modelsCache = { at: 0, models: [] };
  let keyInfoCache = { at: 0, key: null, info: null };

  const current = () => {
    const uiKey = store.get("openrouter_api_key");
    const uiModel = store.get("llm_model");
    return {
      apiKey: uiKey ?? config.OPENROUTER_API_KEY,
      apiKeySource: uiKey ? "ui" : "env",
      model: uiModel ?? config.LLM_MODEL,
      modelSource: uiModel ? "ui" : "env",
    };
  };

  async function fetchKeyInfo(apiKey) {
    const res = await fetchImpl(new URL(`${config.OPENROUTER_BASE_URL}/key`), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new SettingsError(`OpenRouter non raggiungibile (HTTP ${res.status}).`, 502);
    const { data } = await res.json();
    return { usage: data.usage ?? null, limit: data.limit ?? null, limitRemaining: data.limit_remaining ?? null };
  }

  async function listModels() {
    if (Date.now() - modelsCache.at < MODELS_TTL_MS && modelsCache.models.length) return modelsCache.models;
    const res = await fetchImpl(new URL(`${config.OPENROUTER_BASE_URL}/models`), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new SettingsError(`Elenco modelli non disponibile (HTTP ${res.status}).`, 502);
    const { data } = await res.json();
    // l'orchestratore e l'analista usano il tool calling: si mostrano solo i modelli che lo supportano
    const models = data
      .filter((m) => (m.supported_parameters ?? []).includes("tools"))
      .map(toModel)
      .sort((a, b) => a.name.localeCompare(b.name, "it"));
    modelsCache = { at: Date.now(), models };
    return models;
  }

  return {
    get: current,
    get version() {
      return version;
    },
    /** Override da passare al data agent: il modello sempre, la chiave solo se scelta dall'utente. */
    dataAgentOverride() {
      const s = current();
      return { model: s.model, ...(s.apiKeySource === "ui" ? { api_key: s.apiKey } : {}) };
    },
    async describe() {
      const s = current();
      let keyInfo = null;
      let keyValid = null;
      try {
        if (keyInfoCache.key === s.apiKey && Date.now() - keyInfoCache.at < KEY_INFO_TTL_MS) {
          keyInfo = keyInfoCache.info;
        } else {
          keyInfo = await fetchKeyInfo(s.apiKey);
          keyInfoCache = { at: Date.now(), key: s.apiKey, info: keyInfo };
        }
        keyValid = keyInfo !== null;
      } catch {
        keyValid = null; // stato sconosciuto: OpenRouter non raggiungibile
      }
      return {
        apiKey: { source: s.apiKeySource, masked: maskKey(s.apiKey), valid: keyValid, info: keyInfo },
        model: { id: s.model, source: s.modelSource, default: config.LLM_MODEL },
        fallbackModels: config.LLM_FALLBACK_MODELS,
      };
    },
    async update({ apiKey, model, resetApiKey = false, resetModel = false }) {
      if (apiKey !== undefined) {
        const key = apiKey.trim();
        if (!/^[\w-]{20,200}$/.test(key)) throw new SettingsError("Formato della chiave non valido.");
        if ((await fetchKeyInfo(key)) === null) throw new SettingsError("OpenRouter ha rifiutato la chiave: controlla di averla copiata per intero.");
        store.set("openrouter_api_key", key);
        keyInfoCache = { at: 0, key: null, info: null };
      } else if (resetApiKey) {
        store.delete("openrouter_api_key");
      }
      if (model !== undefined) {
        const models = await listModels();
        if (!models.some((m) => m.id === model)) throw new SettingsError("Modello non trovato o senza supporto al tool calling.");
        store.set("llm_model", model);
      } else if (resetModel) {
        store.delete("llm_model");
      }
      version += 1;
      return this.describe();
    },
    listModels,
  };
}
