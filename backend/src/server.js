// Punto di avvio: compone le dipendenze (config, archivio, impostazioni, tool, agente) e avvia il server HTTP.
import { createAgentProvider } from "./agent.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createEmbeddingService, createEmbeddingSwitcher } from "./embeddings/service.js";
import { createChatModel } from "./llm.js";
import { createLogger } from "./logger.js";
import { createDocumentStore } from "./rag/documents.js";
import { createIndexer } from "./rag/ingest.js";
import { createRetriever } from "./rag/retriever.js";
import { createGenerationService } from "./generations.js";
import { createSettingsService } from "./settings.js";
import { createCheckpointer, createConversationStore, createSettingsStore, openDatabase } from "./storage/db.js";
import { createDataAgentClient, createDataAgentTool } from "./tools/dataAgent.js";
import { createKnowledgeBaseTool } from "./tools/knowledgeBase.js";

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL);

const db = openDatabase(config.STORAGE_DIR);
const checkpointer = createCheckpointer(config.STORAGE_DIR); // memoria dell'agente persistente tra i riavvii
const conversations = createConversationStore(db);
const settings = createSettingsService({ config, store: createSettingsStore(db) });

const embeddings = createEmbeddingService({ config, store: createSettingsStore(db), getApiKey: () => settings.get().apiKey, log });
const documents = createDocumentStore(config.KB_DIR);
const indexer = createIndexer({ config, embeddings, documents, log });
const retriever = createRetriever({ config, embeddings });
const embeddingSwitcher = createEmbeddingSwitcher({ service: embeddings, indexer, retriever, log });
const dataAgent = createDataAgentClient(config);

const getAgent = createAgentProvider({
  settings,
  buildModel: (override) => createChatModel(config, override),
  tools: [createKnowledgeBaseTool(retriever), createDataAgentTool(dataAgent, () => settings.dataAgentOverride())],
  maxModelCalls: config.AGENT_MAX_MODEL_CALLS,
  checkpointer,
});

const app = createApp({
  config, log, getAgent, checkpointer, dataAgent, retriever, conversations, settings, documents, indexer, embeddings, embeddingSwitcher,
  generations: createGenerationService({ config, settings }),
});
const server = app.listen(config.BACKEND_PORT, config.BACKEND_HOST, () => {
  log.info({ port: config.BACKEND_PORT, model: settings.get().model, embedding: embeddings.current().key }, "back end avviato");
  // modello di embedding locale: caricato subito, così la prima domanda non aspetta
  if (embeddings.current().provider === "local") {
    embeddings.getEmbeddings().load().catch((err) => log.error({ err: err.message }, "caricamento del modello di embedding locale fallito"));
  }
});
server.requestTimeout = config.CHAT_TIMEOUT_MS + 15_000;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log.info({ signal }, "arresto in corso");
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
