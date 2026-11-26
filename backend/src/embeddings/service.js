// Modello di embedding attivo: OpenRouter (cloud) o locale. Scelta dall'interfaccia, salvata in SQLite,
// con il .env come default.
//
// Ogni modello ha la sua collection Chroma: vettori di modelli diversi non sono confrontabili. Il cambio è
// un'operazione in background (download, caricamento, indicizzazione, verifica) e il nuovo modello diventa
// attivo solo a operazione riuscita; se qualcosa fallisce resta quello precedente.
import { createHash } from "node:crypto";

import { createEmbeddings } from "../llm.js";
import { toModel } from "../settings.js";
import { downloadSizeMb, findLocalModel, LOCAL_MODELS } from "./catalog.js";
import { downloadModel, isDownloaded, LocalEmbeddings } from "./local.js";
import { assessModel, machineInfo } from "./system.js";
import { HttpError } from "../errors.js";

const STORE_KEY = "embedding";
const THRESHOLD_KEY = (key) => `embedding_threshold:${key}`;

// Domande chiaramente estranee a qualsiasi documentazione aziendale: servono a calibrare la soglia di pertinenza.
// Ogni modello ha una scala di similarità diversa (E5 restituisce valori compressi tra 0,7 e 0,9, altri tra 0 e 0,6),
// quindi una soglia fissa non va bene per tutti.
export const OFF_TOPIC_QUERIES = [
  "Che tempo farà domani a Milano?",
  "Dammi la ricetta della carbonara",
  "Chi ha vinto il campionato di calcio nel 2006?",
  "Come si installa Python su Windows?",
  "Scrivimi una poesia sul mare",
  "Quali sono i sintomi dell'influenza?",
  "Chi ha dipinto la Gioconda?",
  "Come si coltivano i pomodori sul balcone?",
];

/** Soglia = 75° percentile della similarità migliore ottenuta dalle domande fuori tema. */
export function calibrateThreshold(offTopicTop) {
  const sorted = [...offTopicTop].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(sorted.length * 0.75) - 1)].toFixed(3));
}
const REMOTE_TTL_MS = 60 * 60 * 1000;

export class EmbeddingError extends HttpError {}

