// Unico punto in cui si sceglie provider e modello: OpenRouter con API compatibile OpenAI (vendor-agnostic).
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

const HEADERS = { "X-Title": "Wayfare Media Agents" };

/**
 * @param {{ model?: string, apiKey?: string, temperature?: number }} [override] impostazioni scelte dall'utente.
 * `temperature` va passata solo se il modello la supporta: con `require_parameters` OpenRouter rifiuta (404) una
 * richiesta con un parametro che il modello non accetta, e i modelli più recenti di Anthropic e OpenAI non
 * accettano la temperatura. Senza, il modello usa il suo default.
 */
export function createChatModel(config, { model = config.LLM_MODEL, apiKey = config.OPENROUTER_API_KEY, temperature } = {}) {
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
    ...(temperature === undefined ? {} : { temperature }),
    timeout: config.LLM_TIMEOUT_MS,
    maxRetries: 0, // i tentativi li gestisce modelRetryMiddleware dell'agente: un solo livello, tempi prevedibili
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
