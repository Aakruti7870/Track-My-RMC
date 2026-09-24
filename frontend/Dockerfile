FROM node:20.19.4-bookworm-slim AS build

WORKDIR /app
COPY . .

RUN npm ci

# The production web app talks to the canonical host. nginx below keeps /api and
# public policy/deep-link routes on the existing production backend.
ARG EXPO_PUBLIC_BACKEND_URL=https://trackmyrmc.com
ENV EXPO_PUBLIC_BACKEND_URL=${EXPO_PUBLIC_BACKEND_URL}
RUN npm run build:preview

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Explicitly retire service workers left by older web builds. Without these real
# JavaScript files, SPA fallback can answer a worker-update request with
# index.html, causing the stale worker to remain installed and serve an old
# login shell on the first navigation.
COPY --from=build /app/legacy-service-worker.js /usr/share/nginx/html/service-worker.js
COPY --from=build /app/legacy-service-worker.js /usr/share/nginx/html/sw.js
COPY --from=build /app/legacy-service-worker.js /usr/share/nginx/html/expo-service-worker.js

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