/** Nome della collection: quello del .env per il modello di default (compatibilità), suffissato per gli altri. */
export function collectionName(base, defaults, { provider, model }) {
  if (provider === defaults.provider && model === defaults.model) return base;
  const slug = `${provider}-${model}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const hash = createHash("sha256").update(`${provider}:${model}`).digest("hex").slice(0, 8);
  return `${base}-${slug}-${hash}`;
}

export function createEmbeddingService({ config, store, getApiKey, log, fetchImpl = fetch, machine = () => machineInfo(config.MODELS_DIR) }) {
  const defaults = { provider: config.EMBEDDING_PROVIDER, model: config.EMBEDDING_MODEL };
  if (defaults.provider === "local" && !findLocalModel(defaults.model)) {
    throw new Error(`EMBEDDING_MODEL "${defaults.model}" non è nel catalogo dei modelli locali: ${LOCAL_MODELS.map((m) => m.id).join(", ")}`);
  }
  let remoteCache = { at: 0, models: [] };
  let remoteClient = { key: null, model: null, embeddings: null };
  const localClients = new Map();

  const describeTarget = (t, source) => {
    const key = t.provider === "local" ? `local:${t.model}` : t.model; // salvato nei metadati della collection
    const calibrated = store.get(THRESHOLD_KEY(key));
    return {
      provider: t.provider,
      model: t.model,
      key,
      collection: collectionName(config.CHROMA_COLLECTION, defaults, t),
      name: t.provider === "local" ? findLocalModel(t.model)?.name ?? t.model : t.model,
      minSimilarity: calibrated != null ? Number(calibrated) : config.RAG_MIN_SIMILARITY,
      thresholdSource: calibrated != null ? "calibrata" : "env",
      source,
    };
  };

  function current() {
    const raw = store.get(STORE_KEY);
    if (raw) {
      try {
        const t = JSON.parse(raw);
        if (t.provider === "openrouter" || findLocalModel(t.model)) return describeTarget(t, "ui");
      } catch {
        /* valore non valido: si torna al default */
      }
    }
    return describeTarget(defaults, "env");
  }

  function getEmbeddings(target = current()) {
    if (target.provider === "local") {
      if (!localClients.has(target.model)) {
        localClients.set(target.model, new LocalEmbeddings({ model: findLocalModel(target.model), modelsDir: config.MODELS_DIR, log }));
      }
      return localClients.get(target.model);
    }
    const key = getApiKey();
    if (remoteClient.key !== key || remoteClient.model !== target.model) {
      remoteClient = { key, model: target.model, embeddings: createEmbeddings(config, key, target.model) };
    }
    return remoteClient.embeddings;
  }

  async function listRemote() {
    if (Date.now() - remoteCache.at < REMOTE_TTL_MS && remoteCache.models.length) return remoteCache.models;
    const res = await fetchImpl(new URL(`${config.OPENROUTER_BASE_URL}/embeddings/models`), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new EmbeddingError(`Elenco dei modelli di embedding non disponibile (HTTP ${res.status}).`, 502);
    const { data } = await res.json();
    const models = data.map(toModel).sort((a, b) => a.name.localeCompare(b.name, "it"));
    remoteCache = { at: Date.now(), models };
    return models;
  }

  function localCatalog(chunks) {
    const info = machine();
    return {
      machine: info,
      models: LOCAL_MODELS.map((m) => {
        const downloaded = isDownloaded(config.MODELS_DIR, m);
        return {
          id: m.id, name: m.name, description: m.description, dims: m.dims, license: m.license, ramMb: m.ramMb,
          downloadMb: downloadSizeMb(m), downloaded, assessment: assessModel(m, info, { downloaded, chunks }),
        };
      }),
    };
  }

  return {
    defaults: describeTarget(defaults, "env"),
    current,
    target: (t) => describeTarget(t, "ui"),
    getEmbeddings,
    listRemote,
    localCatalog,
    setThreshold(t, value) {
      store.set(THRESHOLD_KEY(t.key), String(value));
    },
    setCurrent(t) {
      if (t.provider === defaults.provider && t.model === defaults.model) store.delete(STORE_KEY);
      else store.set(STORE_KEY, JSON.stringify({ provider: t.provider, model: t.model }));
    },
    /** Libera la memoria dei modelli locali non più in uso. */
    async releaseUnused() {
      const active = current();
      for (const [id, client] of localClients) {
        if (!(active.provider === "local" && active.model === id)) {
          localClients.delete(id);
          await client.dispose();
          log.info({ model: id }, "modello di embedding locale scaricato dalla memoria");
        }
      }
    },
    download: (model, onProgress) => downloadModel(config.MODELS_DIR, model, { onProgress }),
  };
}

/** Cambio del modello di embedding: un'operazione alla volta, stato interrogabile dall'interfaccia. */
export function createEmbeddingSwitcher({ service, indexer, retriever, log }) {
  let state = { status: "idle" };
  let starting = false;
  const set = (patch) => {
    state = { ...state, ...patch };
  };

  async function run(target) {
    const t0 = Date.now();
    if (target.provider === "local") {
      const model = findLocalModel(target.model);
      set({ phase: "download", progress: 0 });
      await service.download(model, (done, total) => set({ progress: total ? done / total : 1 }));
      set({ phase: "caricamento", progress: null });
      await service.getEmbeddings(target).load();
    }
    set({ phase: "indicizzazione", progress: 0 });
    const tIndex = Date.now();
    const results = await indexer.indexAll({ target, onProgress: (done, total) => set({ progress: done / total }) });
    const indexMs = Date.now() - tIndex;
    set({ phase: "verifica", progress: null });
    const { chunks, sample } = await indexer.sample(target);
    if (!chunks) throw new Error("nessun passaggio indicizzato");
    const hits = await retriever.search(sample, { target, minSimilarity: 0, topK: 1 });
    if (!hits.length) throw new Error("la ricerca di prova non ha restituito risultati");
    const offTopic = [];
    for (const q of OFF_TOPIC_QUERIES) offTopic.push((await retriever.search(q, { target, minSimilarity: 0, topK: 1 }))[0]?.similarity ?? 0);
    const threshold = calibrateThreshold(offTopic);
    if (hits[0].similarity <= threshold) throw new Error("il modello non distingue i testi della documentazione da domande fuori tema");
    service.setThreshold(target, threshold);
    service.setCurrent(target);
    await indexer.indexAll(); // documenti modificati durante il cambio: allineati sulla collection ora attiva
    await service.releaseUnused();
    const embedded = results.filter((r) => !r.skipped).reduce((s, r) => s + r.chunks, 0);
    log.info({ embedding: target.key, chunks, ms: Date.now() - t0 }, "modello di embedding cambiato");
    set({
      status: "done", phase: null, progress: null, finishedAt: new Date().toISOString(),
      result: {
        chunks, embedded, durationMs: Date.now() - t0, msPerChunk: embedded ? Math.round(indexMs / embedded) : null,
        selfSimilarity: hits[0].similarity, threshold, offTopicMax: Math.max(...offTopic),
      },
    });
  }

  return {
    state: () => state,
    async start({ provider, model }) {
      if (state.status === "running" || starting) throw new EmbeddingError("Un cambio di modello è già in corso.", 409);
      starting = true; // prenotato prima di qualunque await: un doppio clic non avvia due cambi
      try {
        const active = service.current();
        if (active.provider === provider && active.model === model) throw new EmbeddingError("Questo modello è già in uso.");
        if (provider === "local") {
          const m = findLocalModel(model);
          if (!m) throw new EmbeddingError("Modello locale non presente nel catalogo.");
          const { verdict, reasons } = service.localCatalog().models.find((x) => x.id === model).assessment;
          if (verdict === "insufficiente" || verdict === "non_supportato") throw new EmbeddingError(`Questa macchina non può eseguire il modello: ${reasons[0]}`);
        } else if (!(await service.listRemote()).some((m) => m.id === model)) {
          throw new EmbeddingError("Modello di embedding non trovato su OpenRouter.");
        }
        const target = service.target({ provider, model });
        state = { status: "running", phase: "preparazione", progress: null, target, startedAt: new Date().toISOString() };
        run(target).catch(async (err) => {
          log.error({ err: err.message, embedding: target.key }, "cambio del modello di embedding non riuscito");
          await service.releaseUnused().catch(() => {}); // un modello locale caricato per il cambio libera la memoria
          set({ status: "error", phase: null, progress: null, error: `Cambio non riuscito: ${err.message}. Resta in uso il modello precedente.` });
        });
        return state;
      } finally {
        starting = false;
      }
    },
  };
}
