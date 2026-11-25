# Back end / orchestratore. Debian (glibc) e non Alpine: il runtime ONNX degli embedding locali richiede glibc.
# Build dalla radice del repository: docker build -f backend/Dockerfile .
FROM node:24.22.3-trixie-slim

ENV NODE_ENV=production
WORKDIR /app/backend

# dipendenze prima del codice, per sfruttare la cache dei layer; .npmrc salta il download delle librerie CUDA
COPY backend/package.json backend/package-lock.json backend/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force \
 # binari ONNX per macOS e Windows: inutili in un'immagine Linux (~220 MB)
 && rm -rf node_modules/onnxruntime-node/bin/napi-v*/darwin node_modules/onnxruntime-node/bin/napi-v*/win32

COPY backend/src ./src
# documentazione iniziale: il volume montato su /app/data/kb viene popolato da qui al primo avvio
COPY data/kb /app/data/kb
RUN mkdir -p /app/storage && chown -R node:node /app/storage /app/data/kb

USER node
ENV BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=3001 \
    STORAGE_DIR=/app/storage \
    KB_DIR=/app/data/kb
EXPOSE 3001

# vivo = risponde; lo stato dei servizi a valle è in /api/health (503 se degradato) e non riavvia il back end
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/health').then(() => process.exit(0), () => process.exit(1))"]

CMD ["node", "src/server.js"]
