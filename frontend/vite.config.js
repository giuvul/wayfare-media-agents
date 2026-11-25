import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// In sviluppo le chiamate a /api vengono inoltrate al back end: il browser vede una sola origine.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, "..", ""), ...process.env };
  const backend = env.BACKEND_URL ?? `http://localhost:${env.BACKEND_PORT ?? 3001}`;
  return {
    plugins: [react()],
    server: {
      host: env.FRONTEND_HOST ?? "127.0.0.1",
      port: Number(env.FRONTEND_PORT ?? 5173),
      proxy: { "/api": { target: backend, changeOrigin: true } },
    },
    preview: { proxy: { "/api": { target: backend, changeOrigin: true } } },
  };
});
