// Persistenza locale in SQLite: cronologia delle conversazioni e impostazioni dell'utente.
// La memoria dell'agente (checkpoint LangGraph) vive in un file separato gestito da SqliteSaver.
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  data            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, seq);
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

const now = () => new Date().toISOString();

export function openDatabase(storageDir) {
  const inMemory = storageDir === ":memory:";
  if (!inMemory) mkdirSync(storageDir, { recursive: true, mode: 0o700 });
  const file = inMemory ? ":memory:" : path.join(storageDir, "app.db");
  const db = new Database(file);
  if (!inMemory) chmodSync(file, 0o600); // contiene la chiave API eventualmente impostata dall'interfaccia
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function createCheckpointer(storageDir) {
  if (storageDir === ":memory:") return SqliteSaver.fromConnString(":memory:");
  mkdirSync(storageDir, { recursive: true, mode: 0o700 });
  const file = path.join(storageDir, "checkpoints.db");
  const db = new Database(file);
  chmodSync(file, 0o600); // contiene la memoria delle conversazioni
  return new SqliteSaver(db);
}

export function titleFrom(message) {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > 70 ? `${clean.slice(0, 67).trimEnd()}…` : clean;
}

export function createConversationStore(db) {
  const q = {
    list: db.prepare("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT ?"),
    get: db.prepare("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?"),
    insert: db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"),
    touch: db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?"),
    remove: db.prepare("DELETE FROM conversations WHERE id = ?"),
    messages: db.prepare("SELECT id, role, data, created_at FROM messages WHERE conversation_id = ? ORDER BY seq"),
    addMessage: db.prepare("INSERT INTO messages (id, conversation_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)"),
  };
  const toConversation = (r) => r && { id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at };

  return {
    list: (limit = 200) => q.list.all(limit).map(toConversation),
    get: (id) => toConversation(q.get.get(id)),
    ensure(id, firstMessage) {
      const existing = q.get.get(id);
      if (existing) return toConversation(existing);
      const ts = now();
      q.insert.run(id, titleFrom(firstMessage), ts, ts);
      return toConversation(q.get.get(id));
    },
    addMessage: db.transaction((conversationId, { id, role, ...data }) => {
      const ts = now();
      q.addMessage.run(id, conversationId, role, JSON.stringify(data), ts);
      q.touch.run(ts, conversationId);
    }),
    messages: (id) =>
      q.messages.all(id).map((r) => ({ id: r.id, role: r.role, createdAt: r.created_at, ...JSON.parse(r.data) })),
    remove: (id) => q.remove.run(id).changes > 0,
  };
}

export function createSettingsStore(db) {
  const get = db.prepare("SELECT value FROM settings WHERE key = ?");
  const set = db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  const del = db.prepare("DELETE FROM settings WHERE key = ?");
  return {
    get: (key) => get.get(key)?.value ?? null,
    set: (key, value) => set.run(key, value, now()),
    delete: (key) => del.run(key),
  };
}
