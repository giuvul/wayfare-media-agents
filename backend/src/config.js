// Configurazione del back end: variabili d'ambiente validate con zod all'avvio (fail fast).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = path.resolve(BACKEND_DIR, "..");

// Un solo .env alla radice del repo. Le variabili già presenti (es. da docker compose) hanno la precedenza.
const envFile = path.join(REPO_DIR, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const commaList = (fallback = "") =>
  z
    .string()
    .default(fallback)
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean));

const schema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY mancante nel .env"),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  LLM_MODEL: z.string().min(1),
  LLM_FALLBACK_MODELS: commaList(),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  EMBEDDING_MODEL: z.string().min(1),

  DATA_AGENT_URL: z.url().default("http://localhost:8001"),
  DATA_AGENT_TOKEN: z.string().min(16, "DATA_AGENT_TOKEN deve avere almeno 16 caratteri"),
  DATA_AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(75_000),

  CHROMA_URL: z.url().default("http://localhost:8000"),
  CHROMA_COLLECTION: z.string().default("wayfare_handbook"),
  KB_PDF_PATH: z.string().default(path.join(REPO_DIR, "data", "kb", "wayfare_media_handbook.pdf")),
  RAG_TOP_K: z.coerce.number().int().min(1).max(10).default(5),
  RAG_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.3),

  BACKEND_PORT: z.coerce.number().int().default(3001),
  BACKEND_HOST: z.string().default("127.0.0.1"),
  FRONTEND_ORIGIN: commaList("http://localhost:5173"),
  CHAT_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  CHAT_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(20),
  AGENT_MAX_MODEL_CALLS: z.coerce.number().int().min(2).max(15).default(6),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configurazione non valida (controlla il file .env):\n${problems}`);
  }
  return Object.freeze(parsed.data);
}
