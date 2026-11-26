import { createSseParser } from "./sse.js";

export const CLIENT_TIMEOUT_MS = 150_000; // > timeout del back end (120 s): l'errore arriva dal server, con un messaggio chiaro

async function request(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Errore del server (${res.status}).`);
  return data;
}

/** Invia un messaggio e riceve in streaming gli eventi del turno (status, tool_start, tool_end, token, final, error). */
export async function streamChat({ message, sessionId, signal, onEvent }) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message, sessionId }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(CLIENT_TIMEOUT_MS)]),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Errore del server (${res.status}).`);
  }
  const parse = createSseParser(onEvent);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parse(value);
  }
}

const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "")).toString();

export const api = {
  health: () => request("/health").catch(() => ({ status: "down" })),
  conversations: () => request("/conversations"),
  conversation: (id) => request(`/conversations/${id}`),
  deleteConversation: (id) => request(`/conversations/${id}`, { method: "DELETE" }),
  settings: () => request("/settings"),
  updateSettings: (body) => request("/settings", { method: "PUT", body }),
  models: (q, signal) => request(`/models?${qs({ q })}`, { signal }),
  generations: (ids, signal) => request(`/generations?${qs({ ids: ids.join(",") })}`, { signal }),
  embeddings: () => request("/embeddings"),
  embeddingModels: (q, signal) => request(`/embeddings/remote?${qs({ q })}`, { signal }),
  localEmbeddings: () => request("/embeddings/local"),
  switchEmbedding: (provider, model) => request("/embeddings/switch", { method: "POST", body: { provider, model } }),
  embeddingJob: () => request("/embeddings/switch"),
  documents: () => request("/kb/documents"),
  document: (id) => request(`/kb/documents/${encodeURIComponent(id)}`),
  documentRaw: (id) => request(`/kb/documents/${encodeURIComponent(id)}/raw`),
  saveDocument: (id, content) => request(`/kb/documents/${encodeURIComponent(id)}`, { method: "PUT", body: { content } }),
  createDocument: (title, content) => request("/kb/documents", { method: "POST", body: { title, content } }),
  deleteDocument: (id) => request(`/kb/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  data: (params, signal) => request(`/kb/data?${qs(params)}`, { signal }),
  updateCell: (rowId, column, value) => request(`/kb/data/rows/${encodeURIComponent(rowId)}`, { method: "PATCH", body: { column, value } }),
  dictionary: () => request("/kb/dictionary"),
  saveDictionary: (content) => request("/kb/dictionary", { method: "PUT", body: { content } }),
  cleaning: () => request("/kb/cleaning"),
  rebuildCleaning: (mode) => request("/kb/cleaning/rebuild", { method: "POST", body: { mode } }),
};
