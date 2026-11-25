// Unico punto in cui si sceglie provider e modello: OpenRouter con API compatibile OpenAI (vendor-agnostic).
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

const HEADERS = { "X-Title": "Wayfare Media Agents" };

/** @param {{ model?: string, apiKey?: string }} [override] impostazioni scelte dall'utente */
export function createChatModel(config, { model = config.LLM_MODEL, apiKey = config.OPENROUTER_API_KEY } = {}) {
  const modelKwargs = {
    // instrada solo verso provider che supportano tutti i parametri richiesti (tool calling incluso)
    provider: { require_parameters: true },
  };
  const fallbacks = config.LLM_FALLBACK_MODELS.filter((m) => m !== model);
  if (fallbacks.length > 0) {
    // fallback lato OpenRouter se il modello principale è saturo o non disponibile
    modelKwargs.models = [model, ...fallbacks];
  }
  return new ChatOpenAI({
    model,
    apiKey,
    configuration: { baseURL: config.OPENROUTER_BASE_URL, defaultHeaders: HEADERS },
    temperature: 0,
    timeout: config.LLM_TIMEOUT_MS,
    maxRetries: 1,
    modelKwargs,
  });
}

export function createEmbeddings(config, apiKey = config.OPENROUTER_API_KEY, model = config.EMBEDDING_MODEL) {
  return new OpenAIEmbeddings({
    model,
    apiKey,
    configuration: { baseURL: config.OPENROUTER_BASE_URL, defaultHeaders: HEADERS },
    batchSize: 32,
    maxRetries: 2,
  });
}
