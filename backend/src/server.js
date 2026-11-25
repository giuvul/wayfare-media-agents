// Punto di avvio: compone le dipendenze (config, modello, tool, agente) e avvia il server HTTP.
import { createOrchestrator } from "./agent.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createChatModel, createEmbeddings } from "./llm.js";
import { createLogger } from "./logger.js";
import { createRetriever } from "./rag/retriever.js";
import { createDataAgentClient, createDataAgentTool } from "./tools/dataAgent.js";
import { createKnowledgeBaseTool } from "./tools/knowledgeBase.js";

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL);

const retriever = createRetriever({ config, embeddings: createEmbeddings(config) });
const dataAgent = createDataAgentClient(config);
const { agent, checkpointer } = createOrchestrator({
  model: createChatModel(config),
  tools: [createKnowledgeBaseTool(retriever), createDataAgentTool(dataAgent)],
  maxModelCalls: config.AGENT_MAX_MODEL_CALLS,
});

const app = createApp({ config, log, agent, checkpointer, dataAgent, retriever });
const server = app.listen(config.BACKEND_PORT, config.BACKEND_HOST, () => {
  log.info({ port: config.BACKEND_PORT, model: config.LLM_MODEL }, "back end avviato");
});
server.requestTimeout = config.CHAT_TIMEOUT_MS + 15_000;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log.info({ signal }, "arresto in corso");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
