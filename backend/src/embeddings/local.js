// Embedding calcolati in locale con Transformers.js (ONNX Runtime su CPU): testi e domande non lasciano la macchina.
//
// Il download è un passo esplicito e controllato: file scaricati in streaming su disco (niente picchi di
// memoria), revisione fissata, SHA-256 verificato. A runtime il caricamento avviene solo dal disco
// (allowRemoteModels = false): il servizio non contatta Hugging Face mentre risponde.
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";

import { Embeddings } from "@langchain/core/embeddings";

const HF_BASE = "https://huggingface.co";
const BATCH = 8; // blocchi piccoli: picco di memoria contenuto

const fileOf = (modelsDir, model, f) => path.join(modelsDir, model.id, f.path);

export function isDownloaded(modelsDir, model) {
  return model.files.every((f) => {
    const p = fileOf(modelsDir, model, f);
    return existsSync(p) && statSync(p).size === f.size;
  });
}

/** Scarica i file mancanti. onProgress(bytesScaricati, bytesTotali). */
export async function downloadModel(modelsDir, model, { onProgress = () => {}, fetchImpl = fetch, signal } = {}) {
  const total = model.files.reduce((s, f) => s + f.size, 0);
  let done = model.files.filter((f) => existsSync(fileOf(modelsDir, model, f)) && statSync(fileOf(modelsDir, model, f)).size === f.size)
    .reduce((s, f) => s + f.size, 0);
  onProgress(done, total);
  for (const f of model.files) {
    const dest = fileOf(modelsDir, model, f);
    if (existsSync(dest) && statSync(dest).size === f.size) continue;
    mkdirSync(path.dirname(dest), { recursive: true });
    const url = `${HF_BASE}/${model.id}/resolve/${model.revision}/${f.path}`;
    const res = await fetchImpl(url, { signal });
    if (!res.ok || !res.body) throw new Error(`download di ${f.path} non riuscito (HTTP ${res.status})`);
    const hash = createHash("sha256");
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        done += chunk.length;
        onProgress(done, total);
        cb(null, chunk);
      },
    });
    const part = `${dest}.part`;
    try {
      await streamPipeline(Readable.fromWeb(res.body), meter, createWriteStream(part));
      const size = statSync(part).size;
      if (size !== f.size) throw new Error(`${f.path}: dimensione ${size} invece di ${f.size}`);
      if (f.sha256 && hash.digest("hex") !== f.sha256) throw new Error(`${f.path}: impronta SHA-256 diversa da quella attesa`);
      renameSync(part, dest);
    } catch (err) {
      rmSync(part, { force: true });
      throw err;
    }
  }
}

/** Embeddings LangChain calcolati in locale. Le chiamate sono serializzate per limitare la memoria. */
export class LocalEmbeddings extends Embeddings {
  constructor({ model, modelsDir, log }) {
    super({ maxConcurrency: 1 });
    this.model = model;
    this.modelsDir = modelsDir;
    this.log = log;
    this.extractor = null;
    this.loading = null;
    this.queue = Promise.resolve();
  }

  async load() {
    this.loading ??= (async () => {
      if (!isDownloaded(this.modelsDir, this.model)) {
        this.log?.info({ model: this.model.id }, "modello di embedding locale non presente: download");
        await downloadModel(this.modelsDir, this.model);
      }
      const { env, pipeline } = await import("@huggingface/transformers");
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = this.modelsDir;
      const t0 = Date.now();
      this.extractor = await pipeline("feature-extraction", this.model.id, { dtype: "q8" });
      this.log?.info({ model: this.model.id, ms: Date.now() - t0 }, "modello di embedding locale caricato");
      return this.extractor;
    })().catch((err) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  run(texts) {
    const job = this.queue.then(async () => {
      const extractor = await this.load();
      const out = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const tensor = await extractor(texts.slice(i, i + BATCH), { pooling: this.model.pooling, normalize: true });
        out.push(...tensor.tolist());
      }
      return out;
    });
    this.queue = job.catch(() => {});
    return job;
  }

  embedDocuments(texts) {
    return this.run(texts.map((t) => this.model.passagePrefix + t));
  }

  async embedQuery(text) {
    return (await this.run([this.model.queryPrefix + text]))[0];
  }

  async dispose() {
    const extractor = this.extractor;
    this.extractor = null;
    this.loading = null;
    await extractor?.dispose?.();
  }
}
