// Unico punto in cui si sceglie provider e modello: OpenRouter con API compatibile OpenAI (vendor-agnostic).
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

const HEADERS = { "X-Title": "Wayfare Media Agents" };

export function createChatModel(config) {
  const modelKwargs = {
    // instrada solo verso provider che supportano tutti i parametri richiesti (tool calling incluso)
    provider: { require_parameters: true },
  };
  if (config.LLM_FALLBACK_MODELS.length > 0) {
    // fallback lato OpenRouter se il modello principale è saturo o non disponibile
    modelKwargs.models = [config.LLM_MODEL, ...config.LLM_FALLBACK_MODELS];
  }
  return new ChatOpenAI({
    model: config.LLM_MODEL,
    apiKey: config.OPENROUTER_API_KEY,
    configuration: { baseURL: config.OPENROUTER_BASE_URL, defaultHeaders: HEADERS },
    temperature: 0,
    timeout: config.LLM_TIMEOUT_MS,
    maxRetries: 1,
    modelKwargs,
  });
}

export function createEmbeddings(config) {
  return new OpenAIEmbeddings({
    model: config.EMBEDDING_MODEL,
    apiKey: config.OPENROUTER_API_KEY,
    configuration: { baseURL: config.OPENROUTER_BASE_URL, defaultHeaders: HEADERS },
    batchSize: 32,
    maxRetries: 2,
  });
}
