FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY web/package*.json ./web/
RUN cd web && npm ci

COPY web ./web
COPY shared ./shared

WORKDIR /app/web
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app

COPY --from=build /app/web ./web
COPY --from=build /app/shared ./shared

WORKDIR /app/web
ENV NODE_ENV=production
EXPOSE 5173

CMD ["npm","run","preview","--","--host","0.0.0.0","--port","5173"]

