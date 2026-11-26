# Front end: build statica servita da nginx, che inoltra /api al back end (una sola origine, niente CORS).
# Build dalla radice del repository: docker build -f frontend/Dockerfile .
FROM node:24.22.3-trixie-slim AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci
COPY frontend/index.html frontend/vite.config.js ./
COPY frontend/public ./public
COPY frontend/src ./src
RUN npm run build

# nginx senza privilegi di root (porta 8080)
FROM nginxinc/nginx-unprivileged:1.30.6-alpine-slim
COPY frontend/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/docker/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
