FROM node:20.19.4-bookworm-slim AS build

WORKDIR /app
COPY . .

RUN npm ci

# The production web app talks to the canonical host. nginx below keeps /api and
# public policy/deep-link routes on the existing production backend.
ARG EXPO_PUBLIC_BACKEND_URL=https://trackmyrmc.com
ENV EXPO_PUBLIC_BACKEND_URL=${EXPO_PUBLIC_BACKEND_URL}
RUN npm run build:preview

FROM ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine@sha256:e234d4f7e346c098f7b22245690372382aded5be988611eb2c53ae62231eece7

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Explicitly retire service workers left by older web builds. Without these real
# JavaScript files, SPA fallback can answer a worker-update request with
# index.html, causing the stale worker to remain installed and serve an old
# login shell on the first navigation.
COPY --from=build /app/legacy-service-worker.js /usr/share/nginx/html/service-worker.js
COPY --from=build /app/legacy-service-worker.js /usr/share/nginx/html/sw.js
COPY --from=build /app/legacy-service-worker.js /usr/share/nginx/html/expo-service-worker.js

# Unprivileged upstream uses writable /tmp PID/cache paths and listens on 8080.
# Explicit UID/GID prevents any default-user regression.
USER 101:101
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
